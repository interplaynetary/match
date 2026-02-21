/**
 * Observer — EconomicEvent-based resource state derivation.
 *
 * The Observer IS the stockbook. It:
 *   1. Receives EconomicEvents (immutable observed facts)
 *   2. Applies action effects to derive EconomicResource state (inventory)
 *   3. Tracks batch/lot records for produced resources
 *   4. Tracks fulfillment of Commitments OR satisfaction of Intents (never both)
 *   5. Emits stream events for listeners
 *
 * VF rule: An event either `fulfills` a Commitment OR `satisfies` an Intent
 * directly (when no Commitment exists), never both.
 *
 * Resources are DERIVED from events. Current state can always be
 * recalculated by replaying events in order.
 */

import { nanoid } from 'nanoid';
import {
    type EconomicEvent,
    type EconomicResource,
    type Commitment,
    type Intent,
    type Process,
    type Agreement,
    type Measure,
    type VfAction,
    type ActionDefinition,
    type BatchLotRecord,
    ACTION_DEFINITIONS,
} from '../schemas';
import { ProcessRegistry } from '../process-registry';

// =============================================================================
// STREAM EVENTS — What the observer emits
// =============================================================================

export type ObserverEvent =
    | { type: 'recorded'; event: EconomicEvent }
    | { type: 'resource_created'; resource: EconomicResource; event: EconomicEvent }
    | { type: 'resource_updated'; resource: EconomicResource; event: EconomicEvent; changes: string[] }
    | { type: 'batch_created'; batch: BatchLotRecord; resource: EconomicResource; event: EconomicEvent }
    | { type: 'fulfilled'; event: EconomicEvent; commitmentId: string }
    | { type: 'satisfied'; event: EconomicEvent; intentId: string }
    | { type: 'error'; eventId: string; error: string };

export type ObserverListener = (event: ObserverEvent) => void | Promise<void>;

// =============================================================================
// FULFILLMENT / SATISFACTION TRACKING
// =============================================================================

export interface FulfillmentState {
    commitmentId: string;
    totalCommitted: Measure;
    totalFulfilled: Measure;
    fulfillingEvents: string[];
    finished: boolean;
}

export interface SatisfactionState {
    intentId: string;
    totalDesired: Measure;
    totalSatisfied: Measure;
    satisfyingEvents: string[];
    satisfyingCommitments: string[];
    finished: boolean;
}

// =============================================================================
// INVENTORY VIEW
// =============================================================================

export interface InventoryEntry {
    resource: EconomicResource;
    spec: string;           // conformsTo (ResourceSpecification ID)
    accountingQty: number;
    onhandQty: number;
    unit: string;
    location?: string;
    accountable?: string;   // Agent ID
    batches: BatchLotRecord[];
}

// =============================================================================
// OBSERVER
// =============================================================================

export class Observer {
    // Storage
    private events: EconomicEvent[] = [];
    private resources = new Map<string, EconomicResource>();
    private batches = new Map<string, BatchLotRecord>();       // batchId → record
    private resourceBatches = new Map<string, string[]>();     // resourceId → batchIds

    // Shared process registry (same instances as planning layer)
    readonly processes: ProcessRegistry;

    // Fulfillment/Satisfaction tracking
    private fulfillments = new Map<string, FulfillmentState>();
    private satisfactions = new Map<string, SatisfactionState>();

    // Indexes
    private eventsByResource = new Map<string, string[]>();
    private eventsByProcess = new Map<string, string[]>();
    private eventsByAgent = new Map<string, string[]>();
    private eventsByAction = new Map<VfAction, string[]>();
    private eventsById = new Map<string, EconomicEvent>();

    // Listeners
    private listeners: ObserverListener[] = [];

    constructor(
        processRegistry?: ProcessRegistry,
        private generateId: () => string = () => nanoid(),
    ) {
        this.processes = processRegistry ?? new ProcessRegistry(generateId);
    }

    // =========================================================================
    // SUBSCRIBE
    // =========================================================================

    subscribe(listener: ObserverListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // =========================================================================
    // RECORD — Entry point for new economic events
    // =========================================================================

    /**
     * Record an observed economic event.
     *
     * VF rule: an event must target either fulfills (Commitment) or
     * satisfies (Intent), never both. If both are set, the event is rejected.
     *
     * @returns Affected EconomicResources, or throws on validation error.
     */
    record(event: EconomicEvent): EconomicResource[] {
        // --- Validation ---
        const hasFulfills = !!event.fulfills;
        const hasSatisfies = !!event.satisfies;
        if (hasFulfills && hasSatisfies) {
            const error = `Event ${event.id}: cannot both fulfill a Commitment and satisfy an Intent. Target one or the other.`;
            this.emit({ type: 'error', eventId: event.id, error });
            throw new Error(error);
        }

        // --- Correction handling ---
        if (event.corrects) {
            this.applyCorrection(event);
        }

        // --- Breadcrumbs for track/trace ---
        // When an event references a resource, chain the previousEvent pointers
        if (event.resourceInventoriedAs) {
            const resource = this.resources.get(event.resourceInventoriedAs);
            if (resource) {
                event.previousEvent = resource.previousEvent;
                resource.previousEvent = event.id;
            }
        }

        // Store
        this.events.push(event);
        this.eventsById.set(event.id, event);
        this.indexEvent(event);
        this.emit({ type: 'recorded', event });

        // Apply action effects to resources
        const affected = this.applyEffects(event);

        // Track fulfillment or satisfaction (mutually exclusive)
        if (hasFulfills) {
            this.trackFulfillment(event);
        } else if (hasSatisfies) {
            this.trackSatisfaction(event);
        }

        return affected;
    }

    // =========================================================================
    // REGISTRATION — Register planning constructs for tracking
    // =========================================================================

    registerCommitment(commitment: Commitment): void {
        const qty = commitment.resourceQuantity ?? commitment.effortQuantity;
        if (!qty) return;
        this.fulfillments.set(commitment.id, {
            commitmentId: commitment.id,
            totalCommitted: { ...qty },
            totalFulfilled: { hasNumericalValue: 0, hasUnit: qty.hasUnit },
            fulfillingEvents: [],
            finished: false,
        });
    }

    registerIntent(intent: Intent): void {
        const qty = intent.resourceQuantity ?? intent.effortQuantity;
        if (!qty) return;
        this.satisfactions.set(intent.id, {
            intentId: intent.id,
            totalDesired: { ...qty },
            totalSatisfied: { hasNumericalValue: 0, hasUnit: qty.hasUnit },
            satisfyingEvents: [],
            satisfyingCommitments: [],
            finished: false,
        });
    }

    registerProcess(process: Omit<Process, 'id'> & { id?: string }): Process {
        return this.processes.register(process);
    }

    /**
     * Seed a resource (e.g. initial inventory bootstrap).
     * Normally resources are created by events.
     */
    seedResource(resource: EconomicResource): void {
        this.resources.set(resource.id, { ...resource });
    }

    // =========================================================================
    // ACTION EFFECTS — Apply event effects to resources
    // =========================================================================

    private applyEffects(event: EconomicEvent): EconomicResource[] {
        const def = ACTION_DEFINITIONS[event.action];
        const affected: EconomicResource[] = [];

        // --- "from" resource (resourceInventoriedAs) ---
        if (event.resourceInventoriedAs) {
            let resource = this.resources.get(event.resourceInventoriedAs);

            if (!resource && def.createResource === 'optional') {
                resource = this.createResource(event, event.resourceInventoriedAs);
                this.emit({ type: 'resource_created', resource, event });

                // Create batch if this is a produce event
                if (event.action === 'produce') {
                    this.createBatch(resource, event);
                }
            }

            if (resource) {
                const changes = this.applyResourceEffects(resource, event, def, 'from');
                if (changes.length > 0) {
                    this.emit({ type: 'resource_updated', resource, event, changes });
                }
                affected.push(resource);
            }
        }

        // --- "to" resource (toResourceInventoriedAs) ---
        if (event.toResourceInventoriedAs) {
            let toResource = this.resources.get(event.toResourceInventoriedAs);

            if (!toResource && (def.createResource === 'optionalTo' || def.createResource === 'optional')) {
                toResource = this.createResource(event, event.toResourceInventoriedAs);
                this.emit({ type: 'resource_created', resource: toResource, event });
            }

            if (toResource) {
                const changes = this.applyResourceEffects(toResource, event, def, 'to');
                if (changes.length > 0) {
                    this.emit({ type: 'resource_updated', resource: toResource, event, changes });
                }
                affected.push(toResource);
            }
        }

        return affected;
    }

    private createResource(event: EconomicEvent, id: string): EconomicResource {
        const unit = event.resourceQuantity?.hasUnit ?? 'each';
        const resource: EconomicResource = {
            id,
            conformsTo: event.resourceConformsTo ?? '',
            classifiedAs: event.resourceClassifiedAs,
            accountingQuantity: { hasNumericalValue: 0, hasUnit: unit },
            onhandQuantity: { hasNumericalValue: 0, hasUnit: unit },
            primaryAccountable: event.receiver,
            currentLocation: event.toLocation,
            state: event.state,
        };
        this.resources.set(id, resource);
        return resource;
    }

    /**
     * Create a batch/lot record for a produced resource.
     */
    private createBatch(resource: EconomicResource, event: EconomicEvent): void {
        const batchId = this.generateId();
        const batch: BatchLotRecord = {
            id: batchId,
            batchLotCode: `batch-${event.hasPointInTime ?? new Date().toISOString()}-${batchId.slice(0, 6)}`,
        };
        this.batches.set(batchId, batch);

        const existing = this.resourceBatches.get(resource.id) ?? [];
        existing.push(batchId);
        this.resourceBatches.set(resource.id, existing);

        // Link batch to resource
        resource.lot = batch;

        this.emit({ type: 'batch_created', batch, resource, event });
    }

    private applyResourceEffects(
        resource: EconomicResource,
        event: EconomicEvent,
        def: ActionDefinition,
        direction: 'from' | 'to',
    ): string[] {
        const changes: string[] = [];
        const qty = event.resourceQuantity?.hasNumericalValue ?? 0;

        // --- Accounting quantity ---
        if (def.accountingEffect !== 'noEffect' && resource.accountingQuantity) {
            const shouldApply =
                (def.accountingEffect === 'increment' && direction === 'from') ||
                (def.accountingEffect === 'decrement' && direction === 'from') ||
                (def.accountingEffect === 'decrementIncrement') ||
                (def.accountingEffect === 'incrementTo' && direction === 'to');

            if (shouldApply) {
                const sign =
                    (def.accountingEffect === 'decrement') ? -1 :
                    (def.accountingEffect === 'decrementIncrement' && direction === 'from') ? -1 :
                    1;
                resource.accountingQuantity.hasNumericalValue += sign * qty;
                changes.push(`accountingQuantity:${sign > 0 ? 'increment' : 'decrement'}`);
            }
        }

        // --- Onhand quantity ---
        if (def.onhandEffect !== 'noEffect' && resource.onhandQuantity) {
            const shouldApply =
                (def.onhandEffect === 'increment' && direction === 'from') ||
                (def.onhandEffect === 'decrement' && direction === 'from') ||
                (def.onhandEffect === 'decrementIncrement') ||
                (def.onhandEffect === 'incrementTo' && direction === 'to');

            if (shouldApply) {
                const sign =
                    (def.onhandEffect === 'decrement') ? -1 :
                    (def.onhandEffect === 'decrementIncrement' && direction === 'from') ? -1 :
                    1;
                resource.onhandQuantity.hasNumericalValue += sign * qty;
                changes.push(`onhandQuantity:${sign > 0 ? 'increment' : 'decrement'}`);
            }
        }

        // --- Location ---
        if (event.toLocation) {
            if ((def.locationEffect === 'update' && direction === 'from') ||
                (def.locationEffect === 'updateTo' && direction === 'to') ||
                (def.locationEffect === 'new' && direction === 'from')) {
                resource.currentLocation = event.toLocation;
                changes.push('currentLocation');
            }
        }

        // --- Containment ---
        if (def.containedEffect === 'update' && direction === 'from' && event.toResourceInventoriedAs) {
            resource.containedIn = event.toResourceInventoriedAs;
            changes.push('containedIn');
        } else if (def.containedEffect === 'remove' && direction === 'from') {
            resource.containedIn = undefined;
            changes.push('containedIn:removed');
        }

        // --- Primary accountable ---
        if ((def.accountableEffect === 'new' && direction === 'from') ||
            (def.accountableEffect === 'updateTo' && direction === 'to')) {
            resource.primaryAccountable = event.receiver;
            changes.push('primaryAccountable');
        }

        // --- Stage (from process specification) ---
        if (def.stageEffect === 'update' && direction === 'from' && event.outputOf) {
            const process = this.processes.get(event.outputOf);
            if (process?.basedOn) {
                resource.stage = process.basedOn;
                changes.push('stage');
            }
        }

        // --- State ---
        if (event.state) {
            if ((def.stateEffect === 'update' && direction === 'from') ||
                (def.stateEffect === 'updateTo' && direction === 'to')) {
                resource.state = event.state;
                changes.push('state');
            }
        }

        return changes;
    }

    // =========================================================================
    // FULFILLMENT & SATISFACTION — mutually exclusive per event
    // =========================================================================

    private trackFulfillment(event: EconomicEvent): void {
        if (!event.fulfills) return;
        const commitmentId = event.fulfills;
        const state = this.fulfillments.get(commitmentId);
        if (!state) return;
        const qty = event.resourceQuantity ?? event.effortQuantity;
        if (qty) {
            state.totalFulfilled.hasNumericalValue += qty.hasNumericalValue;
        }
        state.fulfillingEvents.push(event.id);
        state.finished = state.totalFulfilled.hasNumericalValue >= state.totalCommitted.hasNumericalValue;
        this.emit({ type: 'fulfilled', event, commitmentId });
    }

    private trackSatisfaction(event: EconomicEvent): void {
        if (!event.satisfies) return;
        const intentId = event.satisfies;
        const state = this.satisfactions.get(intentId);
        if (!state) return;
        const qty = event.resourceQuantity ?? event.effortQuantity;
        if (qty) {
            state.totalSatisfied.hasNumericalValue += qty.hasNumericalValue;
        }
        state.satisfyingEvents.push(event.id);
        state.finished = state.totalSatisfied.hasNumericalValue >= state.totalDesired.hasNumericalValue;
        this.emit({ type: 'satisfied', event, intentId });
    }

    // =========================================================================
    // QUERIES — Events
    // =========================================================================

    getEvent(id: string): EconomicEvent | undefined {
        return this.eventsById.get(id);
    }

    allEvents(): EconomicEvent[] {
        return [...this.events];
    }

    eventsForResource(resourceId: string): EconomicEvent[] {
        const ids = this.eventsByResource.get(resourceId) ?? [];
        return ids.map(id => this.eventsById.get(id)!).filter(Boolean);
    }

    eventsForProcess(processId: string): EconomicEvent[] {
        const ids = this.eventsByProcess.get(processId) ?? [];
        return ids.map(id => this.eventsById.get(id)!).filter(Boolean);
    }

    eventsForAgent(agentId: string): EconomicEvent[] {
        const ids = this.eventsByAgent.get(agentId) ?? [];
        return ids.map(id => this.eventsById.get(id)!).filter(Boolean);
    }

    eventsWithAction(action: VfAction): EconomicEvent[] {
        const ids = this.eventsByAction.get(action) ?? [];
        return ids.map(id => this.eventsById.get(id)!).filter(Boolean);
    }

    // =========================================================================
    // QUERIES — Resources / Inventory
    // =========================================================================

    getResource(id: string): EconomicResource | undefined {
        return this.resources.get(id);
    }

    allResources(): EconomicResource[] {
        return Array.from(this.resources.values());
    }

    /**
     * Get inventory view — all resources grouped with quantities and batches.
     * This IS the stockbook: "what do we have?"
     */
    inventory(): InventoryEntry[] {
        return this.allResources().map(r => ({
            resource: r,
            spec: r.conformsTo,
            accountingQty: r.accountingQuantity?.hasNumericalValue ?? 0,
            onhandQty: r.onhandQuantity?.hasNumericalValue ?? 0,
            unit: r.accountingQuantity?.hasUnit ?? r.onhandQuantity?.hasUnit ?? 'each',
            location: r.currentLocation,
            accountable: r.primaryAccountable,
            batches: this.batchesForResource(r.id),
        }));
    }

    /**
     * Get inventory for a specific ResourceSpecification.
     */
    inventoryForSpec(specId: string): InventoryEntry[] {
        return this.inventory().filter(e => e.spec === specId);
    }

    /**
     * Get inventory at a specific location.
     */
    inventoryAtLocation(locationId: string): InventoryEntry[] {
        return this.inventory().filter(e => e.location === locationId);
    }

    /**
     * Get inventory held by a specific agent.
     */
    inventoryForAgent(agentId: string): InventoryEntry[] {
        return this.inventory().filter(e => e.accountable === agentId);
    }

    // =========================================================================
    // QUERIES — Batches
    // =========================================================================

    batchesForResource(resourceId: string): BatchLotRecord[] {
        const ids = this.resourceBatches.get(resourceId) ?? [];
        return ids.map(id => this.batches.get(id)!).filter(Boolean);
    }

    getBatch(batchId: string): BatchLotRecord | undefined {
        return this.batches.get(batchId);
    }

    // =========================================================================
    // QUERIES — Fulfillment / Satisfaction
    // =========================================================================

    getFulfillment(commitmentId: string): FulfillmentState | undefined {
        return this.fulfillments.get(commitmentId);
    }

    getSatisfaction(intentId: string): SatisfactionState | undefined {
        return this.satisfactions.get(intentId);
    }

    /**
     * Inverse query: get all events that fulfill a given Commitment.
     */
    fulfilledBy(commitmentId: string): EconomicEvent[] {
        return this.events.filter(e => e.fulfills === commitmentId);
    }

    /**
     * Inverse query: get all events that satisfy a given Intent.
     */
    satisfiedBy(intentId: string): EconomicEvent[] {
        return this.events.filter(e => e.satisfies === intentId);
    }

    /**
     * Inverse query: get all resources conforming to a given spec.
     */
    conformingResources(specId: string): EconomicResource[] {
        return this.allResources().filter(r => r.conformsTo === specId);
    }

    /**
     * Get events on a process that don't fulfill any commitment (unplanned work).
     */
    unplannedEvents(processId: string): EconomicEvent[] {
        return this.eventsForProcess(processId).filter(e => !e.fulfills);
    }

    /**
     * Record an unplanned exchange — two reciprocal events tied to an Agreement
     * without any prior Commitments. Uses `realizationOf` on the events.
     *
     * This is the VF pattern for point-of-sale / informal exchanges.
     */
    recordExchange(params: {
        agreement: Agreement;
        primaryEvent: EconomicEvent;
        reciprocalEvent: EconomicEvent;
    }): { primary: EconomicResource[]; reciprocal: EconomicResource[] } {
        params.primaryEvent.realizationOf = params.agreement.id;
        params.reciprocalEvent.realizationOf = params.agreement.id;
        const primary = this.record(params.primaryEvent);
        const reciprocal = this.record(params.reciprocalEvent);
        return { primary, reciprocal };
    }

    getProcess(id: string): Process | undefined {
        return this.processes.get(id);
    }

    // =========================================================================
    // DERIVED — Recompute resource from events
    // =========================================================================

    /**
     * Recompute a resource's state from scratch by replaying all its events.
     * Useful for verification, auditing, or after corrections.
     */
    recomputeResource(resourceId: string): EconomicResource | undefined {
        const events = this.eventsForResource(resourceId);
        if (events.length === 0) return undefined;

        const resource = this.resources.get(resourceId);
        if (!resource) return undefined;

        // Reset quantities
        if (resource.accountingQuantity) resource.accountingQuantity.hasNumericalValue = 0;
        if (resource.onhandQuantity) resource.onhandQuantity.hasNumericalValue = 0;

        // Replay (skip correction events — their originals are already negated)
        for (const event of events) {
            if (event.corrects) continue;
            const def = ACTION_DEFINITIONS[event.action];
            const direction =
                event.resourceInventoriedAs === resourceId ? 'from' :
                event.toResourceInventoriedAs === resourceId ? 'to' : null;
            if (direction) {
                this.applyResourceEffects(resource, event, def, direction);
            }
        }

        return resource;
    }

    /**
     * Apply a correction event.
     *
     * VF rule: original events are immutable. To fix a mistake,
     * record a correction event that references the original via `corrects`.
     * The Observer negates the original's effects, then applies the correction.
     */
    private applyCorrection(correctionEvent: EconomicEvent): void {
        const originalId = correctionEvent.corrects!;
        const original = this.eventsById.get(originalId);
        if (!original) return;

        // Negate the original event's effects on resources
        const def = ACTION_DEFINITIONS[original.action];
        if (original.resourceInventoriedAs) {
            const resource = this.resources.get(original.resourceInventoriedAs);
            if (resource) this.negateResourceEffects(resource, original, def, 'from');
        }
        if (original.toResourceInventoriedAs) {
            const resource = this.resources.get(original.toResourceInventoriedAs);
            if (resource) this.negateResourceEffects(resource, original, def, 'to');
        }
    }

    /**
     * Negate (reverse) the effects of an event on a resource.
     */
    private negateResourceEffects(
        resource: EconomicResource,
        event: EconomicEvent,
        def: ActionDefinition,
        direction: 'from' | 'to',
    ): void {
        const qty = def.eventQuantity === 'effortQuantity'
            ? event.effortQuantity : event.resourceQuantity;
        if (!qty) return;

        // Reverse the quantity effects
        const accountingEff = direction === 'to' && def.accountingEffect === 'noEffect'
            ? 'noEffect' : def.accountingEffect;
        const onhandEff = direction === 'to' && def.onhandEffect === 'noEffect'
            ? 'noEffect' : def.onhandEffect;

        if (accountingEff === 'increment' && resource.accountingQuantity) {
            resource.accountingQuantity.hasNumericalValue -= qty.hasNumericalValue;
        } else if (accountingEff === 'decrement' && resource.accountingQuantity) {
            resource.accountingQuantity.hasNumericalValue += qty.hasNumericalValue;
        }

        if (onhandEff === 'increment' && resource.onhandQuantity) {
            resource.onhandQuantity.hasNumericalValue -= qty.hasNumericalValue;
        } else if (onhandEff === 'decrement' && resource.onhandQuantity) {
            resource.onhandQuantity.hasNumericalValue += qty.hasNumericalValue;
        }
    }

    // =========================================================================
    // INTERNAL — Indexing
    // =========================================================================

    private indexEvent(event: EconomicEvent): void {
        if (event.resourceInventoriedAs) {
            this.appendIndex(this.eventsByResource, event.resourceInventoriedAs, event.id);
        }
        if (event.toResourceInventoriedAs) {
            this.appendIndex(this.eventsByResource, event.toResourceInventoriedAs, event.id);
        }
        if (event.inputOf) {
            this.appendIndex(this.eventsByProcess, event.inputOf, event.id);
        }
        if (event.outputOf) {
            this.appendIndex(this.eventsByProcess, event.outputOf, event.id);
        }
        this.appendIndex(this.eventsByAgent, event.provider, event.id);
        this.appendIndex(this.eventsByAgent, event.receiver, event.id);
        this.appendIndex(this.eventsByAction, event.action, event.id);
    }

    private appendIndex<K>(map: Map<K, string[]>, key: K, value: string): void {
        const list = map.get(key) ?? [];
        list.push(value);
        map.set(key, list);
    }

    // =========================================================================
    // INTERNAL — Event emission
    // =========================================================================

    private async emit(event: ObserverEvent): Promise<void> {
        for (const listener of this.listeners) {
            try {
                await listener(event);
            } catch {
                // listeners should not crash the observer
            }
        }
    }

    // =========================================================================
    // MANAGEMENT
    // =========================================================================

    clear(): void {
        this.events = [];
        this.resources.clear();
        this.processes.clear();
        this.batches.clear();
        this.resourceBatches.clear();
        this.fulfillments.clear();
        this.satisfactions.clear();
        this.eventsByResource.clear();
        this.eventsByProcess.clear();
        this.eventsByAgent.clear();
        this.eventsByAction.clear();
        this.eventsById.clear();
    }
}
