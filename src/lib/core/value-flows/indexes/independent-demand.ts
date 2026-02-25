/**
 * Independent Demand Index
 *
 * An "independent demand" in VF is a need that exists on its own terms —
 * not derived from another process's requirements. It is either:
 *
 *   1. An open Intent (no satisfying Commitment exists yet)
 *   2. A Commitment marked with `independentDemandOf → Plan.id`
 *      (a terminal deliverable the whole supply chain is built to satisfy)
 *
 * This index is the VF translation of the `deficits` array in SPACE_TIME_PLAN.md.
 * It answers the questions the planning search algorithm needs at each H3 cell:
 *
 *   - "What is still needed here?" (cell_index → open Intent IDs)
 *   - "What type of thing is still needed?" (spec_index → open Intent IDs)
 *   - "What does this Plan commit to delivering?" (plan_demand_index → Commitment IDs)
 *   - "Which open demands are near this location?" (spatial_hierarchy, radius query)
 *
 * Contrast with IntentIndex: IntentIndex holds ALL Intents (for discovery/matching).
 * IndependentDemandIndex holds all non-finished Intents (open and fulfilled alike).
 * Use queryOpenDemands() to get only the open planning frontier.
 */

import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { intentToSpaceTimeContext, getSpaceTimeSignature, toDateKey, wrapDate } from '../utils/space-time-keys';
import { spatialThingToH3 } from '../utils/space'
import type { Intent, Commitment, EconomicEvent, SpatialThing } from '../schemas';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A demand slot — one per non-finished Intent.
 *
 * Wraps the Intent with derived demand metadata useful for planning:
 *   - fulfilled/remaining quantities (partial-fulfillment tracking)
 *   - h3Cell canonical address at the planning resolution
 *
 * Fully-satisfied slots (remaining=0) ARE present in the index.
 * Use queryOpenDemands() to filter down to the open planning frontier.
 */
export interface DemandSlot {
    intent_id: string;

    /** ResourceSpecification ID of the needed resource */
    spec_id?: string;

    /** VF action that would satisfy this demand (e.g. 'transfer', 'produce', 'work') */
    action: string;

    /** How much has already been fulfilled (sum of satisfying Commitments + Events) */
    fulfilled_quantity: number;
    fulfilled_hours: number;

    /** Quantity still needed = max(0, required - fulfilled) */
    remaining_quantity: number;
    remaining_hours: number;

    /** Original required quantities from the Intent */
    required_quantity: number;
    required_hours: number;

    /** H3 cell at the query resolution — canonical address for spatial joins */
    h3_cell?: string;

    /** ISO datetime — when the demand is due */
    due?: string;

    /** Provider/receiver agents if specified on the Intent */
    provider?: string;
    receiver?: string;
}

export interface IndependentDemandIndex {
    /**
     * ALL non-finished demand slots — one per non-finished Intent.
     * Fully-satisfied slots (remaining=0) ARE present.
     * Use queryOpenDemands() to filter down to the open planning frontier.
     */
    demands: Map<string, DemandSlot>;

    /**
     * Cell index — maps H3 cell (at build resolution) → Set<intentId>.
     * First entry point during the leaf-level planning step:
     *   "What demands exist at/near this cell?"
     */
    cell_index: Map<string, Set<string>>;

    /**
     * Spec index — maps ResourceSpecification ID → Set<intentId>.
     * Used to find what type of resource the demand is for:
     *   "Does this recipe's output match any open demand?"
     */
    spec_index: Map<string, Set<string>>;

    /**
     * Action index — maps VfAction → Set<intentId>.
     * Useful for separating work demands from resource demands:
     *   "Which open demands are for labor vs goods?"
     */
    action_index: Map<string, Set<string>>;

    /**
     * Plan demand index — maps Plan ID → Set<commitmentId>.
     * Tracks which Commitments have been marked as `independentDemandOf` a Plan.
     * Used for Plan completion reporting: what has the Plan committed to delivering?
     */
    plan_demand_index: Map<string, Set<string>>;

    /**
     * Space-time index — maps spaceTimeSig → Set<intentId>.
     * For fast lookup by combined location+time signature (same key space as
     * CommitmentIndex and IntentIndex, enabling cross-index joins).
     */
    space_time_index: Map<string, Set<string>>;

    /**
     * Spatial hierarchy over open DemandSlots.
     * Enables radius queries: "what demand exists within 5km of this cell?"
     * HexNode.items contains intentIds; resolve via demands.
     */
    spatial_hierarchy: HexIndex<DemandSlot>;
}

// =============================================================================
// BUILD
// =============================================================================

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

/**
 * Build the IndependentDemandIndex from Intents, Commitments, and observed Events.
 *
 * All non-finished Intents are included — both open and fully-satisfied.
 * Use queryOpenDemands() to get only the open planning frontier.
 *
 * @param intents     All Intents in scope (offers and requests both included)
 * @param commitments All Commitments (used to compute fulfilled quantities)
 * @param events      All EconomicEvents (used to compute fulfilled quantities)
 * @param locations   SpatialThing lookup for H3 indexing
 * @param h3Resolution H3 resolution for spatial bucketing (default 7 ≈ 1km²)
 */
export function buildIndependentDemandIndex(
    intents: Intent[],
    commitments: Commitment[],
    events: EconomicEvent[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): IndependentDemandIndex {
    const index: IndependentDemandIndex = {
        demands: new Map(),
        cell_index: new Map(),
        spec_index: new Map(),
        action_index: new Map(),
        plan_demand_index: new Map(),
        space_time_index: new Map(),
        spatial_hierarchy: createHexIndex<DemandSlot>(),
    };

    // --- Phase 1: compute fulfilled quantities per Intent ---

    // Partial fulfillment: sum quantities satisfied so far
    const fulfilledQty = new Map<string, number>();
    const fulfilledHours = new Map<string, number>();
    for (const c of commitments) {
        if (!c.satisfies) continue;
        const prev = fulfilledQty.get(c.satisfies) ?? 0;
        fulfilledQty.set(c.satisfies, prev + (c.resourceQuantity?.hasNumericalValue ?? 0));
        const prevH = fulfilledHours.get(c.satisfies) ?? 0;
        fulfilledHours.set(c.satisfies, prevH + (c.effortQuantity?.hasNumericalValue ?? 0));
    }
    for (const e of events) {
        if (!e.satisfies) continue;
        const prev = fulfilledQty.get(e.satisfies) ?? 0;
        fulfilledQty.set(e.satisfies, prev + (e.resourceQuantity?.hasNumericalValue ?? 0));
        const prevH = fulfilledHours.get(e.satisfies) ?? 0;
        fulfilledHours.set(e.satisfies, prevH + (e.effortQuantity?.hasNumericalValue ?? 0));
    }

    // --- Phase 2: build demand slots from all non-finished Intents ---

    for (const intent of intents) {
        // Skip finished Intents only
        if (intent.finished) continue;

        const requiredQty   = intent.resourceQuantity?.hasNumericalValue ?? 0;
        const requiredHours = intent.effortQuantity?.hasNumericalValue   ?? 0;
        const doneQty   = fulfilledQty.get(intent.id)   ?? 0;
        const doneHours = fulfilledHours.get(intent.id) ?? 0;

        const remainingQty   = Math.max(0, requiredQty   - doneQty);
        const remainingHours = Math.max(0, requiredHours - doneHours);

        // Build the spatial context
        const st = intent.atLocation ? locations.get(intent.atLocation) : undefined;
        const ctx = intentToSpaceTimeContext(intent, st, h3Resolution);
        const sig = getSpaceTimeSignature(ctx, h3Resolution);
        const h3Cell = st ? spatialThingToH3(st, h3Resolution) : undefined;

        const slot: DemandSlot = {
            intent_id:           intent.id,
            spec_id:             intent.resourceConformsTo,
            action:              intent.action,
            fulfilled_quantity:  doneQty,
            fulfilled_hours:     doneHours,
            required_quantity:   requiredQty,
            required_hours:      requiredHours,
            remaining_quantity:  remainingQty,
            remaining_hours:     remainingHours,
            h3_cell:             h3Cell,
            due:                 intent.due ?? intent.hasEnd ?? intent.hasPointInTime,
            provider:            intent.provider,
            receiver:            intent.receiver,
        };

        index.demands.set(intent.id, slot);

        addTo(index.cell_index,        h3Cell,                  intent.id);
        addTo(index.spec_index,        intent.resourceConformsTo, intent.id);
        addTo(index.action_index,      intent.action,            intent.id);
        addTo(index.space_time_index,  sig,                      intent.id);

        if (st && h3Cell) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                slot,
                intent.id,
                { lat: st.lat, lon: st.long, h3_index: h3Cell },
                {
                    quantity: remainingQty,
                    hours:    remainingHours,
                },
                intent.availability_window
                    ?? wrapDate(toDateKey(intent.hasBeginning ?? intent.hasPointInTime)),
            );
        }
    }

    // --- Phase 3: plan demand index (Commitments marked as independentDemandOf) ---

    for (const commitment of commitments) {
        if (commitment.independentDemandOf) {
            addTo(index.plan_demand_index, commitment.independentDemandOf, commitment.id);
        }
    }

    return index;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Demand slots for a given ResourceSpecification.
 * Core planning question: "what demand exists for this type of resource?"
 * Includes fully-satisfied slots; wrap with queryOpenDemands() if needed.
 */
export function queryDemandBySpec(
    index: IndependentDemandIndex,
    specId: string,
): DemandSlot[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.demands.get(id)!).filter(Boolean);
}

/**
 * Demand slots by VF action.
 * E.g. "find all work demands" → queryDemandByAction(index, 'work')
 */
export function queryDemandByAction(
    index: IndependentDemandIndex,
    action: string,
): DemandSlot[] {
    const ids = index.action_index.get(action) ?? new Set<string>();
    return [...ids].map(id => index.demands.get(id)!).filter(Boolean);
}

/**
 * Demand slots near a location.
 * Used during the leaf-level step: "what demands are in this H3 cell or nearby?"
 */
export function queryDemandByLocation(
    index: IndependentDemandIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): DemandSlot[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.demands.get(id)!).filter(Boolean);
}

/**
 * Intersection: demand for a specific spec near a location.
 * The primary leaf-level query: "can this recipe's output satisfy local demand?"
 */
export function queryDemandBySpecAndLocation(
    index: IndependentDemandIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): DemandSlot[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.demands.get(id)!)
        .filter(Boolean);
}

/**
 * All Commitment IDs that are independent demands of a given Plan.
 * Used for Plan completion tracking: "what has this Plan committed to delivering?"
 */
export function queryPlanDemands(
    index: IndependentDemandIndex,
    planId: string,
): string[] {
    return [...(index.plan_demand_index.get(planId) ?? new Set<string>())];
}

/**
 * Raw HexNode for a cell — gives aggregated stats (count, sum quantity/hours)
 * and the full DemandSlot objects for that cell.
 * Stats reflect remaining (not required) quantities, so fulfilled demand
 * contributes zero to the aggregate.
 */
export function queryDemandByHex(
    index: IndependentDemandIndex,
    cell: string,
): HexNode<DemandSlot> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}

/**
 * Demand slots with outstanding requirements — the open planning frontier.
 *
 * A slot is open when at least one specified dimension has remaining > 0,
 * OR when no quantity was specified (pure action demand).
 *
 * This is the equivalent of what was previously guaranteed by the index itself
 * (only unsatisfied Intents appeared). Now the index is complete and this
 * function provides the filtered view for callers that need it.
 */
export function queryOpenDemands(index: IndependentDemandIndex): DemandSlot[] {
    return [...index.demands.values()].filter(s =>
        s.remaining_quantity > 0 ||
        s.remaining_hours > 0 ||
        (s.required_quantity === 0 && s.required_hours === 0),
    );
}

/**
 * Total remaining quantity across demand slots (for a given spec, or all).
 * Analogous to getTotalAgentHours in AgentIndex.
 */
export function getTotalDemandQuantity(slots: DemandSlot[]): number {
    return slots.reduce((sum, s) => sum + s.remaining_quantity, 0);
}

export function getTotalDemandHours(slots: DemandSlot[]): number {
    return slots.reduce((sum, s) => sum + s.remaining_hours, 0);
}
