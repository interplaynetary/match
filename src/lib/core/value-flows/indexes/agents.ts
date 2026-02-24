/**
 * Agent Capacity Index
 *
 * Mirrors the LaborIndex pattern from commons/indexes/labor.ts but built
 * from VF types (Intent + Agent) rather than Person.
 *
 * Core insight: a VF agent may publish multiple `work` Intents for the same
 * space-time window — one per ResourceSpecification (skill). Naively summing
 * their effortQuantity double-counts their capacity. This index collapses all
 * same-context work Intents from the same agent into a single AgentCapacity
 * node, preserving:
 *   - total_hours = max(effortQuantity) across the group (conservative dedup)
 *   - resource_specs = union of all ResourceSpecification IDs (the "skills")
 *   - start_date / end_date (temporal availability, analogous to availability_window)
 *   - spatial location (for H3 hierarchy)
 *
 * The spec_index (skill index) maps specId → Set<capacityId> — references only,
 * no duplication. Summing total_hours from a spec query is safe.
 */

import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius, queryHexOnDate,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { getSpaceTimeSignature, intentToSpaceTimeContext } from '../utils/space-time-keys';
import { hoursInWindowOnDate, type TemporalExpression } from '../utils/time';
import { spatialThingToH3 } from '../utils/space';
import type { Agent, Intent, SpatialThing, Commitment } from '../schemas';

// =============================================================================
// TYPES
// =============================================================================

/**
 * AgentCapacity — the atomic unit of an agent's labor supply in one space-time context.
 *
 * Analogous to PersonCapacity in LaborIndex.
 *
 * ONE record per (agent, space_time_signature). Multiple work Intents from the
 * same agent in the same space-time window collapse here rather than creating
 * separate records. This prevents double-counting when querying by skill.
 */
export interface AgentCapacity {
    /** Unique ID: `${agent_id}|${space_time_signature}` */
    id: string;

    agent_id: string;
    space_time_signature: string;

    /**
     * Total hours this agent can supply in this context.
     *
     * = max(effortQuantity.hasNumericalValue) across all work Intents that
     *   share this (agent, space_time_signature). Conservative deduplication:
     *   assumes Intents with the same space-time context share a single capacity
     *   pool (the agent can do any of these skills, not all simultaneously).
     */
    total_hours: number;

    /**
     * All ResourceSpecification IDs (skills) offered by this agent in this
     * context. These are the union of resourceConformsTo values across the
     * contributing Intents. The spec_index references this capacity via these IDs.
     */
    resource_specs: string[];

    /** Source Intent IDs — for traceability back to the VF graph. */
    intent_ids: string[];

    /** Spatial context, preserved so callers can see WHERE availability holds. */
    location?: {
        h3_index?: string;
        latitude?: number;
        longitude?: number;
    };

    /**
     * Temporal context, preserved so callers can see WHEN availability holds.
     * Analogous to availability_window on PersonCapacity.
     * Derived from the first contributing Intent's hasBeginning / hasEnd / due.
     */
    start_date?: string | null;
    end_date?: string | null;

    /**
     * Full temporal pattern for this capacity node.
     * Set when the contributing Intent carries an availability_window.
     * Null/absent for one-off intents (use start_date/end_date instead).
     *
     * Callers MUST check this (or start_date/end_date) before summing total_hours
     * across nodes — never aggregate without verifying window compatibility.
     */
    availability_window?: TemporalExpression;

    /**
     * Effort hours already committed (work Commitments where provider === agent_id
     * overlapping this capacity's [start_date, end_date]).
     * 0 when buildAgentIndex is called without commitments.
     */
    committed_hours: number;
    /** Remaining available = max(0, total_hours - committed_hours). */
    remaining_hours: number;
}

/**
 * AgentIndex — container for agent capacity nodes with skill-based indexing.
 *
 * Analogous to LaborIndex.
 *
 * Query pattern (mirrors LaborIndex):
 *   1. `spec_index.get(specId)` → Set<capacityId>
 *   2. Lookup capacities in `agent_capacities`
 *   3. Sum total_hours — safe because each agent appears once per space-time
 */
export interface AgentIndex {
    agents: Map<string, Agent>;

    /**
     * Capacity nodes — ONE per (agent, space_time_signature).
     * Source of truth. Analogous to LaborIndex.person_capacities.
     */
    agent_capacities: Map<string, AgentCapacity>;

    /**
     * Spec (skill) index — maps ResourceSpecification ID → Set<capacityId>.
     * References only — does NOT duplicate hours across specs.
     * Analogous to LaborIndex.skill_index.
     */
    spec_index: Map<string, Set<string>>;

    /** Space-time index — maps signature → Set<capacityId>. */
    space_time_index: Map<string, Set<string>>;

    /**
     * Spatial hierarchy over AgentCapacity nodes (not raw Intents).
     * HexNode.items contains capacityIds; resolve via agent_capacities to get
     * full objects including start_date/end_date.
     */
    spatial_hierarchy: HexIndex<AgentCapacity>;
}

// =============================================================================
// BUILD
// =============================================================================

function addTo(map: Map<string, Set<string>>, key: string, id: string): void {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

/**
 * Returns true if commitment `c` temporally overlaps the capacity window
 * [capStart, capEnd) (both are nullable ISO strings).
 *
 * Rules:
 *   - If capacity has no dates → accept all (unbounded capacity window)
 *   - If commitment has no dates → accept it (conservative: could be anytime)
 *   - Non-overlap: cEnd <= capStart || cStart >= capEnd → false
 */
function commitmentOverlapsCapacity(
    c: Commitment,
    capStart: string | null | undefined,
    capEnd: string | null | undefined,
): boolean {
    // Unbounded capacity window — always overlaps
    if (!capStart && !capEnd) return true;

    const cStart = c.hasBeginning ?? c.hasPointInTime ?? c.due ?? null;
    const cEnd = c.hasEnd ?? c.hasPointInTime ?? c.due ?? null;

    // Commitment has no temporal anchors — conservative: accept
    if (!cStart && !cEnd) return true;

    const capS = capStart ? new Date(capStart).getTime() : -Infinity;
    const capE = capEnd ? new Date(capEnd).getTime() : Infinity;
    const cs = cStart ? new Date(cStart).getTime() : -Infinity;
    const ce = cEnd ? new Date(cEnd).getTime() : Infinity;

    // Non-overlap check (half-open intervals)
    if (ce <= capS || cs >= capE) return false;
    return true;
}

/**
 * Build an AgentIndex from a set of Intents and Agents.
 *
 * Only `work` Intents contribute capacity nodes. Other actions are ignored
 * because they don't express labor supply.
 *
 * @param intents   All Intents in scope (non-work Intents are skipped).
 * @param agents    All Agents — used to populate the agents map.
 * @param locations Resolved SpatialThings, keyed by SpatialThing ID.
 * @param h3Resolution H3 resolution for spatial bucketing (default 7 ≈ 1km).
 */
export function buildAgentIndex(
    intents: Intent[],
    agents: Agent[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
    commitments: Commitment[] = [],
): AgentIndex {
    const index: AgentIndex = {
        agents: new Map(agents.map(a => [a.id, a])),
        agent_capacities: new Map(),
        spec_index: new Map(),
        space_time_index: new Map(),
        spatial_hierarchy: createHexIndex<AgentCapacity>(),
    };

    // Accumulator: (agentId|sig) → mutable capacity data before committing
    const accumulator = new Map<string, {
        agent_id: string;
        sig: string;
        max_hours: number;
        resource_specs: Set<string>;
        intent_ids: string[];
        st?: SpatialThing;
        availability_window?: TemporalExpression; // from first Intent in group (same sig → same window)
        start_date?: string | null;
        end_date?: string | null;
    }>();

    for (const intent of intents) {
        // Only work Intents express labor supply
        if (intent.action !== 'work') continue;
        // Must have a provider to be supply
        if (!intent.provider) continue;

        const st = intent.atLocation ? locations.get(intent.atLocation) : undefined;
        const ctx = intentToSpaceTimeContext(intent, st, h3Resolution);
        const sig = getSpaceTimeSignature(ctx, h3Resolution);
        const capacityId = `${intent.provider}|${sig}`;

        const hours = intent.effortQuantity?.hasNumericalValue ?? 0;

        const existing = accumulator.get(capacityId);
        if (existing) {
            // Merge into existing capacity node — max hours, union specs
            existing.max_hours = Math.max(existing.max_hours, hours);
            if (intent.resourceConformsTo) existing.resource_specs.add(intent.resourceConformsTo);
            existing.intent_ids.push(intent.id);
        } else {
            accumulator.set(capacityId, {
                agent_id: intent.provider,
                sig,
                max_hours: hours,
                resource_specs: new Set(intent.resourceConformsTo ? [intent.resourceConformsTo] : []),
                intent_ids: [intent.id],
                st,
                availability_window: intent.availability_window,
                start_date: intent.hasBeginning ?? intent.hasPointInTime ?? null,
                end_date: intent.hasEnd ?? intent.due ?? intent.hasPointInTime ?? null,
            });
        }
    }

    // Pre-index work commitments by provider for O(1) lookup below
    const workCommitmentsByProvider = new Map<string, Commitment[]>();
    for (const c of commitments) {
        if (c.action !== 'work' || !c.provider) continue;
        const existing = workCommitmentsByProvider.get(c.provider);
        if (existing) {
            existing.push(c);
        } else {
            workCommitmentsByProvider.set(c.provider, [c]);
        }
    }

    // Commit accumulator → AgentCapacity records and build all indexes
    for (const [capacityId, acc] of accumulator) {
        const h3Cell = acc.st ? spatialThingToH3(acc.st, h3Resolution) : undefined;

        // Tally committed effort hours for this capacity window
        let committed_hours = 0;
        for (const c of workCommitmentsByProvider.get(acc.agent_id) ?? []) {
            if (!commitmentOverlapsCapacity(c, acc.start_date, acc.end_date)) continue;
            committed_hours += c.effortQuantity?.hasNumericalValue ?? 0;
        }
        const remaining_hours = Math.max(0, acc.max_hours - committed_hours);

        const capacity: AgentCapacity = {
            id: capacityId,
            agent_id: acc.agent_id,
            space_time_signature: acc.sig,
            total_hours: acc.max_hours,
            resource_specs: [...acc.resource_specs],
            intent_ids: acc.intent_ids,
            location: acc.st ? {
                h3_index: h3Cell,
                latitude: acc.st.lat,
                longitude: acc.st.long,
            } : undefined,
            start_date: acc.start_date,
            end_date: acc.end_date,
            availability_window: acc.availability_window,
            committed_hours,
            remaining_hours,
        };

        index.agent_capacities.set(capacityId, capacity);

        // Spec index — each spec references this capacity (no duplication)
        for (const specId of acc.resource_specs) {
            addTo(index.spec_index, specId, capacityId);
        }

        // Space-time index
        addTo(index.space_time_index, acc.sig, capacityId);

        // Spatial hierarchy — stores AgentCapacity objects, preserving timing
        if (acc.st) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                capacity,
                capacityId,
                { lat: acc.st.lat, lon: acc.st.long, h3_index: h3Cell },
                { hours: acc.max_hours },
                acc.availability_window, // TemporalExpression — populates temporal hierarchy when present
            );
        }
    }

    return index;
}

// =============================================================================
// TEMPORAL PREDICATE — extracted and named so it is usable from ScheduleBook
// =============================================================================

/**
 * Returns true if the capacity node covers the given calendar date.
 *
 * Priority (mirrors blockOverlapsDate in ScheduleBook, applied to AgentCapacity fields):
 *   1. availability_window → `hoursInWindowOnDate(window, dt) > 0`
 *   2. start_date present → calendar-day equality on the ISO date
 *   3. end_date present (due-based intent) → calendar-day equality
 *   4. No temporal info → true (conservative: could be any time)
 *
 * This is the single canonical day-coverage check used by `netEffortHours`
 * and `getTotalAgentHours`.
 */
export function nodeCoversDay(capacity: AgentCapacity, dt: Date): boolean {
    if (capacity.availability_window) {
        return hoursInWindowOnDate(capacity.availability_window, dt) > 0;
    }
    const isoDate = dt.toISOString().split('T')[0];
    if (capacity.start_date) {
        return capacity.start_date.slice(0, 10) === isoDate;
    }
    if (capacity.end_date) {
        return capacity.end_date.slice(0, 10) === isoDate;
    }
    return true; // no temporal anchor → conservative
}

// =============================================================================
// QUERIES — all return AgentCapacity[], preserving temporal + spatial context
// =============================================================================

/**
 * All capacity nodes for a given ResourceSpecification (skill).
 * Each node carries its own start_date/end_date and location.
 * Sum total_hours safely — no double-counting.
 */
export function queryAgentsBySpec(index: AgentIndex, specId: string): AgentCapacity[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.agent_capacities.get(id)!).filter(Boolean);
}

/**
 * All capacity nodes near a location.
 * Fast path via H3; returns full AgentCapacity objects with timing intact.
 */
export function queryAgentsByLocation(
    index: AgentIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): AgentCapacity[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.agent_capacities.get(id)!).filter(Boolean);
}

/**
 * Intersection of spec and location queries.
 * Returns capacity nodes that match BOTH — preserving start_date/end_date on each.
 * Analogous to queryLaborBySkillAndLocation in LaborIndex.
 */
export function queryAgentsBySpecAndLocation(
    index: AgentIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): AgentCapacity[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.agent_capacities.get(id)!)
        .filter(Boolean);
}

/**
 * Raw HexNode for a cell — gives access to the aggregated HexStats
 * (count, sum_hours) and the full AgentCapacity objects stored as items.
 */
export function queryAgentsByHex(index: AgentIndex, cell: string): HexNode<AgentCapacity> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}

/**
 * Sum total_hours across capacity nodes.
 * Safe — each node is deduplicated to one agent per space-time context.
 * Analogous to getTotalHours in LaborIndex.
 *
 * When `dt` is provided, only nodes whose window covers that calendar date
 * (per `nodeCoversDay`) contribute to the sum. This prevents mixing hours
 * from different temporal contexts (e.g. recurring Mon-only nodes counted
 * on a Tuesday query).
 */
export function getTotalAgentHours(capacities: AgentCapacity[], dt?: Date): number {
    const filtered = dt ? capacities.filter(c => nodeCoversDay(c, dt)) : capacities;
    return filtered.reduce((sum, c) => sum + c.total_hours, 0);
}

/**
 * Net remaining effort hours for `agentId` on calendar date `dt`.
 *
 * Filters capacity nodes by `agent_id === agentId` and `nodeCoversDay(node, dt)`,
 * then sums `remaining_hours` (already net of committed hours from `buildAgentIndex`).
 *
 * When `location` is provided, additionally restricts to nodes whose spatial
 * context falls within `radius_km` of `(lat, lon)` via `queryHexOnDate` on
 * the index's `spatial_hierarchy`.
 */
export function netEffortHours(
    agentId: string,
    dt: Date,
    index: AgentIndex,
    location?: { lat: number; lon: number; radius_km?: number },
): number {
    let candidates = [...index.agent_capacities.values()]
        .filter(c => c.agent_id === agentId && nodeCoversDay(c, dt));

    if (location) {
        const isoDate = dt.toISOString().split('T')[0];
        const spatialIds = queryHexOnDate(
            index.spatial_hierarchy,
            { latitude: location.lat, longitude: location.lon, radius_km: location.radius_km },
            isoDate,
        );
        candidates = candidates.filter(c => spatialIds.has(c.id));
    }

    return candidates.reduce((sum, c) => sum + c.remaining_hours, 0);
}
