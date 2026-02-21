/**
 * Space-Time-Plan: Plans as Timelines
 *
 * A Plan is a consistent, complete specification of intentions across a
 * region of the space-time grid — a deterministic timeline that can be
 * constructed, scored, merged with neighbouring Plans, and selected.
 *
 * The search space is explored bottom-up (leaf hex cells → root) so that
 * local needs are satisfied first and cross-region substitutions emerge
 * naturally from Plan merges at higher resolutions.
 *
 * Key properties:
 *  - Deterministic: same data → same Plan ids, always
 *  - Mergeable: two compatible Plans produce a new Plan (or a Conflict)
 *  - Serializable: Plans are pure data, no shared state
 *  - Pareto-prunable: dominated Plans are discarded, keeping the frontier small
 *
 * See docs/SPACE_TIME_PLAN.md for full design rationale.
 */

import * as h3 from 'h3-js';
import { getSpaceTimeSignature, type SpaceTimeContext } from './space-time-keys';
import { cellsCompatible } from './space';

// =============================================================================
// SPACE-TIME-PLAN KEY — the canonical address of an operation in the search space
// =============================================================================

/**
 * A deterministic, canonical string identifying a *class* of operation:
 * "this type of work, at this scale of place, during this time pattern."
 *
 * Format: `<SpaceTimeSignature>::<strategyTypeKey>`
 * Example: `"recurring|Days:(mon)@09-17::87283472bffffff::bread-baking-large"`
 */
export type SpaceTimePlanKey = string;

/**
 * Produce the canonical address for a planned operation.
 *
 * @param location  Spatial context (h3_index, lat/lon, or city/country)
 * @param time      Temporal context (availability_window, recurrence, etc.)
 * @param strategyTypeKey  Stable identifier for the strategy type
 * @param h3Resolution  Bucketing resolution for the spatial component (default 7 ~1km)
 */
export function getPlanKey(
    location: SpaceTimeContext,
    time: Pick<SpaceTimeContext, 'availability_window' | 'start_date' | 'end_date' | 'recurrence'>,
    strategyTypeKey: string,
    h3Resolution: number = 7,
): SpaceTimePlanKey {
    const spaceTimeKey = getSpaceTimeSignature({ ...location, ...time }, h3Resolution);
    return `${spaceTimeKey}::${strategyTypeKey}`;
}

// =============================================================================
// SPACE-TIME-PLAN NODE — one committed operation atom
// =============================================================================

/**
 * The atomic unit of a Plan: a single strategy executing N times at a
 * specific location and time.
 */
export interface SpaceTimePlanNode {
    /** Canonical address in the search space */
    key: SpaceTimePlanKey;

    /** Stable key for the strategy type (e.g. "bread-baking-large-batch") */
    strategy_type_key: string;

    /** H3 cell this node is planned at */
    h3_cell: string;

    /** Resolution this node was planned at */
    resolution: number;

    /** Canonical time signature component */
    time_signature: string;

    /** How many times the strategy executes */
    executions: number;

    /** Total socially necessary labour time (executions × snlt_per_execution) */
    total_snlt: number;

    /** Per-execution SNLT */
    snlt_per_execution: number;

    /** Inputs consumed per execution */
    inputs_required: Array<{ product_id: string; quantity: number }>;

    /** Outputs produced per execution */
    outputs_produced: Array<{ product_id: string; quantity: number }>;

    /** True once written to the Allocations store */
    committed: boolean;
}

/**
 * Construct a SpaceTimePlanNode.
 */
export function makePlanNode(params: {
    strategy_type_key: string;
    h3_cell: string;
    resolution: number;
    time_signature: string;
    executions: number;
    snlt_per_execution: number;
    inputs_required: Array<{ product_id: string; quantity: number }>;
    outputs_produced: Array<{ product_id: string; quantity: number }>;
}): SpaceTimePlanNode {
    const key = `${params.time_signature}::${params.h3_cell}::${params.strategy_type_key}`;
    return {
        ...params,
        key,
        total_snlt: params.executions * params.snlt_per_execution,
        committed: false,
    };
}

// =============================================================================
// PLAN SCORE
// =============================================================================

export interface PlanScore {
    /** Total socially necessary labour time across all nodes — minimize */
    total_snlt: number;

    /** Fraction of critical needs satisfied (0–1) — maximize */
    needs_covered: number;

    /** Unmet needs after this Plan is applied */
    deficits: Array<{ product_id: string; gap: number }>;

    /** Excess production beyond needs */
    surpluses: Array<{ product_id: string; excess: number }>;

    /**
     * How many hex resolution levels contributed nodes to this Plan.
     * Higher = more cross-region coordination was required.
     */
    resolution_depth: number;
}

// =============================================================================
// PLAN — a complete or partial timeline
// =============================================================================

/**
 * A Plan is a set of SpaceTimePlanNodes forming a consistent, internally
 * balanced timeline. Its identity is purely its content.
 */
export interface Plan {
    /**
     * Canonical hash of all node keys (sorted).
     * Two Plans with the same nodes always have the same id.
     */
    id: string;

    /** All committed operation atoms in this Plan */
    nodes: SpaceTimePlanNode[];

    /** Scored metrics */
    score: PlanScore;

    /**
     * Set of H3 cells covered by this Plan (across all resolutions).
     * Used for spatial adjacency checks during merging.
     */
    covered_cells: Set<string>;
}

/**
 * Compute a deterministic id for a set of plan nodes.
 * Sorting ensures the same nodes → the same id regardless of insertion order.
 */
export function computePlanId(nodes: SpaceTimePlanNode[]): string {
    const sorted = nodes.map(n => n.key).sort().join('|');
    // Simple deterministic hash (djb2 variant). Swap for crypto hash if needed.
    let hash = 5381;
    for (let i = 0; i < sorted.length; i++) {
        hash = ((hash << 5) + hash) ^ sorted.charCodeAt(i);
        hash = hash >>> 0; // keep as unsigned 32-bit
    }
    return `plan_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Build a Plan from a set of nodes, computing score and covered cells.
 */
export function makePlan(
    nodes: SpaceTimePlanNode[],
    score: PlanScore,
): Plan {
    const covered_cells = new Set<string>(nodes.map(n => n.h3_cell));
    return {
        id: computePlanId(nodes),
        nodes,
        score,
        covered_cells,
    };
}

/**
 * Create an empty Plan (no operations, all needs unmet) for a given cell.
 * Used as a starting point for leaf-level solvers that produce no feasible strategies.
 */
export function emptyPlan(deficits: PlanScore['deficits'] = []): Plan {
    return makePlan([], {
        total_snlt: 0,
        needs_covered: 0,
        deficits,
        surpluses: [],
        resolution_depth: 0,
    });
}

// =============================================================================
// CONFLICT — why two Plans cannot merge
// =============================================================================

export type PlanConflict =
    | {
          type: 'double_commitment';
          /** The key that appears in both Plans with incompatible strategies */
          conflicting_key: SpaceTimePlanKey;
      }
    | {
          type: 'material_imbalance';
          product_id: string;
          /** How much more is needed than is available after merge */
          shortfall: number;
      };

// =============================================================================
// MERGE — combine two compatible Plans
// =============================================================================

/**
 * Attempt to merge two Plans into a single larger Plan.
 *
 * Merging succeeds when:
 *  1. No node key appears in both Plans with a different strategy type
 *     (same key + same strategy = fine, just sum executions)
 *  2. The combined material balance is feasible (inputs ≤ outputs + stocks)
 *
 * New nodes may be added to the merged Plan when the wider spatial scope
 * exposes cross-cell strategies that neither individual Plan could see.
 *
 * @param a  First Plan
 * @param b  Second Plan
 * @param additionalNodes  Cross-cell operation nodes that became visible at the merge resolution
 * @param availableStocks  Map of product_id → available quantity (for balance check)
 * @returns  Merged Plan, or an array of conflicts preventing the merge
 */
export function mergePlans(
    a: Plan,
    b: Plan,
    additionalNodes: SpaceTimePlanNode[] = [],
    availableStocks: Map<string, number> = new Map(),
): Plan | PlanConflict[] {
    // --- Step 1: detect node key conflicts ---
    const conflicts: PlanConflict[] = [];
    const aKeys = new Map(a.nodes.map(n => [n.key, n]));

    for (const bNode of b.nodes) {
        const aNode = aKeys.get(bNode.key);
        if (aNode && aNode.strategy_type_key !== bNode.strategy_type_key) {
            conflicts.push({ type: 'double_commitment', conflicting_key: bNode.key });
        }
    }

    if (conflicts.length > 0) return conflicts;

    // --- Step 2: merge node sets (sum executions for identical keys) ---
    const mergedNodes = new Map<SpaceTimePlanKey, SpaceTimePlanNode>();

    for (const node of [...a.nodes, ...b.nodes, ...additionalNodes]) {
        const existing = mergedNodes.get(node.key);
        if (existing) {
            // Same key + same strategy: sum executions
            mergedNodes.set(node.key, {
                ...existing,
                executions: existing.executions + node.executions,
                total_snlt: existing.total_snlt + node.total_snlt,
            });
        } else {
            mergedNodes.set(node.key, { ...node });
        }
    }

    const allNodes = Array.from(mergedNodes.values());

    // --- Step 3: material balance check ---
    const balance = new Map<string, number>(availableStocks);

    // Credit all outputs
    for (const node of allNodes) {
        for (const output of node.outputs_produced) {
            balance.set(
                output.product_id,
                (balance.get(output.product_id) ?? 0) + output.quantity * node.executions,
            );
        }
    }

    // Debit all inputs
    for (const node of allNodes) {
        for (const input of node.inputs_required) {
            const available = balance.get(input.product_id) ?? 0;
            const needed = input.quantity * node.executions;
            if (needed > available) {
                conflicts.push({
                    type: 'material_imbalance',
                    product_id: input.product_id,
                    shortfall: needed - available,
                });
            }
            balance.set(input.product_id, Math.max(0, available - needed));
        }
    }

    if (conflicts.length > 0) return conflicts;

    // --- Step 4: compute merged score ---
    const totalSnlt = allNodes.reduce((s, n) => s + n.total_snlt, 0);
    const maxResolution = Math.max(...allNodes.map(n => n.resolution), 0);
    const minResolution = Math.min(...allNodes.map(n => n.resolution), maxResolution);

    const mergedDeficits = mergeDeficits(a.score.deficits, b.score.deficits);
    const mergedSurpluses = mergeSurpluses(a.score.surpluses, b.score.surpluses);

    // Needs covered: average of the two, weighted by their node counts
    const totalNodes = a.nodes.length + b.nodes.length || 1;
    const needsCovered =
        (a.score.needs_covered * a.nodes.length + b.score.needs_covered * b.nodes.length) /
        totalNodes;

    const mergedScore: PlanScore = {
        total_snlt: totalSnlt,
        needs_covered: Math.min(1, needsCovered),
        deficits: mergedDeficits,
        surpluses: mergedSurpluses,
        resolution_depth: maxResolution - minResolution + 1,
    };

    return makePlan(allNodes, mergedScore);
}

// Helpers for score merging
function mergeDeficits(
    a: PlanScore['deficits'],
    b: PlanScore['deficits'],
): PlanScore['deficits'] {
    const merged = new Map<string, number>();
    for (const d of [...a, ...b]) {
        merged.set(d.product_id, (merged.get(d.product_id) ?? 0) + d.gap);
    }
    return Array.from(merged.entries()).map(([product_id, gap]) => ({ product_id, gap }));
}

function mergeSurpluses(
    a: PlanScore['surpluses'],
    b: PlanScore['surpluses'],
): PlanScore['surpluses'] {
    const merged = new Map<string, number>();
    for (const s of [...a, ...b]) {
        merged.set(s.product_id, (merged.get(s.product_id) ?? 0) + s.excess);
    }
    return Array.from(merged.entries()).map(([product_id, excess]) => ({ product_id, excess }));
}

// =============================================================================
// PARETO DOMINANCE
// =============================================================================

/**
 * Returns true if Plan `a` dominates Plan `b` on the Pareto front.
 *
 * A dominates B iff:
 *  - A covers at least as many needs as B, AND
 *  - A uses at most as much SNLT as B, AND
 *  - A is strictly better on at least one axis.
 */
export function planDominates(a: Plan, b: Plan): boolean {
    const betterNeeds = a.score.needs_covered >= b.score.needs_covered;
    const betterSnlt  = a.score.total_snlt    <= b.score.total_snlt;
    const strictlyBetter =
        a.score.needs_covered > b.score.needs_covered ||
        a.score.total_snlt    < b.score.total_snlt;
    return betterNeeds && betterSnlt && strictlyBetter;
}

/**
 * Prune a set of Plans to the Pareto front.
 * Any Plan dominated by another is removed.
 *
 * O(n²) — acceptable for small frontiers (beam width ≤ 100).
 */
export function paretoFront(plans: Plan[]): Plan[] {
    return plans.filter(
        candidate => !plans.some(other => planDominates(other, candidate)),
    );
}

// =============================================================================
// MERGE FRONTIER — one level of the bottom-up loop
// =============================================================================

export interface MergeFrontierOptions {
    /**
     * Maximum number of Plans to carry into the next level.
     * Plans are ranked by score before truncation (beam search).
     * Default: 50.
     */
    beamWidth?: number;

    /**
     * How many H3 grid rings to consider "adjacent" for merge candidates.
     * Default: 1 (immediate neighbours only).
     */
    adjacencyRings?: number;

    /**
     * If true, stop climbing when the Pareto front contains a Plan with
     * needs_covered === 1 and no deficits.
     */
    earlyStop?: boolean;

    /**
     * Provider of cross-cell operation nodes that became visible at `resolution`.
     * Called for each candidate pair before merging.
     */
    getCrossCellNodes?: (
        a: Plan,
        b: Plan,
        resolution: number,
    ) => SpaceTimePlanNode[];

    /**
     * Available stocks at this resolution level (for material balance checks).
     */
    availableStocks?: Map<string, number>;
}

/**
 * Run one level of the bottom-up merge loop.
 *
 * For each pair of spatially adjacent Plans, attempts a merge.
 * Returns the Pareto front of the combined results, capped to beamWidth.
 *
 * @param plans       Current Plan frontier
 * @param resolution  The H3 resolution level being processed (plans are moving UP)
 */
export function mergeFrontier(
    plans: Plan[],
    resolution: number,
    options: MergeFrontierOptions = {},
): Plan[] {
    const {
        beamWidth = 50,
        adjacencyRings = 1,
        earlyStop = true,
        getCrossCellNodes,
        availableStocks = new Map(),
    } = options;

    // Early stop if already fully satisfied
    if (earlyStop && plans.some(p => p.score.needs_covered >= 1 && p.score.deficits.length === 0)) {
        return plans;
    }

    const results = new Map<string, Plan>(); // id → Plan (dedup by hash)

    // Carry all existing Plans forward
    for (const plan of plans) {
        results.set(plan.id, plan);
    }

    // Attempt merges between spatially adjacent Plan pairs
    for (let i = 0; i < plans.length; i++) {
        for (let j = i + 1; j < plans.length; j++) {
            const a = plans[i];
            const b = plans[j];

            // Check spatial adjacency: any cell in A must be within adjacencyRings of any cell in B
            if (!plansAdjacent(a, b, resolution, adjacencyRings)) continue;

            const crossCellNodes = getCrossCellNodes?.(a, b, resolution) ?? [];
            const mergeResult = mergePlans(a, b, crossCellNodes, availableStocks);

            if (Array.isArray(mergeResult)) continue; // conflict — skip

            // Only add if not already seen
            if (!results.has(mergeResult.id)) {
                results.set(mergeResult.id, mergeResult);
            }
        }
    }

    // Pareto-prune, then truncate to beam width (ranked by needs_covered desc, snlt asc)
    const front = paretoFront(Array.from(results.values()));
    return front
        .sort((a, b) => {
            if (b.score.needs_covered !== a.score.needs_covered) {
                return b.score.needs_covered - a.score.needs_covered;
            }
            return a.score.total_snlt - b.score.total_snlt;
        })
        .slice(0, beamWidth);
}

/**
 * Check whether two Plans are spatially adjacent at a given resolution.
 * Two Plans are adjacent if any of their covered cells are within `rings`
 * grid rings of each other at the given resolution.
 */
function plansAdjacent(a: Plan, b: Plan, resolution: number, rings: number): boolean {
    for (const cellA of a.covered_cells) {
        const parentA = toResolution(cellA, resolution);
        if (!parentA) continue;

        for (const cellB of b.covered_cells) {
            const parentB = toResolution(cellB, resolution);
            if (!parentB) continue;

            if (cellsCompatible(parentA, parentB, rings * h3.getHexagonEdgeLengthAvg(resolution, 'km'))) {
                return true;
            }
        }
    }
    return false;
}

/** Safe cell-to-parent, returns null if resolution mismatch would be invalid */
function toResolution(cell: string, targetResolution: number): string | null {
    try {
        const cellRes = h3.getResolution(cell);
        if (cellRes === targetResolution) return cell;
        if (cellRes > targetResolution) return h3.cellToParent(cell, targetResolution);
        return cell; // cell is already coarser — use as-is
    } catch {
        return null;
    }
}

// =============================================================================
// BOTTOM-UP PLANNING LOOP
// =============================================================================

export interface PlanningLoopOptions extends MergeFrontierOptions {
    /** Finest resolution to start at (default: 9, ~building scale) */
    leafResolution?: number;

    /** Coarsest resolution to stop at (default: 4, ~city scale) */
    rootResolution?: number;
}

/**
 * Drive the full bottom-up planning loop from leaf to root.
 *
 * @param leafPlans   Initial Plans produced by leaf-level solvers (one per occupied hex cell)
 * @param options     Loop configuration
 * @returns           Final Pareto front of Plans after all merge levels
 */
export function runPlanningLoop(
    leafPlans: Plan[],
    options: PlanningLoopOptions = {},
): Plan[] {
    const { leafResolution = 9, rootResolution = 4, ...frontierOptions } = options;

    let frontier = leafPlans;

    for (let resolution = leafResolution - 1; resolution >= rootResolution; resolution--) {
        frontier = mergeFrontier(frontier, resolution, frontierOptions);

        // Nothing left to merge
        if (frontier.length === 0) break;

        // Early stop if fully satisfied
        if (
            frontierOptions.earlyStop !== false &&
            frontier.some(p => p.score.needs_covered >= 1 && p.score.deficits.length === 0)
        ) {
            break;
        }
    }

    return frontier;
}

// =============================================================================
// SELECTION — choose from the Pareto front
// =============================================================================

export type PlanSelectionPolicy =
    | 'min_snlt'          // minimize total SNLT (most efficient)
    | 'max_coverage'      // maximize needs covered (most resilient)
    | 'balanced';         // weighted F-score of both (default)

/**
 * Select a single Plan from the Pareto front according to a policy.
 */
export function selectFromParetoFront(
    plans: Plan[],
    policy: PlanSelectionPolicy = 'balanced',
): Plan | null {
    if (plans.length === 0) return null;

    const front = paretoFront(plans);
    if (front.length === 0) return null;
    if (front.length === 1) return front[0];

    switch (policy) {
        case 'min_snlt':
            return front.reduce((best, p) => p.score.total_snlt < best.score.total_snlt ? p : best);

        case 'max_coverage':
            return front.reduce((best, p) => p.score.needs_covered > best.score.needs_covered ? p : best);

        case 'balanced': {
            // F-score: harmonic mean of needs_covered and (1 - normalized_snlt)
            const maxSnlt = Math.max(...front.map(p => p.score.total_snlt), 1);
            return front.reduce((best, p) => {
                const efficiency = 1 - (p.score.total_snlt / maxSnlt);
                const coverage   = p.score.needs_covered;
                // Avoid division by zero
                const f = (coverage + efficiency) > 0
                    ? (2 * coverage * efficiency) / (coverage + efficiency)
                    : 0;
                const bestEfficiency = 1 - (best.score.total_snlt / maxSnlt);
                const bestCoverage   = best.score.needs_covered;
                const bestF = (bestCoverage + bestEfficiency) > 0
                    ? (2 * bestCoverage * bestEfficiency) / (bestCoverage + bestEfficiency)
                    : 0;
                return f > bestF ? p : best;
            });
        }
    }
}

// =============================================================================
// SERIALISATION — Plans as network messages
// =============================================================================

export interface SerializedPlan {
    plan_id: string;
    nodes: Array<{
        key: SpaceTimePlanKey;
        executions: number;
        total_snlt: number;
        strategy_type_key: string;
        h3_cell: string;
        resolution: number;
    }>;
    score: PlanScore;
}

export function serialisePlan(plan: Plan): SerializedPlan {
    return {
        plan_id: plan.id,
        nodes: plan.nodes.map(n => ({
            key: n.key,
            executions: n.executions,
            total_snlt: n.total_snlt,
            strategy_type_key: n.strategy_type_key,
            h3_cell: n.h3_cell,
            resolution: n.resolution,
        })),
        score: plan.score,
    };
}

export function deserialisePlan(s: SerializedPlan): Plan {
    const nodes: SpaceTimePlanNode[] = s.nodes.map(n => ({
        key: n.key,
        strategy_type_key: n.strategy_type_key,
        h3_cell: n.h3_cell,
        resolution: n.resolution,
        time_signature: n.key.split('::')[0] ?? '',
        executions: n.executions,
        total_snlt: n.total_snlt,
        snlt_per_execution: n.executions > 0 ? n.total_snlt / n.executions : 0,
        inputs_required:  [],
        outputs_produced: [],
        committed: false,
    }));
    return makePlan(nodes, s.score);
}
