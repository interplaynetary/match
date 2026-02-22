/**
 * Space-Time Scenario Index
 *
 * The planning search analogue of HexIndex<T>.
 *
 * HexIndex answers: "what exists at this location at this time?"
 * ScenarioIndex answers: "what PLANS are being considered for this location?"
 *
 * The key design property: DETERMINISM
 * ─────────────────────────────────────
 * A Scenario's identity is derived purely from its content:
 *
 *   scenarioId = hash(sort(
 *     commitment.resourceConformsTo + "|" +
 *     commitment.action + "|" +
 *     spaceTimeSig(commitment, location, res)
 *     for each commitment in scenario
 *   ))
 *
 * Two workers that independently build the same set of operations produce
 * the SAME scenarioId. Hash collision = same Scenario = safe dedup without
 * coordination. This is what makes the search embarrassingly parallel at
 * leaf resolution and only neighbour-level coordinated at merge steps.
 *
 * Node key: `h3Cell::processSpec`
 * ─────────────────────────────────
 * Each ScenarioNode is addressed by both WHERE (H3 cell) and WHAT (ProcessSpec
 * or ResourceSpecification of the primary output). This is the VF SpaceTimePlanKey
 * from SPACE_TIME_PLAN_VF.md:
 *
 *   "recurring|Days:(mon)@09-17::87283472::bread-v2"
 *    └─ WHEN ──────────────┘  └─ WHERE ─┘  └─ WHAT ┘
 *
 * The WHEN component lives inside the TemporalIndex (reused from HexIndex),
 * so the node key string is just `h3Cell::processSpec`.
 *
 * Hierarchy:
 * ──────────
 *   res 9 leaf nodes  → single-recipe Scenarios (from instantiateRecipe)
 *   res 7 merge nodes → Scenarios spanning a neighbourhood (cross-cell flows visible)
 *   res 5 merge nodes → Scenarios spanning a district (regional logistics visible)
 *   ...
 *   SELECT             → winning Scenario promoted to a committed Plan
 */

import * as h3 from 'h3-js';
import type { Process, Commitment, Intent, Plan, SpatialThing } from '../schemas';
import type { IndependentDemandIndex, DemandSlot } from '../indexes/independent-demand';
import { getSpaceTimeSignature, commitmentToSpaceTimeContext } from './space-time-keys';
import { spatialThingToH3 } from './space';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Planning performance statistics for a ScenarioNode or the whole ScenarioIndex.
 *
 * Analogous to HexStats but tracks planning quality, not inventory quantity.
 */
export interface ScenarioStats {
    /** Number of distinct Scenarios in this node (and its children). */
    scenario_count: number;

    /** Total Intents satisfied across all Scenarios (for scoring). */
    intents_satisfied: number;

    /** Total Intents in scope — denominator for coverage %. */
    intents_total: number;

    /** Sum of effortQuantity across all Commitments (≈ total SNLT). */
    total_effort_hours: number;

    /** ResourceSpecification IDs that still have no satisfying Commitment. */
    deficit_specs: Set<string>;
}

/**
 * A Scenario — a candidate Plan, not yet committed to PlanStore.
 *
 * Identified by a deterministic hash of its Commitment signatures.
 * Immutable after creation — merge() always produces a NEW Scenario.
 */
export interface Scenario {
    /**
     * Deterministic ID.
     * = sortedHash(commitments.map(c => commitmentSignature(c)))
     * Same content ⟹ same ID, across any number of workers.
     */
    id: string;

    /** All Processes tentatively scheduled in this Scenario. */
    processes: Map<string, Process>;

    /**
     * All Commitments tentatively created in this Scenario.
     * Indexed by commitment ID for O(1) lookup.
     */
    commitments: Map<string, Commitment>;

    /**
     * Open demand slots this Scenario does NOT yet satisfy.
     * These are the "deficits" — what the merge step tries to close.
     */
    deficits: DemandSlot[];

    /**
     * Excess outputs — ResourceSpec IDs produced more than demanded.
     * Candidates for satisfying deficits in adjacent Scenarios.
     */
    surpluses: Array<{ spec_id: string; quantity: number }>;

    /** Pre-computed score for Pareto comparison. */
    score: ScenarioScore;

    /**
     * H3 cell at which this Scenario was originally generated (leaf resolution).
     * Used to determine parent cells during the merge bubble-up.
     */
    origin_cell: string;

    /**
     * H3 resolution of this Scenario.
     * Increases (coarsens) as Scenarios are merged upward.
     */
    resolution: number;

    /**
     * D2 expansion signals: specs where local capacity was insufficient to meet demand.
     * These are candidates for capacity-building investments (new Means of Production).
     * Undefined when there are no gaps, or for merged Scenarios.
     */
    expansionSignals?: Array<{ specId: string; needed: number; feasible: number; gap: number }>;
}

/**
 * Pareto score for a Scenario.
 * Two axes: coverage (maximize) and effort (minimize).
 */
export interface ScenarioScore {
    /** Fraction of in-scope Intents that now have a satisfying Commitment. 0–1. */
    coverage: number;

    /** How many Intents are satisfied. */
    intents_satisfied: number;

    /** How many Intents are in scope for this Scenario. */
    intents_total: number;

    /** Total effortQuantity hours across all Commitments (≈ SNLT). Minimize. */
    total_effort_hours: number;

    /** ResourceSpec IDs still unmet. Empty = fully satisfied. */
    deficit_specs: string[];

    /**
     * How many H3 levels contributed Processes to this Scenario.
     * Higher = more inter-regional coordination (informational, not scored).
     */
    h3_depth: number;
}

/**
 * A node in the scenario hierarchy.
 * Addressed by `${h3Cell}::${processSpec}` — canonical and deterministic.
 *
 * Analogous to HexNode<T> in space-time-index.ts.
 */
export interface ScenarioNode {
    /**
     * The canonical node key: `${h3Cell}::${processSpec}`
     * h3Cell is at `resolution`. processSpec identifies the operation type.
     */
    key: string;

    /** H3 cell at this resolution. */
    cell: string;

    /** H3 resolution of this node (9 = leaf, lower = coarser parent). */
    resolution: number;

    /** ProcessSpecification (or ResourceSpec of primary output) — the WHAT. */
    process_spec: string;

    /** Scenario IDs present in this node (leaf) or its children (ancestors). */
    scenario_ids: Set<string>;

    /** Aggregated planning stats. */
    stats: ScenarioStats;
}

/**
 * The top-level Scenario Index container.
 *
 * Analogous to HexIndex<T>.
 */
export interface ScenarioIndex {
    /**
     * All nodes keyed by `${h3Cell}::${processSpec}`.
     * A node exists at every H3 resolution from leaf_resolution up to root_resolution
     * for each (cell, processSpec) pair that has at least one Scenario.
     */
    nodes: Map<string, ScenarioNode>;

    /** All Scenarios, keyed by scenarioId. */
    scenarios: Map<string, Scenario>;

    config: {
        leaf_resolution: number;   // default 9 (~0.1 km²) — single-recipe Plans
        root_resolution: number;   // default 3 — regional Plans
    };
}

// =============================================================================
// CONTENT-ADDRESSABLE KEY FUNCTIONS
// =============================================================================

/**
 * Canonical commitment signature — the atomic unit of the hash.
 *
 * Encodes WHAT (`resourceConformsTo` + `action`) and WHERE+WHEN
 * (`spaceTimeSig`). Does NOT encode the commitment ID — two Commitments
 * with identical specs/location/time produce the same signature.
 *
 * This is what makes the search deterministic across workers.
 */
export function commitmentSignature(
    commitment: Commitment,
    location: SpatialThing | undefined,
    h3Resolution: number,
): string {
    const ctx = commitmentToSpaceTimeContext(commitment, location, h3Resolution);
    const sig = getSpaceTimeSignature(ctx, h3Resolution);
    return `${commitment.resourceConformsTo ?? '_'}|${commitment.action}|${sig}`;
}

/**
 * Compute a deterministic Scenario ID from its Commitment signatures.
 *
 * Property: scenarioId(A) === scenarioId(B) iff A and B have the same
 * multiset of Commitment signatures. Order-independent.
 *
 * Uses a stable string hash (djb2) — fast and sufficient for dedup.
 * For cryptographic / Byzantine-fault-tolerant use, swap in SHA-256.
 */
export function computeScenarioId(signatures: string[]): string {
    const sorted = [...signatures].sort().join('\n');
    return djb2(sorted);
}

function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) ^ s.charCodeAt(i);
        h = h >>> 0; // keep unsigned 32-bit
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * Node key: `${h3Cell}::${processSpec}` — content-addressable by WHERE + WHAT.
 */
export function scenarioNodeKey(h3Cell: string, processSpec: string): string {
    return `${h3Cell}::${processSpec}`;
}

// =============================================================================
// CONSTRUCTION
// =============================================================================

export function createScenarioIndex(
    leafResolution: number = 9,
    rootResolution: number = 3,
): ScenarioIndex {
    return {
        nodes: new Map(),
        scenarios: new Map(),
        config: { leaf_resolution: leafResolution, root_resolution: rootResolution },
    };
}

function createScenarioNode(
    cell: string,
    resolution: number,
    processSpec: string,
): ScenarioNode {
    return {
        key: scenarioNodeKey(cell, processSpec),
        cell,
        resolution,
        process_spec: processSpec,
        scenario_ids: new Set(),
        stats: {
            scenario_count: 0,
            intents_satisfied: 0,
            intents_total: 0,
            total_effort_hours: 0,
            deficit_specs: new Set(),
        },
    };
}

function getOrCreateScenarioNode(
    index: ScenarioIndex,
    cell: string,
    resolution: number,
    processSpec: string,
): ScenarioNode {
    const key = scenarioNodeKey(cell, processSpec);
    let node = index.nodes.get(key);
    if (!node) {
        node = createScenarioNode(cell, resolution, processSpec);
        index.nodes.set(key, node);
    }
    return node;
}

// =============================================================================
// ADD SCENARIO TO INDEX
// =============================================================================

/**
 * Add a Scenario to the index, bubbling its stats up from leaf → root.
 *
 * Analogous to addItemToHexIndex. Each Process in the Scenario contributes
 * to the node for its (cell, processSpec) pair, and that node is propagated
 * to all ancestor H3 cells up to root_resolution.
 *
 * @param index        The ScenarioIndex to update.
 * @param scenario     The Scenario to add.
 * @param locations    SpatialThing lookup (reserved for future use — Scenario.origin_cell is currently used).
 */
export function addScenarioToIndex(
    index: ScenarioIndex,
    scenario: Scenario,
    locations: Map<string, SpatialThing>,
): void {
    index.scenarios.set(scenario.id, scenario);

    // Each Process in the Scenario contributes to the node hierarchy.
    // The Process type has no atLocation field; use the Scenario's origin_cell
    // as the canonical spatial anchor for all processes it contains.
    for (const process of scenario.processes.values()) {
        const processSpec = process.basedOn ?? process.name ?? 'unknown';
        const leafCell = scenario.origin_cell;

        if (!leafCell) continue; // No location at all — skip

        // Bubble up from leaf_resolution to root_resolution
        let currentCell = leafCell;
        let currentRes = index.config.leaf_resolution;

        while (currentRes >= index.config.root_resolution) {
            const node = getOrCreateScenarioNode(index, currentCell, currentRes, processSpec);

            node.scenario_ids.add(scenario.id);
            node.stats.scenario_count += 1;
            node.stats.intents_satisfied += scenario.score.intents_satisfied;
            node.stats.intents_total += scenario.score.intents_total;
            node.stats.total_effort_hours += scenario.score.total_effort_hours;
            for (const spec of scenario.score.deficit_specs) {
                node.stats.deficit_specs.add(spec);
            }

            if (currentRes === 0) break;
            currentCell = h3.cellToParent(currentCell, currentRes - 1);
            currentRes--;
        }
    }
}

// =============================================================================
// SCORING
// =============================================================================

/**
 * Compute the Pareto score for a Scenario.
 *
 * @param scenario  The Scenario to score.
 * @param allIntents All Intents in scope (to compute total demand).
 */
export function scoreScenario(
    scenario: Scenario,
    allIntents: Intent[],
): ScenarioScore {
    const satisfiedIds = new Set(
        [...scenario.commitments.values()]
            .filter(c => c.satisfies)
            .map(c => c.satisfies!),
    );

    const intentsTotal     = allIntents.length;
    const intentsSatisfied = allIntents.filter(i => satisfiedIds.has(i.id)).length;
    const totalHours       = [...scenario.commitments.values()]
        .reduce((s, c) => s + (c.effortQuantity?.hasNumericalValue ?? 0), 0);

    const deficitSpecs = scenario.deficits
        .filter(d => d.spec_id)
        .map(d => d.spec_id!);

    return {
        coverage:           intentsTotal > 0 ? intentsSatisfied / intentsTotal : 0,
        intents_satisfied:  intentsSatisfied,
        intents_total:      intentsTotal,
        total_effort_hours: totalHours,
        deficit_specs:      deficitSpecs,
        h3_depth:           scenario.resolution,
    };
}

// =============================================================================
// PARETO COMPARISON
// =============================================================================

/**
 * Returns true if Scenario A dominates B on the Pareto frontier.
 *
 * A dominates B iff A covers ≥ intents AND uses ≤ effort hours.
 * Two Scenarios on the frontier are incomparable (neither dominates the other).
 */
export function scenarioDominates(a: Scenario, b: Scenario): boolean {
    return (
        a.score.intents_satisfied >= b.score.intents_satisfied &&
        a.score.total_effort_hours <= b.score.total_effort_hours &&
        // At least one strict improvement
        (a.score.intents_satisfied > b.score.intents_satisfied ||
         a.score.total_effort_hours < b.score.total_effort_hours)
    );
}

/**
 * Prune a list of Scenarios to the Pareto front.
 * O(n²) — acceptable for beam widths < 1000.
 */
export function paretoFront(scenarios: Scenario[]): Scenario[] {
    return scenarios.filter(
        a => !scenarios.some(b => scenarioDominates(b, a)),
    );
}

// =============================================================================
// MERGE
// =============================================================================

/**
 * Conflict detected during a merge attempt.
 */
export interface MergeConflict {
    type: 'spec_mismatch' | 'quantity_overflow' | 'no_common_parent';
    detail: string;
}

/**
 * Merge two Scenarios at the given H3 resolution.
 *
 * This is the core step of the bottom-up planning search.
 *
 * What happens here:
 *   1. Find Intents in A.deficits that B can satisfy (matching ResourceSpec,
 *      both Processes share a parent H3 cell at `resolution`).
 *   2. For each match: create a cross-cell Commitment pair:
 *        - output Commitment on B's Process (produce/transfer the spec)
 *        - input Commitment on A's Process (consume the spec, satisfies the Intent)
 *   3. Return a NEW Scenario with:
 *        - processes = A.processes ∪ B.processes
 *        - commitments = A.commitments ∪ B.commitments ∪ newCommitments
 *        - deficits = A.deficits minus resolved ones ∪ B remaining deficits
 *        - id = computeScenarioId(all commitment signatures)
 *
 * The returned Scenario has a NEW deterministic ID — two workers that independently
 * merge the same A and B produce the same merged Scenario ID.
 *
 * Returns MergeConflict if the merge is infeasible.
 */
export function mergeScenarios(
    a: Scenario,
    b: Scenario,
    resolution: number,
    locations: Map<string, SpatialThing>,
    generateId: () => string,
): Scenario | MergeConflict {
    // Both scenarios must share a parent H3 cell at `resolution`.
    // We use origin_cell (the canonical leaf cell) rather than Process.atLocation,
    // which may be unset. mergeFrontier() already groups by shared parent, so this
    // guard is a defensive consistency check.
    const aRes = h3.getResolution(a.origin_cell);
    const bRes = h3.getResolution(b.origin_cell);
    if (aRes < resolution || bRes < resolution) {
        return {
            type: 'no_common_parent',
            detail: `Scenario ${a.id} (res ${aRes}) or ${b.id} (res ${bRes}) is below merge resolution ${resolution}`,
        };
    }
    const aParent = h3.cellToParent(a.origin_cell, resolution);
    const bParent = h3.cellToParent(b.origin_cell, resolution);
    if (aParent !== bParent) {
        return {
            type: 'no_common_parent',
            detail: `No shared parent at res ${resolution}: ${a.id} → ${aParent}, ${b.id} → ${bParent}`,
        };
    }

    // Build a lookup: spec_id → surpluses in B
    const bSurplusMap = new Map<string, number>();
    for (const surplus of b.surpluses) {
        const prev = bSurplusMap.get(surplus.spec_id) ?? 0;
        bSurplusMap.set(surplus.spec_id, prev + surplus.quantity);
    }

    const newCommitments = new Map<string, Commitment>();
    const resolvedDeficitIntentIds = new Set<string>();

    // Try to resolve each deficit in A using B's surpluses
    for (const deficit of a.deficits) {
        if (!deficit.spec_id) continue;
        const available = bSurplusMap.get(deficit.spec_id) ?? 0;
        if (available <= 0) continue;

        const qty = Math.min(deficit.remaining_quantity || available, available);

        // Output side: B transfers toward A.
        // Transfer Commitments in VF are process-free — outputOf/inputOf are intentionally unset.
        const outId = generateId();
        const outCommitment: Commitment = {
            id: outId,
            action: 'transfer',
            resourceConformsTo: deficit.spec_id,
            resourceQuantity: { hasNumericalValue: qty, hasUnit: 'unit' },
            finished: false,
        };

        // Input side: A receives, satisfying the deficit Intent.
        const inId = generateId();
        const inCommitment: Commitment = {
            id: inId,
            action: 'transfer',
            resourceConformsTo: deficit.spec_id,
            resourceQuantity: { hasNumericalValue: qty, hasUnit: 'unit' },
            satisfies: deficit.intent_id,
            finished: false,
        };

        newCommitments.set(outId, outCommitment);
        newCommitments.set(inId, inCommitment);
        resolvedDeficitIntentIds.add(deficit.intent_id);

        // Reduce B's surplus
        const remaining = available - qty;
        if (remaining > 0) {
            bSurplusMap.set(deficit.spec_id, remaining);
        } else {
            bSurplusMap.delete(deficit.spec_id);
        }
    }

    // Build merged maps
    const mergedProcesses   = new Map([...a.processes, ...b.processes]);
    const mergedCommitments = new Map([...a.commitments, ...b.commitments, ...newCommitments]);

    // Remaining deficits = A's unresolved + B's deficits
    const mergedDeficits = [
        ...a.deficits.filter(d => !resolvedDeficitIntentIds.has(d.intent_id)),
        ...b.deficits,
    ];

    // Remaining surpluses = B's reduced surpluses + A's surpluses
    const mergedSurpluses = [
        ...a.surpluses,
        ...[...bSurplusMap.entries()].map(([spec_id, quantity]) => ({ spec_id, quantity })),
    ];

    // Compute new deterministic ID from all Commitment signatures
    const allSigs = [...mergedCommitments.values()].map(c => {
        // For cross-cell Commitments without a process location, use origin_cell
        const loc = undefined; // TODO: resolve from locations map when process is known
        return commitmentSignature(c, loc, resolution);
    });
    const mergedId = computeScenarioId(allSigs);

    // Merged resolution = coarser of the two
    const mergedResolution = Math.min(a.resolution, b.resolution, resolution);

    // Placeholder score — caller should call scoreScenario() after merge
    const mergedScore: ScenarioScore = {
        coverage: 0,
        intents_satisfied: 0,
        intents_total: a.score.intents_total + b.score.intents_total,
        total_effort_hours: a.score.total_effort_hours + b.score.total_effort_hours,
        deficit_specs: mergedDeficits.filter(d => d.spec_id).map(d => d.spec_id!),
        h3_depth: mergedResolution,
    };

    return {
        id: mergedId,
        processes: mergedProcesses,
        commitments: mergedCommitments,
        deficits: mergedDeficits,
        surpluses: mergedSurpluses,
        score: mergedScore,
        origin_cell: a.origin_cell,   // keep A's origin for further merging
        resolution: mergedResolution,
    };
}

// =============================================================================
// MERGE FRONTIER
// =============================================================================

/**
 * One level of the bottom-up planning search.
 *
 * Takes a list of Scenarios at the current resolution, finds all pairs whose
 * Processes share a parent cell at `resolution`, attempts merge, prunes
 * dominated results, and returns the new Pareto front.
 *
 * Call repeatedly from leaf_resolution → root_resolution:
 *
 *   let frontier = leafScenarios;
 *   for (let res = leafRes - 1; res >= rootRes; res--) {
 *     frontier = mergeFrontier(index, frontier, res, locations, generateId, allIntents);
 *   }
 *   const winning = paretoFront(frontier)[policyFn];
 */
export function mergeFrontier(
    index: ScenarioIndex,
    scenarios: Scenario[],
    resolution: number,
    locations: Map<string, SpatialThing>,
    generateId: () => string,
    allIntents: Intent[],
): Scenario[] {
    const seen = new Set<string>(); // deduplicate by scenarioId
    const result: Scenario[] = [];

    // Group scenarios whose origin_cell shares a parent at this resolution
    const byParent = new Map<string, Scenario[]>();
    for (const s of scenarios) {
        if (h3.getResolution(s.origin_cell) < resolution) continue;
        const parent = h3.cellToParent(s.origin_cell, resolution);
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent)!.push(s);
    }

    for (const [, group] of byParent) {
        if (group.length === 1) {
            // Nothing to merge — promote as-is
            const s = group[0];
            if (!seen.has(s.id)) { seen.add(s.id); result.push(s); }
            continue;
        }

        // Try all pairs within the group
        const merged: Scenario[] = [];
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const m = mergeScenarios(group[i], group[j], resolution, locations, generateId);
                if ('type' in m) continue; // conflict — skip
                // Recompute proper score
                m.score = scoreScenario(m, allIntents);
                if (!seen.has(m.id)) {
                    seen.add(m.id);
                    merged.push(m);
                }
            }
        }

        // Also keep the unmergeable originals
        for (const s of group) {
            if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
        }

        // Prune to Pareto front within this parent group
        result.push(...paretoFront(merged));
    }

    // Add merged Scenarios to the index
    for (const s of result) {
        addScenarioToIndex(index, s, locations);
    }

    return result;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get all Scenario IDs at a specific H3 cell and processSpec.
 * O(1) — direct node lookup by deterministic key.
 */
export function queryScenariosAtNode(
    index: ScenarioIndex,
    h3Cell: string,
    processSpec: string,
): Scenario[] {
    const key  = scenarioNodeKey(h3Cell, processSpec);
    const node = index.nodes.get(key);
    if (!node) return [];
    return [...node.scenario_ids]
        .map(id => index.scenarios.get(id)!)
        .filter(Boolean);
}

/**
 * Get all Scenario IDs at an H3 cell (any processSpec).
 * Returns all Scenarios present at this cell regardless of operation type.
 */
export function queryScenariosAtCell(
    index: ScenarioIndex,
    h3Cell: string,
): Scenario[] {
    const ids = new Set<string>();
    for (const [key, node] of index.nodes) {
        if (node.cell === h3Cell) {
            for (const id of node.scenario_ids) ids.add(id);
        }
    }
    return [...ids].map(id => index.scenarios.get(id)!).filter(Boolean);
}

/**
 * Get the ScenarioNode for a specific (cell, processSpec) address.
 * Analogous to queryHexIndex.
 */
export function queryScenarioNode(
    index: ScenarioIndex,
    h3Cell: string,
    processSpec: string,
): ScenarioNode | null {
    return index.nodes.get(scenarioNodeKey(h3Cell, processSpec)) ?? null;
}

/**
 * All Scenarios on the global Pareto front across the entire index.
 * Call after the last mergeFrontier pass to get candidates for Plan selection.
 */
export function globalParetoFront(index: ScenarioIndex): Scenario[] {
    return paretoFront([...index.scenarios.values()]);
}

// =============================================================================
// COMMIT — Scenario → Plan
// =============================================================================

/**
 * Promote the winning Scenario to a committed VF Plan.
 *
 * Binds all Processes and Commitments to a new Plan record.
 * The Scenario's open deficits become the Plan's hasIndependentDemand.
 *
 * This is the only function that writes to PlanStore — the search itself
 * is fully in-memory and never touches the persistent store.
 */
export function scenarioToPlan(
    scenario: Scenario,
    addPlan: (plan: Omit<Plan, 'id'> & { id?: string }) => Plan,
    updateProcess: (id: string, patch: Partial<Process>) => void,
    updateCommitment: (id: string, patch: Partial<Commitment>) => void,
    options: { name?: string; due?: string } = {},
): Plan {
    const plan = addPlan({
        name: options.name ?? `plan-${scenario.id}`,
        due: options.due,
        // hasIndependentDemand: remaining open deficit Intent IDs
        // (not a standard VF field — extend as needed)
    });

    // Bind all processes to the plan
    for (const process of scenario.processes.values()) {
        updateProcess(process.id, { plannedWithin: plan.id });
    }

    // Bind all commitments to the plan
    for (const commitment of scenario.commitments.values()) {
        updateCommitment(commitment.id, { plannedWithin: plan.id });
    }

    return plan;
}


