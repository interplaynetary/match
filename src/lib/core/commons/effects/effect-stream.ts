/**
 * Effect Stream: A processing queue for effects flowing through space-time.
 *
 * Effects enter the stream and advance through lifecycle phases:
 *   projected → pending → judged (accepted | rejected | modified) → propagated
 *
 * Design principles:
 * 1. Append-only storage — effects are never mutated, new versions are appended
 * 2. Pluggable processors — handlers for each phase transition
 * 3. State-predicate-aware — phase changes re-derive state, evaluate watchers' predicates
 * 4. Bitemporal — every state change records both valid_time and known_time
 *
 * The stream is generic: it doesn't know what effects mean, only how they flow.
 * Domain logic lives in the processors you plug in.
 */

import { nanoid } from 'nanoid';
import { type NanoId } from '../primitives/ids.ts';
import {
    type Effect,
    type CompositeEffect,
    type AssertionPhase,
    type AssertionEntry,
    type Delta,
    type PropagationAction,
    currentPhase,
    evaluatePredicates,
    evaluateSinglePredicate,
    stateKey,
} from './effect.ts';
import { derive } from '../matching/derivation.ts';
import { createHexIndex, addItemToHexIndex, type HexIndex } from '../primitives/space-time-index.ts';

// =============================================================================
// STREAM EVENT — What the stream emits
// =============================================================================

export type StreamEvent =
    | { type: 'submitted'; effect: Effect }
    | { type: 'phase_changed'; effect: Effect; from: AssertionPhase; to: AssertionPhase }
    | { type: 'propagation'; action: PropagationAction; source: Effect; target: Effect }
    | { type: 'composed'; composite: CompositeEffect; constituents: Effect[] }
    | { type: 'error'; effect_id: string; error: string };

// =============================================================================
// PROCESSORS — Pluggable phase-transition handlers
// =============================================================================

/**
 * A processor decides whether/how an effect transitions between phases.
 * Return the new assertion entry to apply, or null to skip.
 */
export type PhaseProcessor = (
    effect: Effect,
    context: ProcessorContext,
) => AssertionEntry | null | Promise<AssertionEntry | null>;

/**
 * A propagation handler decides what to do when a dependent is affected.
 * Called once per propagation action.
 */
export type PropagationHandler = (
    action: PropagationAction,
    source: Effect,
    target: Effect,
    context: ProcessorContext,
) => void | Promise<void>;

/**
 * A merge handler resolves how constituent effects combine into a composite.
 * Returns the merged deltas for the composite effect.
 */
export type MergeHandler = (
    constituents: Effect[],
    strategy: CompositeEffect['merge_strategy'],
    rule?: unknown,
) => Delta[];

export interface ProcessorContext {
    stream: EffectStream;
    now: () => Date;
}

// =============================================================================
// LISTENER — Subscribe to stream events
// =============================================================================

export type StreamListener = (event: StreamEvent) => void | Promise<void>;

// =============================================================================
// EFFECT STREAM
// =============================================================================

export class EffectStream {
    // Storage
    private effects = new Map<string, Effect[]>();        // origin_id → versions (ordered)
    private queue: Effect[] = [];                         // pending processing
    private processing = false;

    // Indexes
    private byEntity = new Map<string, Set<string>>();    // entity_id → origin_ids
    private byPhase = new Map<AssertionPhase, Set<string>>(); // phase → origin_ids
    private stateWatchers = new Map<string, Set<string>>();    // "entity:attr" → watching effect origin_ids
    private predicateSatisfaction = new Map<string, boolean>(); // "effectId:entity:attr" → currently satisfied?
    
    // Space-Time Index
    public hexIndex: HexIndex<Effect> = createHexIndex<Effect>();

    // Pluggable processors
    private processors = new Map<string, PhaseProcessor>();
    private propagationHandler: PropagationHandler | null = null;
    private mergeHandler: MergeHandler | null = null;

    // Listeners
    private listeners: StreamListener[] = [];

    constructor(private now: () => Date = () => new Date()) {}

    // =========================================================================
    // CONFIGURATION
    // =========================================================================

    /**
     * Register a processor for a specific phase transition.
     * Key format: "from→to" (e.g., "projected→pending", "pending→accepted").
     * Use "*→pending" to match any source phase transitioning to pending.
     */
    on(transition: string, processor: PhaseProcessor): this {
        this.processors.set(transition, processor);
        return this;
    }

    /** Set the handler for dependency propagation. */
    onPropagation(handler: PropagationHandler): this {
        this.propagationHandler = handler;
        return this;
    }

    /** Set the handler for composite effect merging. */
    onMerge(handler: MergeHandler): this {
        this.mergeHandler = handler;
        return this;
    }

    /** Subscribe to stream events. Returns unsubscribe function. */
    subscribe(listener: StreamListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // =========================================================================
    // SUBMIT — Entry point for new effects
    // =========================================================================

    /**
     * Submit a new effect into the stream.
     * It will be stored and queued for processing.
     */
    submit(effect: Effect): Effect {
        this.store(effect);
        this.index(effect);

        // Initialize predicate satisfaction for new effects
        for (const pred of effect.predicates) {
            const derived = derive(this, pred.entity_id, pred.attribute);
            const satisfied = evaluateSinglePredicate(pred, derived.value);
            const key = `${effect.origin_id}:${stateKey(pred.entity_id, pred.attribute)}`;
            this.predicateSatisfaction.set(key, satisfied);
        }

        this.queue.push(effect);
        this.emit({ type: 'submitted', effect });

        // If submitted as already accepted, propagate to state watchers
        if (currentPhase(effect) === 'accepted') {
            this.propagate(effect);
        }

        this.drain();
        return effect;
    }

    /**
     * Submit a composite effect, merging its constituents.
     */
    submitComposite(composite: CompositeEffect): CompositeEffect {
        const constituents = composite.composed_of
            .map(id => this.latest(id))
            .filter((e): e is Effect => e !== undefined);

        if (this.mergeHandler && constituents.length > 0) {
            const merged = this.mergeHandler(
                constituents,
                composite.merge_strategy,
                composite.merge_rule,
            );
            // Replace deltas with merged result
            (composite as any).deltas = merged.length > 0 ? merged : composite.deltas;
        }

        this.store(composite);
        this.index(composite);
        this.queue.push(composite);
        this.emit({ type: 'composed', composite, constituents });
        this.drain();
        return composite;
    }

    // =========================================================================
    // ASSERT — Advance an effect's lifecycle
    // =========================================================================

    /**
     * Assert a new phase for an effect. Creates a new version with the
     * assertion appended. Returns the updated effect.
     */
    assert(
        originId: string,
        entry: Omit<AssertionEntry, 'at'> & { at?: Date },
    ): Effect {
        const current = this.latest(originId);
        if (!current) throw new Error(`Effect ${originId} not found`);

        const fromPhase = currentPhase(current);
        const newEntry: AssertionEntry = {
            ...entry,
            at: entry.at ?? this.now(),
        };

        const next: Effect = {
            ...current,
            version: current.version + 1,
            assertion_log: [...current.assertion_log, newEntry],
        };

        this.store(next);
        this.reindex(next);
        this.emit({ type: 'phase_changed', effect: next, from: fromPhase, to: newEntry.phase });

        // Propagate to dependents
        this.propagate(next);

        return next;
    }

    // =========================================================================
    // QUERIES
    // =========================================================================

    /** Get the latest version of an effect by origin_id. */
    latest(originId: string): Effect | undefined {
        const versions = this.effects.get(originId);
        return versions?.[versions.length - 1];
    }

    /** Get all versions of an effect. */
    versions(originId: string): Effect[] {
        return this.effects.get(originId) ?? [];
    }

    /** Get a specific version. */
    version(originId: string, version: number): Effect | undefined {
        return this.effects.get(originId)?.[version];
    }

    /** Get all effects currently in a given phase. */
    inPhase(phase: AssertionPhase): Effect[] {
        const ids = this.byPhase.get(phase);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => this.latest(id))
            .filter((e): e is Effect => e !== undefined);
    }

    /** Get all effects targeting a specific entity. */
    forEntity(entityId: string): Effect[] {
        const ids = this.byEntity.get(entityId);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => this.latest(id))
            .filter((e): e is Effect => e !== undefined);
    }

    /** Get effects watching a specific entity+attribute state. */
    watchersOf(entityId: string, attribute: string): Effect[] {
        const key = stateKey(entityId, attribute);
        const ids = this.stateWatchers.get(key);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => this.latest(id))
            .filter((e): e is Effect => e !== undefined);
    }

    /** All effects (latest versions). */
    all(): Effect[] {
        return Array.from(this.effects.keys())
            .map(id => this.latest(id))
            .filter((e): e is Effect => e !== undefined);
    }

    /** Queue depth. */
    get pending(): number {
        return this.queue.length;
    }

    // =========================================================================
    // PROCESSING — Drain the queue through registered processors
    // =========================================================================

    /**
     * Manually trigger processing of the queue.
     * Normally called automatically on submit, but can be called
     * after registering new processors to reprocess.
     */
    async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        try {
            while (this.queue.length > 0) {
                const effect = this.queue.shift()!;
                await this.process(effect);
            }
        } finally {
            this.processing = false;
        }
    }

    private async process(effect: Effect): Promise<void> {
        const phase = currentPhase(effect);
        const ctx: ProcessorContext = { stream: this, now: this.now };

        // Try specific transition processors first, then wildcard
        const transitions = this.possibleTransitions(phase);

        for (const to of transitions) {
            const key = `${phase}→${to}`;
            const wildcard = `*→${to}`;
            const processor = this.processors.get(key) ?? this.processors.get(wildcard);

            if (processor) {
                try {
                    const entry = await processor(effect, ctx);
                    if (entry) {
                        // Processor returned an assertion — apply it
                        const updated = this.assert(effect.origin_id, entry);
                        // Re-queue the updated effect for further processing
                        this.queue.push(updated);
                        return; // only one transition per processing step
                    }
                } catch (err) {
                    this.emit({
                        type: 'error',
                        effect_id: effect.origin_id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
    }

    private possibleTransitions(from: AssertionPhase): AssertionPhase[] {
        switch (from) {
            case 'projected': return ['pending'];
            case 'pending': return ['accepted', 'rejected', 'modified'];
            case 'accepted': return ['retracted'];
            case 'modified': return ['retracted'];
            case 'rejected': return [];     // terminal
            case 'retracted': return [];    // terminal
        }
    }

    // =========================================================================
    // PROPAGATION
    // =========================================================================

    private async propagate(changed: Effect): Promise<void> {
        // Identify which entity+attribute pairs this effect's deltas touch
        const touchedKeys = new Set<string>();
        for (const delta of changed.deltas) {
            touchedKeys.add(stateKey(delta.entity_id, delta.attribute));
        }

        // For each touched state, re-derive and evaluate watchers' predicates
        for (const key of touchedKeys) {
            const separatorIndex = key.indexOf(':');
            const entityId = key.slice(0, separatorIndex);
            const attribute = key.slice(separatorIndex + 1);

            const watchers = this.watchersOf(entityId, attribute);
            if (watchers.length === 0) continue;

            const derivedValue = derive(this, entityId, attribute);
            const actions = evaluatePredicates(
                entityId, attribute, derivedValue, watchers, this.predicateSatisfaction,
            );

            for (const action of actions) {
                const target = this.latest(action.origin_id);
                if (!target) continue;

                this.emit({ type: 'propagation', action, source: changed, target });

                if (this.propagationHandler) {
                    const ctx: ProcessorContext = { stream: this, now: this.now };
                    await this.propagationHandler(action, changed, target, ctx);
                }
            }
        }
    }

    // =========================================================================
    // STORAGE & INDEXING
    // =========================================================================

    private store(effect: Effect): void {
        const versions = this.effects.get(effect.origin_id) ?? [];
        versions.push(effect);
        this.effects.set(effect.origin_id, versions);
    }

    private index(effect: Effect): void {
        // Entity index
        for (const delta of effect.deltas) {
            const set = this.byEntity.get(delta.entity_id) ?? new Set();
            set.add(effect.origin_id);
            this.byEntity.set(delta.entity_id, set);
        }

        // Phase index
        const phase = currentPhase(effect);
        const phaseSet = this.byPhase.get(phase) ?? new Set();
        phaseSet.add(effect.origin_id);
        this.byPhase.set(phase, phaseSet);

        // State watcher index
        for (const pred of effect.predicates) {
            const key = stateKey(pred.entity_id, pred.attribute);
            const set = this.stateWatchers.get(key) ?? new Set();
            set.add(effect.origin_id);
            this.stateWatchers.set(key, set);
        }

        // Spatial-Temporal index
        // Extract basic availability and location to properly index
        if (effect.envelope.spatial || effect.envelope.temporal) {
            addItemToHexIndex(
                this.hexIndex,
                effect,
                effect.origin_id,
                {
                    lat: effect.envelope.spatial?.latitude,
                    lon: effect.envelope.spatial?.longitude,
                    h3_index: effect.envelope.spatial?.h3_index,
                },
                {},
                effect.envelope.temporal?.availability_window,
            );
        }
    }

    private reindex(effect: Effect): void {
        // Update phase index: remove from old, add to new
        const phase = currentPhase(effect);
        for (const [p, ids] of this.byPhase.entries()) {
            if (p !== phase) ids.delete(effect.origin_id);
        }
        const phaseSet = this.byPhase.get(phase) ?? new Set();
        phaseSet.add(effect.origin_id);
        this.byPhase.set(phase, phaseSet);
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    private async emit(event: StreamEvent): Promise<void> {
        for (const listener of this.listeners) {
            try {
                await listener(event);
            } catch {
                // listeners should not crash the stream
            }
        }
    }

    // =========================================================================
    // MANAGEMENT
    // =========================================================================

    clear(): void {
        this.effects.clear();
        this.queue = [];
        this.byEntity.clear();
        this.byPhase.clear();
        this.stateWatchers.clear();
        this.predicateSatisfaction.clear();
        this.hexIndex = createHexIndex<Effect>();
    }
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const effectStream = new EffectStream();
