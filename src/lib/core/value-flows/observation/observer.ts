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
    type Claim,
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
    | { type: 'over_fulfilled'; event: EconomicEvent; commitmentId: string; overage: number }
    | { type: 'satisfied'; event: EconomicEvent; intentId: string }
    | { type: 'claim_settled'; event: EconomicEvent; claimId: string }
    | { type: 'process_completed'; processId: string }
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
    overFulfilled: boolean;
}

export interface SatisfactionState {
    intentId: string;
    totalDesired: Measure;
    totalSatisfied: Measure;
    satisfyingEvents: string[];
    satisfyingCommitments: string[];
    finished: boolean;
}

export interface ClaimState {
    claimId: string;
    totalClaimed: Measure;
    totalSettled: Measure;
    settlingEvents: string[];
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

    // Fulfillment/Satisfaction/Settlement tracking
    private fulfillments = new Map<string, FulfillmentState>();
    private satisfactions = new Map<string, SatisfactionState>();
    private claimStates = new Map<string, ClaimState>();

    // Entity stores (Claims and Agreements registered externally)
    private claims = new Map<string, Claim>();
    private agreements = new Map<string, Agreement>();

    // Extra indexes
    private commitmentsByAgreementMap = new Map<string, string[]>();
    private eventsByAgreementMap = new Map<string, string[]>();

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

        // Track claim settlement (independent of fulfills/satisfies)
        if (event.settles) {
            this.trackSettlement(event);
        }

        // Auto-finish a process when its last expected output is produced.
        // A process is finished when every output-type event has been recorded.
        const processId = event.outputOf;
        if (processId) {
            this.checkProcessCompletion(processId);
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
            overFulfilled: false,
        });
        // Link commitment to its satisfaction intent (I3)
        if (commitment.satisfies) {
            const sat = this.satisfactions.get(commitment.satisfies);
            if (sat && !sat.satisfyingCommitments.includes(commitment.id)) {
                sat.satisfyingCommitments.push(commitment.id);
            }
        }
        // Index commitment by its agreement (G3)
        if (commitment.clauseOf) {
            const list = this.commitmentsByAgreementMap.get(commitment.clauseOf) ?? [];
            list.push(commitment.id);
            this.commitmentsByAgreementMap.set(commitment.clauseOf, list);
        }
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

    registerClaim(claim: Claim): void {
        const qty = claim.resourceQuantity ?? claim.effortQuantity;
        if (!qty) return;
        // Store raw claim so it can be queried later (C1)
        this.claims.set(claim.id, claim);
        this.claimStates.set(claim.id, {
            claimId: claim.id,
            totalClaimed: { ...qty },
            totalSettled: { hasNumericalValue: 0, hasUnit: qty.hasUnit },
            settlingEvents: [],
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
        // Guard: same resource cannot be both source and destination (J2)
        if (
            event.resourceInventoriedAs &&
            event.toResourceInventoriedAs &&
            event.resourceInventoriedAs === event.toResourceInventoriedAs
        ) {
            this.emit({ type: 'error', eventId: event.id,
                error: `resourceInventoriedAs and toResourceInventoriedAs cannot be the same resource` });
            return [];
        }

        const def = ACTION_DEFINITIONS[event.action];
        const affected: EconomicResource[] = [];
        const affectedIds = new Set<string>();

        const addAffected = (r: EconomicResource) => {
            if (!affectedIds.has(r.id)) {
                affectedIds.add(r.id);
                affected.push(r);
            }
        };

        // --- Split-custody detection ---
        // VF spec (transfers.md §Implied Transfers): a pickup/dropoff with
        // toResourceInventoriedAs and different provider/receiver means the goods are
        // tracked in two separate inventory records (e.g. Alice's warehouse stock +
        // Trucker's bill-of-lading). We need to override the action definition for both
        // resources so the correct quantity and location effects are applied.
        const isSplitCustody =
            (event.action === 'pickup' || event.action === 'dropoff') &&
            !!event.toResourceInventoriedAs &&
            event.provider !== undefined &&
            event.receiver !== undefined &&
            event.provider !== event.receiver;

        // --- Capture container location before separate removes containedIn ---
        // separate.locationEffect = 'noEffect', but the separated resource should
        // inherit the container's physical location (it was just unpacked there).
        let containerLocationForSeparate: string | undefined;
        if (event.action === 'separate' && event.resourceInventoriedAs) {
            const existing = this.resources.get(event.resourceInventoriedAs);
            if (existing?.containedIn) {
                const container = this.resources.get(existing.containedIn);
                containerLocationForSeparate = container?.currentLocation;
            }
        }

        // --- "from" resource (resourceInventoriedAs) ---
        if (event.resourceInventoriedAs) {
            let resource = this.resources.get(event.resourceInventoriedAs);
            let fromIsNew = false;

            if (!resource && def.createResource === 'optional') {
                resource = this.createResource(event, event.resourceInventoriedAs);
                fromIsNew = true;
                this.emit({ type: 'resource_created', resource, event });

                // Create batch if this is a produce event
                if (event.action === 'produce') {
                    this.createBatch(resource, event);
                }
            }

            if (resource) {
                // Split-custody overrides for from-resource:
                //   pickup: provider's stock stays at origin — suppress location update
                //   dropoff: bill-of-lading is released — decrement (not increment) onhand
                const fromDef = isSplitCustody
                    ? (event.action === 'pickup'
                        ? { ...def, locationEffect: 'noEffect' as const }
                        : { ...def, onhandEffect: 'decrementIncrement' as const })
                    : def;
                const changes = this.applyResourceEffects(resource, event, fromDef, 'from', fromIsNew);
                if (changes.length > 0) {
                    this.emit({ type: 'resource_updated', resource, event, changes });
                }
                addAffected(resource);
            }
        }

        // --- "to" resource (toResourceInventoriedAs) ---
        if (event.toResourceInventoriedAs) {
            let toResource = this.resources.get(event.toResourceInventoriedAs);
            let toIsNew = false;

            // Split-custody also enables auto-creation of the to-resource (bill-of-lading
            // or receiver's stock), since pickup/dropoff normally have createResource:'noEffect'.
            if (!toResource && (def.createResource === 'optionalTo' || def.createResource === 'optional' || isSplitCustody)) {
                toResource = this.createResource(event, event.toResourceInventoriedAs);
                toIsNew = true;
                this.emit({ type: 'resource_created', resource: toResource, event });
            }

            if (toResource) {
                // Split-custody overrides for to-resource:
                //   pickup: bill-of-lading gets onhand increment + location (receiver has custody)
                //   dropoff: receiver's stock gets onhand increment + location (goods arrive)
                const toDef = isSplitCustody
                    ? { ...def, onhandEffect: 'decrementIncrement' as const, locationEffect: 'updateTo' as const }
                    : def;
                const changes = this.applyResourceEffects(toResource, event, toDef, 'to', toIsNew);
                if (changes.length > 0) {
                    this.emit({ type: 'resource_updated', resource: toResource, event, changes });
                }
                addAffected(toResource);
            }
        }

        // --- Implied Transfer (GAP-F) ---
        // VF spec: transfers.md §Implied Transfers
        // When provider ≠ receiver and the action implies a transfer of rights or custody,
        // update ownership metadata only. Quantity effects are NOT re-applied here — they
        // are fully captured by the primary action definition above (produce increments,
        // consume decrements, etc.). Re-applying the transfer action's quantity effects
        // would cancel or double the primary action's accounting changes.
        if (def.impliesTransfer && event.provider !== event.receiver && event.resourceInventoriedAs) {
            const fromResource = this.resources.get(event.resourceInventoriedAs);
            if (fromResource) {
                if (def.impliesTransfer === 'allRights') {
                    if (event.toResourceInventoriedAs) {
                        // Split inventory (two resource records): receiver owns the to-resource.
                        const toResource = this.resources.get(event.toResourceInventoriedAs);
                        if (toResource) {
                            toResource.primaryAccountable = event.receiver;
                            this.emit({ type: 'resource_updated', resource: toResource, event,
                                changes: ['implied:primaryAccountable'] });
                            addAffected(toResource);
                        }
                    } else {
                        // Inline rights transfer only applies to produce (receiver owns the new output).
                        // consume depletes the resource — transferring accountable on a depleting resource
                        // is a no-op and semantically incorrect.
                        if (event.action === 'produce') {
                            fromResource.primaryAccountable = event.receiver;
                            this.emit({ type: 'resource_updated', resource: fromResource, event,
                                changes: ['implied:primaryAccountable'] });
                            addAffected(fromResource);
                        }
                    }
                }
                // custody: split-custody effects (onhand + location) are already handled above
                // via isSplitCustody overrides. No additional ownership changes needed here.
            }
        }

        // --- Separate: apply location from container or explicit toLocation ---
        // separate.locationEffect = 'noEffect' so applyResourceEffects won't touch location.
        // Post-effects: set the separated resource's location so it isn't locationless.
        if (event.action === 'separate' && event.resourceInventoriedAs) {
            const resource = this.resources.get(event.resourceInventoriedAs);
            if (resource) {
                if (event.toLocation) {
                    resource.currentLocation = event.toLocation;
                } else if (containerLocationForSeparate !== undefined) {
                    resource.currentLocation = containerLocationForSeparate;
                }
            }
        }

        return affected;
    }

    private createResource(event: EconomicEvent, id: string): EconomicResource {
        const unit = event.resourceQuantity?.hasUnit ?? 'each';
        const conformsTo = event.resourceConformsTo ?? '';
        const resource: EconomicResource = {
            id,
            conformsTo,
            classifiedAs: event.resourceClassifiedAs,
            accountingQuantity: { hasNumericalValue: 0, hasUnit: unit },
            onhandQuantity: { hasNumericalValue: 0, hasUnit: unit },
            primaryAccountable: event.receiver,
            currentLocation: event.toLocation,
            state: event.state,
        };
        this.resources.set(id, resource);
        // Warn when no spec is provided — resource will be unclassifiable (J3)
        if (!conformsTo) {
            this.emit({ type: 'error', eventId: event.id,
                error: `auto-created resource '${id}' has no conformsTo; set resourceConformsTo on the event` });
        }
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
        isNew: boolean = false,
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
                (def.locationEffect === 'new' && isNew)) {
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
        if ((def.accountableEffect === 'new' && isNew) ||
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
        // Over-fulfillment detection (I1)
        if (state.totalFulfilled.hasNumericalValue > state.totalCommitted.hasNumericalValue) {
            const overage = state.totalFulfilled.hasNumericalValue - state.totalCommitted.hasNumericalValue;
            state.overFulfilled = true;
            this.emit({ type: 'over_fulfilled', event, commitmentId, overage });
        }
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

    private trackSettlement(event: EconomicEvent): void {
        if (!event.settles) return;
        const claimId = event.settles;
        const state = this.claimStates.get(claimId);
        if (!state) return;
        const qty = event.resourceQuantity ?? event.effortQuantity;
        if (qty) {
            state.totalSettled.hasNumericalValue += qty.hasNumericalValue;
        }
        state.settlingEvents.push(event.id);
        state.finished = state.totalSettled.hasNumericalValue >= state.totalClaimed.hasNumericalValue;
        this.emit({ type: 'claim_settled', event, claimId });
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
     *
     * By default, depleted resources (both accounting and onhand qty ≤ 0) are excluded.
     * Pass `{ includeEmpty: true }` to include them (e.g. for audit / tracing).
     */
    inventory(opts?: { includeEmpty?: boolean }): InventoryEntry[] {
        return this.allResources()
            .filter(r =>
                opts?.includeEmpty ||
                (r.accountingQuantity?.hasNumericalValue ?? 0) > 0 ||
                (r.onhandQuantity?.hasNumericalValue ?? 0) > 0,
            )
            .map(r => ({
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

    getClaimState(claimId: string): ClaimState | undefined {
        return this.claimStates.get(claimId);
    }

    /**
     * Inverse query: get all events that settle a given Claim.
     */
    settledBy(claimId: string): EconomicEvent[] {
        return this.events.filter(e => e.settles === claimId);
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

    // =========================================================================
    // QUERIES — Agreements and Claims
    // =========================================================================

    /**
     * Register an Agreement so it can be retrieved by ID.
     */
    registerAgreement(agreement: Agreement): void {
        this.agreements.set(agreement.id, agreement);
    }

    getAgreement(id: string): Agreement | undefined {
        return this.agreements.get(id);
    }

    /**
     * Get all economic events that realize a given Agreement.
     */
    eventsForAgreement(agreementId: string): EconomicEvent[] {
        return (this.eventsByAgreementMap.get(agreementId) ?? [])
            .map(id => this.eventsById.get(id)!)
            .filter(Boolean);
    }

    /**
     * Get all Claims that were triggered by a given EconomicEvent ID.
     */
    claimsTriggeredBy(eventId: string): Claim[] {
        return Array.from(this.claims.values()).filter(c => c.triggeredBy === eventId);
    }

    /**
     * Get all registered Claims.
     */
    allClaims(): Claim[] {
        return Array.from(this.claims.values());
    }

    // =========================================================================
    // QUERIES — Resource filters
    // =========================================================================

    /**
     * Get all resources physically contained in a given container resource.
     */
    resourcesContainedIn(containerId: string): EconomicResource[] {
        return this.allResources().filter(r => r.containedIn === containerId);
    }

    /**
     * Get all resources with a given state value.
     */
    resourcesByState(state: string): EconomicResource[] {
        return this.allResources().filter(r => r.state === state);
    }

    // =========================================================================
    // QUERIES — Skills
    // =========================================================================

    /**
     * All EconomicResources whose primaryAccountable is agentId.
     * Each resource represents one skill instance held by the agent.
     * Skill type convention: resource.conformsTo points to a ResourceSpecification
     * tagged with resourceClassifiedAs: ['skill'].
     */
    skillsOf(agentId: string): EconomicResource[] {
        return this.allResources().filter(r => r.primaryAccountable === agentId);
    }

    /**
     * Agent IDs that hold an EconomicResource conforming to the given skill spec.
     * Returns unique agent IDs (an agent may hold multiple resources of the same spec).
     */
    agentsWithSkill(specId: string): string[] {
        return [...new Set(
            this.allResources()
                .filter(r => r.conformsTo === specId && r.primaryAccountable)
                .map(r => r.primaryAccountable!),
        )];
    }

    // =========================================================================
    // QUERIES — Track / Trace
    // =========================================================================

    /**
     * Get events for a resource excluding those overridden by a correction.
     * An event is "corrected" when another event has `corrects === event.id`.
     */
    activeEventsForResource(resourceId: string): EconomicEvent[] {
        const all = this.eventsForResource(resourceId);
        const correctedIds = new Set(all.filter(e => e.corrects).map(e => e.corrects!));
        return all.filter(e => !correctedIds.has(e.id));
    }

    /**
     * Walk the previousEvent chain for a resource, returning events in
     * chronological order (oldest first).
     */
    traceResource(resourceId: string): EconomicEvent[] {
        const result: EconomicEvent[] = [];
        const resource = this.getResource(resourceId);
        let eventId: string | undefined = resource?.previousEvent;
        const seen = new Set<string>();
        while (eventId && !seen.has(eventId)) {
            seen.add(eventId);
            const event = this.eventsById.get(eventId);
            if (!event) break;
            result.unshift(event);
            eventId = event.previousEvent;
        }
        return result;
    }

    /**
     * Record an exchange — two or more reciprocal events tied to an Agreement.
     * Supports bilateral (2 events) and multilateral (3+ events in a cycle).
     *
     * Soft validation: emits `error` events (does not throw) for:
     *   - custody-only actions (pickup/dropoff/accept/modify): "don't make sense" per VF spec
     *   - provider === receiver on any flow: spec requires distinct agents
     *
     * Returns an array of affected-resource arrays, one per input event.
     */
    recordExchange(params: {
        agreement: Agreement;
        events: EconomicEvent[];
    }): EconomicResource[][] {
        // Auto-register agreement so it's queryable (G3 / M3)
        this.agreements.set(params.agreement.id, params.agreement);
        for (const event of params.events) {
            const def = ACTION_DEFINITIONS[event.action];
            if (!def.eligibleForExchange) {
                this.emit({ type: 'error', eventId: event.id,
                    error: `action '${event.action}' is custody-only and should not be part of an exchange` });
            }
            if (event.provider && event.receiver && event.provider === event.receiver) {
                this.emit({ type: 'error', eventId: event.id,
                    error: `exchange flow requires provider !== receiver` });
            }
            event.realizationOf = params.agreement.id;
        }
        return params.events.map(e => this.record(e));
    }

    getProcess(id: string): Process | undefined {
        return this.processes.get(id);
    }

    /**
     * Mark a process as finished if all its registered output Commitments are fulfilled.
     *
     * Called automatically after every output event is recorded.
     * A process is considered complete when every commitment that is outputOf it
     * has been fully fulfilled (totalFulfilled >= totalCommitted).
     */
    private checkProcessCompletion(processId: string): void {
        const process = this.processes.get(processId);
        if (!process || process.finished) return;

        // All fulfillment states whose fulfilling events are outputs of this process
        const trackedOutputFulfillments = Array.from(this.fulfillments.values()).filter(f =>
            f.fulfillingEvents.some(evId => this.eventsById.get(evId)?.outputOf === processId)
        );

        if (trackedOutputFulfillments.length > 0 && trackedOutputFulfillments.every(f => f.finished)) {
            this.processes.markFinished(processId);
            this.emit({ type: 'process_completed', processId });
        }
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
        if (!original) {
            this.emit({ type: 'error', eventId: correctionEvent.id,
                error: `correction target '${originalId}' not found` });
            return;
        }

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
        if (event.realizationOf) {
            this.appendIndex(this.eventsByAgreementMap, event.realizationOf, event.id);
        }
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
        this.claimStates.clear();
        this.claims.clear();
        this.agreements.clear();
        this.commitmentsByAgreementMap.clear();
        this.eventsByAgreementMap.clear();
        this.eventsByResource.clear();
        this.eventsByProcess.clear();
        this.eventsByAgent.clear();
        this.eventsByAction.clear();
        this.eventsById.clear();
    }
}
