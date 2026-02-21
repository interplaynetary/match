import { z } from 'zod';
import { NanoId } from '../primitives/ids';
import {
    TimeRangeSchema,
    AvailabilityWindowSchema,
} from '../primitives/time';

// =============================================================================
// DELTA — A single attribute transformation
// =============================================================================

export const DeltaOperation = z.enum([
    'set',       // replace value
    'add',       // numeric addition
    'subtract',  // numeric subtraction
    'multiply',  // numeric multiplication
    'append',    // add to array/set
    'remove',    // remove from array/set
]);
export type DeltaOperation = z.infer<typeof DeltaOperation>;

export const Delta = z.object({
    entity_id: z.string().min(1),
    attribute: z.string().min(1),
    operation: DeltaOperation,
    value: z.unknown(),
    /** Previous value, if known. Enables reversibility without log replay. */
    prior: z.unknown().optional(),
});
export type Delta = z.infer<typeof Delta>;

// =============================================================================
// ENVELOPE — Where and when an effect applies
// =============================================================================

/** Temporal component: one-time range, recurring window, or both. */
export const TemporalEnvelope = z.object({
    // One-time / bounded
    start: z.string().optional(),           // ISO datetime
    end: z.string().optional(),             // ISO datetime
    // Recurring — full AvailabilityWindow hierarchy
    availability_window: AvailabilityWindowSchema.optional(),
});
export type TemporalEnvelope = z.infer<typeof TemporalEnvelope>;

/** Spatial component: physical coordinates, h3 cell, or remote. */
export const SpatialEnvelope = z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radius_km: z.number().nonnegative().optional(),
    h3_index: z.string().optional(),
    h3_resolution: z.number().int().min(0).max(15).optional(),
    location_type: z.enum(['physical', 'remote', 'hybrid']).optional(),
    online_link: z.string().url().or(z.string().length(0)).optional(),
    street_address: z.string().optional(),
    city: z.string().optional(),
    state_province: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
});
export type SpatialEnvelope = z.infer<typeof SpatialEnvelope>;

export const Envelope = z.object({
    temporal: TemporalEnvelope.optional(),
    spatial: SpatialEnvelope.optional(),
});
export type Envelope = z.infer<typeof Envelope>;

// =============================================================================
// ASSERTION — Lifecycle phases (append-only log)
// =============================================================================

export const AssertionPhase = z.enum([
    'projected',   // future: we expect this to happen
    'pending',     // present: awaiting judgment
    'accepted',    // judged: happened as described
    'rejected',    // judged: did not happen
    'modified',    // judged: happened differently (new version created)
    'retracted',   // retroactive: previously accepted, now undone
]);
export type AssertionPhase = z.infer<typeof AssertionPhase>;

export const AssertionEntry = z.object({
    phase: AssertionPhase,
    at: z.coerce.date(),             // known_time: when this judgment was recorded
    by: z.string().min(1),           // who judged
    note: z.string().optional(),     // why
    supersedes: z.number().int().nonnegative().optional(), // which version this replaces
});
export type AssertionEntry = z.infer<typeof AssertionEntry>;

// =============================================================================
// STATE PREDICATE — What an effect assumes about derived state
// =============================================================================

export const DependencyBinding = z.enum(['hard', 'soft']);
export type DependencyBinding = z.infer<typeof DependencyBinding>;

/**
 * A condition on derived state. Effects don't depend on other effects —
 * they depend on state. The workshop doesn't care about "venue-effect-#47";
 * it cares that "venue availability >= 1."
 */
export const StatePredicate = z.object({
    entity_id: z.string().min(1),
    attribute: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    exact: z.unknown().optional(),
    binding: DependencyBinding,
    /** Human-readable description of what this predicate means. */
    label: z.string().optional(),
});
export type StatePredicate = z.infer<typeof StatePredicate>;

/** Index key for state watchers: "entity_id:attribute" */
export const stateKey = (entityId: string, attribute: string): string =>
    `${entityId}:${attribute}`;

// =============================================================================
// EFFECT — Atomic batch of transformations in a space-time envelope
// =============================================================================

export const Effect = z.object({
    origin_id: NanoId,              // stable identity — never changes across versions
    version: z.number().int().nonnegative(),
    author: z.string().min(1),      // who created this effect

    // What changes
    deltas: z.array(Delta).min(1),

    // Where/when
    envelope: Envelope,

    // Lifecycle (append-only)
    assertion_log: z.array(AssertionEntry).min(1),

    // State predicates — conditions on derived state that must hold
    predicates: z.array(StatePredicate).default([]),

    // Bitemporal bookkeeping
    recorded_at: z.coerce.date(),   // when the system first learned of this effect
    valid_from: z.string().optional(),  // ISO datetime: when the effect claims to start
    valid_until: z.string().optional(), // ISO datetime: when the effect claims to end
});
export type Effect = z.infer<typeof Effect>;

// =============================================================================
// COMPOSITE EFFECT — Emergent from multiple constituent effects
// =============================================================================

export const MergeStrategy = z.enum(['additive', 'overwrite', 'custom']);
export type MergeStrategy = z.infer<typeof MergeStrategy>;

export const CompositeEffect = Effect.extend({
    composed_of: z.array(NanoId).min(1),  // origin_ids of constituent effects
    merge_strategy: MergeStrategy,
    merge_rule: z.any().optional(),        // json-logic rule when strategy is 'custom'
});
export type CompositeEffect = z.infer<typeof CompositeEffect>;

// =============================================================================
// QUERIES — Helpers for reading effect state
// =============================================================================

/** Get the current (latest) assertion phase of an effect. */
export const currentPhase = (effect: Effect): AssertionPhase => {
    return effect.assertion_log[effect.assertion_log.length - 1]!.phase;
};

/** Is this effect currently considered active (projected or accepted)? */
export const isActive = (effect: Effect): boolean => {
    const phase = currentPhase(effect);
    return phase === 'projected' || phase === 'accepted';
};

/** Is this effect resolved (accepted, rejected, or retracted)? */
export const isResolved = (effect: Effect): boolean => {
    const phase = currentPhase(effect);
    return phase === 'accepted' || phase === 'rejected' || phase === 'retracted';
};

/** Was this effect retracted after being accepted? */
export const isRetracted = (effect: Effect): boolean => {
    return currentPhase(effect) === 'retracted';
};

/** Get the phase at a specific known_time (what did we believe then?). */
export const phaseAt = (effect: Effect, knownTime: Date): AssertionPhase | undefined => {
    let result: AssertionPhase | undefined;
    for (const entry of effect.assertion_log) {
        if (entry.at <= knownTime) {
            result = entry.phase;
        } else {
            break;
        }
    }
    return result;
};

// =============================================================================
// PROPAGATION — Evaluating state predicates when state changes
// =============================================================================

export type PropagationAction =
    | { type: 'invalidate'; origin_id: string; reason: string }
    | { type: 'degrade'; origin_id: string; risk: string };

/** Check a single predicate against a derived value. */
export const evaluateSinglePredicate = (
    pred: StatePredicate,
    value: unknown,
): boolean => {
    if (pred.exact !== undefined && value !== pred.exact) return false;
    if (pred.min !== undefined && (typeof value !== 'number' || value < pred.min)) return false;
    if (pred.max !== undefined && (typeof value !== 'number' || value > pred.max)) return false;
    return true;
};

/**
 * Evaluate state predicates for effects watching a given entity+attribute.
 * Only propagates on transition from satisfied → unsatisfied (avoids re-alarming).
 * Caller must persist the previouslySatisfied map across calls.
 */
export const evaluatePredicates = (
    entityId: string,
    attribute: string,
    derivedValue: { value: unknown },
    watchingEffects: Effect[],
    previouslySatisfied: Map<string, boolean>,
): PropagationAction[] => {
    const actions: PropagationAction[] = [];

    for (const effect of watchingEffects) {
        for (const pred of effect.predicates) {
            if (pred.entity_id !== entityId || pred.attribute !== attribute) continue;

            const satisfied = evaluateSinglePredicate(pred, derivedValue.value);
            const key = `${effect.origin_id}:${stateKey(pred.entity_id, pred.attribute)}`;
            const wasSatisfied = previouslySatisfied.get(key) ?? true;

            // Only propagate on transition: satisfied → unsatisfied
            if (wasSatisfied && !satisfied) {
                if (pred.binding === 'hard') {
                    actions.push({
                        type: 'invalidate',
                        origin_id: effect.origin_id,
                        reason: `State predicate broken: ${pred.entity_id}.${pred.attribute} = ${derivedValue.value}${pred.label ? ` — ${pred.label}` : ''}`,
                    });
                } else {
                    actions.push({
                        type: 'degrade',
                        origin_id: effect.origin_id,
                        risk: `State predicate degraded: ${pred.entity_id}.${pred.attribute} = ${derivedValue.value}${pred.label ? ` — ${pred.label}` : ''}`,
                    });
                }
            }

            previouslySatisfied.set(key, satisfied);
        }
    }

    return actions;
};
