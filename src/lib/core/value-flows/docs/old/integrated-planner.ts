/**
 * Integrated Planner — VF-native implementation
 *
 * Implements the Generator loop described in PLANNING_SEARCH_ENGINE.md
 * using VF-native types throughout:
 *
 *   RecipeStore   → feasibility analysis (replaces planner.ts Strategy/FeasibleSet)
 *   Observer      → current inventory (replaces StockBook.stocks)
 *   LaborIndex    → labour capacity (same module, works on Person[])
 *   IndependentDemandIndex → open demand (replaces finalTargets)
 *
 * Pipeline per H3 leaf cell:
 *   1. Build VF feasible recipes  (forward pass)
 *   2. VF backward pass           (D-series needs loop, SNLT optimisation)
 *   3. VF Builder                 (planStore.instantiateRecipe per selected recipe)
 *   4. Package as Scenario        (space-time-scenario.ts)
 *
 * Then drive the multi-resolution merge search:
 *   5. mergeFrontier leaf→root    (space-time-scenario.ts)
 *   6. Pareto prune + promote     (space-time-scenario.ts)
 */

import { nanoid } from 'nanoid';
import type { Intent, Plan, Process, Commitment, SpatialThing, Agent } from '../../schemas';
import { ACTION_DEFINITIONS } from '../../schemas';
import type { DemandSlot } from '../../indexes/independent-demand';
import { RecipeStore } from '../../knowledge/recipes';
import { Observer } from '../../observation/observer';
import {
    buildAgentIndex,
    queryAgentsBySpec,
    getTotalAgentHours,
    type AgentIndex,
} from '../../indexes/agents';
import {
    type Scenario,
    type ScenarioIndex,
    createScenarioIndex,
    addScenarioToIndex,
    scoreScenario,
    computeScenarioId,
    commitmentSignature,
    mergeFrontier,
    globalParetoFront,
    scenarioToPlan,
} from '../../utils/space-time-scenario';
import { PlanStore } from '../../planning/planning';

// =============================================================================
// INFRASTRUCTURE TAG
// =============================================================================

const TAG_INFRASTRUCTURE = 'tag:plan:MeansOfProduction';

// =============================================================================
// CONFIG
// =============================================================================

export interface IntegratedPlannerConfig {
    /** H3 resolution for leaf nodes (~0.1 km²). Default 9. */
    leafResolution: number;
    /** H3 resolution for root nodes (regional). Default 3. */
    rootResolution: number;
    /**
     * Base insurance fraction (buffer stock).
     * Applied on top of all primary demand totals.
     * Per-recipe variance increases this when known. Default 0.10.
     */
    insuranceFactor: number;
    /** Planning horizon in days. Default 7. */
    horizonDays: number;
}

export const DEFAULT_CONFIG: IntegratedPlannerConfig = {
    leafResolution: 9,
    rootResolution: 3,
    insuranceFactor: 0.10,
    horizonDays: 7,
};

// =============================================================================
// VF-NATIVE PLANNING TYPES
// =============================================================================

/**
 * Feasibility envelope for one Recipe at a given inventory + labour state.
 *
 * Replaces planner.ts `FeasibleStrategy` — computed entirely from VF types.
 */
interface VfFeasibleRecipe {
    recipe: import('../../schemas').Recipe;
    /** ResourceSpecification ID produced as primary output. */
    outputSpecId: string;
    /** Per-execution output quantity. */
    outputQty: number;
    /** Total effort hours per execution across the whole process chain. */
    effortHours: number;
    /** SNLT per output unit: effortHours / outputQty.  Lower = more efficient. */
    snltPerUnit: number;
    /** Max executions bounded by available input materials. */
    maxByMaterial: number;
    /** Max executions bounded by available labour capacity. */
    maxByLabor: number;
    /** Effective ceiling: Math.min(maxByMaterial, maxByLabor). */
    maxExecutions: number;
}

/**
 * A recipe selected for execution during the backward pass.
 */
interface VfSelectedRecipe {
    recipe: import('../../schemas').Recipe;
    executions: number;
    /** Total quantity produced in this selection. */
    quantity: number;
    /** Primary output spec. */
    outputSpecId: string;
    /** Which planning category drove this selection. */
    purpose: 'infrastructure' | 'primary' | 'intermediate' | 'insurance';
    /**
     * The DemandSlot.intent_id this selection satisfies.
     * Set for D4/D5/D6 selections; undefined for D1, intermediate, and D3.
     * Used by buildRecipeGraph() to set Commitment.satisfies so that
     * scoreScenario() can count coverage correctly.
     */
    intentId?: string;
}

/**
 * Result of the VF-native backward pass.
 */
interface VfProductionPlan {
    selectedRecipes: VfSelectedRecipe[];
    /** D2: specs where needed > feasible. */
    expansionSignals: Array<{ specId: string; needed: number; feasible: number; gap: number }>;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Sum the accounting quantity for all Observer entries conforming to `specId`.
 */
function availableQtyForSpec(observer: Observer, specId: string): number {
    return observer.inventoryForSpec(specId)
        .reduce((sum, e) => sum + e.accountingQty, 0);
}

/**
 * Returns true for recipe flow actions that DEPLETE inventory when executed.
 *
 * Derived directly from ACTION_DEFINITIONS so any future VF actions
 * are classified correctly without code changes here.
 *
 * `use` and `cite` have accountingEffect:'noEffect' — durable, not depleted.
 * `work` is handled separately and never reaches this check.
 * Everything else (consume, lower, combine, pickup, …) decrements.
 */
function isDepletingAction(action: string): boolean {
    const def = ACTION_DEFINITIONS[action as keyof typeof ACTION_DEFINITIONS];
    if (!def) return true; // unknown → treat as depleting (safe default)
    return def.accountingEffect !== 'noEffect';
}


// =============================================================================
// INFRASTRUCTURE (MEANS OF PRODUCTION) AUTO-DISCOVERY
// =============================================================================

/**
 * Walk every recipe in the catalog and collect all ResourceSpecification IDs
 * that appear as non-depleting (use/cite) inputs.
 *
 * These are structurally Means of Production: they are applied but not consumed.
 * The map value is the maximum quantity of that spec required by any single recipe
 * (the minimum viable inventory to run at least one execution of the most demanding
 * recipe that uses this tool).
 */
function discoverInfrastructureSpecs(recipeStore: RecipeStore): Map<string, number> {
    const infraSpecs = new Map<string, number>();
    for (const recipe of recipeStore.allRecipes()) {
        const chain = recipeStore.getProcessChain(recipe.id);
        for (const rp of chain) {
            const { inputs } = recipeStore.flowsForProcess(rp.id);
            for (const flow of inputs) {
                if (!flow.resourceConformsTo || flow.action === 'work') continue;
                if (isDepletingAction(flow.action)) continue; // consumed, not infrastructure
                const qty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                if (qty <= 0) continue;
                const prev = infraSpecs.get(flow.resourceConformsTo) ?? 0;
                infraSpecs.set(flow.resourceConformsTo, Math.max(prev, qty));
            }
        }
    }
    return infraSpecs;
}

/**
 * Compute infrastructure reproduction targets from the recipe graph and current Observer state.
 *
 * For each structurally-discovered infrastructure spec: if current inventory < the minimum
 * quantity needed to run any recipe that uses it, the gap is a reproduction need.
 *
 * External `overrides` (e.g. depreciation-based targets from callers who have
 * lifespan data) are merged in and take precedence over auto-computed values.
 */
function computeInfrastructureTargets(
    recipeStore: RecipeStore,
    observer: Observer,
    overrides: Record<string, number> = {},
): Record<string, number> {
    const infraSpecs = discoverInfrastructureSpecs(recipeStore);
    const targets: Record<string, number> = {};

    for (const [specId, neededQty] of infraSpecs) {
        const current = availableQtyForSpec(observer, specId);
        if (current < neededQty) {
            targets[specId] = neededQty - current;
        }
    }

    // Explicit caller overrides win (they may have depreciation / lifespan data)
    return { ...targets, ...overrides };
}

// =============================================================================
// PHASE 1: BUILD VF FEASIBLE RECIPES (FORWARD PASS)
// =============================================================================

/**
 * Compute feasibility envelopes for every recipe in the catalog.
 *
 * Returns a Map<outputSpecId, VfFeasibleRecipe[]> where each list is sorted
 * ascending by snltPerUnit (most efficient first), matching the ordering
 * used by `strategyEfficiency` in planner.ts.
 *
 * Labour capacity is queried from the LaborIndex; inventory from Observer.
 */
function buildVfFeasibleRecipes(
    recipeStore: RecipeStore,
    observer: Observer,
    agentIndex: AgentIndex,
): Map<string, VfFeasibleRecipe[]> {
    const bySpec = new Map<string, VfFeasibleRecipe[]>();

    for (const recipe of recipeStore.allRecipes()) {
        const chain = recipeStore.getProcessChain(recipe.id);
        if (chain.length === 0) continue;

        // ── Collect all flows across the chain ───────────────────────────────
        type ConsumedInput = { specId: string; qty: number };
        type DurableInput  = { specId: string; qty: number }; // use / cite — existence gate only
        type WorkSpec      = { skillSpecId: string; hours: number };

        const consumedInputs: ConsumedInput[] = [];
        const durableInputs:  DurableInput[]  = [];
        const workInputs: WorkSpec[] = [];
        const outputFlows: Array<{ specId: string; qty: number }> = [];
        let totalEffortHours = 0;

        for (const rp of chain) {
            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

            for (const flow of inputs) {
                if (!flow.resourceConformsTo) continue;
                if (flow.action === 'work') {
                    const hours = flow.effortQuantity?.hasNumericalValue ?? 0;
                    if (hours > 0) {
                        workInputs.push({ skillSpecId: flow.resourceConformsTo, hours });
                        totalEffortHours += hours;
                    }
                } else if (isDepletingAction(flow.action)) {
                    // Consumed material — subtracts from stock on each execution
                    const qty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                    if (qty > 0) consumedInputs.push({ specId: flow.resourceConformsTo, qty });
                } else {
                    // Durable (use/cite) — must exist but is not consumed
                    const qty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                    if (qty > 0) durableInputs.push({ specId: flow.resourceConformsTo, qty });
                }
            }

            for (const flow of outputs) {
                if (!flow.resourceConformsTo || flow.action === 'work') continue;
                const qty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                if (qty > 0) {
                    outputFlows.push({ specId: flow.resourceConformsTo, qty });
                }
            }
        }

        if (outputFlows.length === 0) continue; // Nothing produced

        // ── Identify primary output ───────────────────────────────────────────
        const primarySpecId =
            recipe.primaryOutput ??
            outputFlows[0].specId;
        const primaryFlow = outputFlows.find(f => f.specId === primarySpecId);
        if (!primaryFlow || primaryFlow.qty <= 0) continue;

        const outputQty    = primaryFlow.qty;
        const snltPerUnit  = totalEffortHours > 0 ? totalEffortHours / outputQty : 0;

        // ── Feasibility by material ───────────────────────────────────────────
        // Consumed inputs: divide available stock by required qty per execution.
        // Durable inputs: existence gate — if the tool doesn't exist, zero executions.
        let maxByMaterial = Infinity;
        for (const { specId, qty } of consumedInputs) {
            const avail = availableQtyForSpec(observer, specId);
            if (qty > 0) {
                maxByMaterial = Math.min(maxByMaterial, Math.floor(avail / qty));
            }
        }
        // A missing durable tool means the recipe cannot run at all.
        for (const { specId, qty } of durableInputs) {
            const avail = availableQtyForSpec(observer, specId);
            if (avail < qty) { maxByMaterial = 0; break; }
        }

        // ── Feasibility by labour ─────────────────────────────────────────────
        let maxByLabor = Infinity;
        for (const { skillSpecId, hours } of workInputs) {
            const caps  = queryAgentsBySpec(agentIndex, skillSpecId);
            const total = getTotalAgentHours(caps);
            if (hours > 0) {
                maxByLabor = Math.min(maxByLabor, Math.floor(total / hours));
            }
        }
        if (workInputs.length === 0) maxByLabor = Infinity; // No labour constraint

        const maxExecutions =
            maxByMaterial === Infinity && maxByLabor === Infinity
                ? Infinity
                : Math.min(
                    maxByMaterial === Infinity ? Infinity : maxByMaterial,
                    maxByLabor    === Infinity ? Infinity : maxByLabor,
                  );

        const feasible: VfFeasibleRecipe = {
            recipe,
            outputSpecId: primarySpecId,
            outputQty,
            effortHours: totalEffortHours,
            snltPerUnit,
            maxByMaterial,
            maxByLabor,
            maxExecutions,
        };

        // Register under primary spec
        if (!bySpec.has(primarySpecId)) bySpec.set(primarySpecId, []);
        bySpec.get(primarySpecId)!.push(feasible);

        // Also register under non-primary output specs (for substitution lookup)
        for (const { specId } of outputFlows) {
            if (specId === primarySpecId) continue;
            if (!bySpec.has(specId)) bySpec.set(specId, []);
            // Clone with the non-primary output as the reference
            const nonPrimary = outputFlows.find(f => f.specId === specId)!;
            const snlt2 = totalEffortHours > 0 ? totalEffortHours / nonPrimary.qty : 0;
            bySpec.get(specId)!.push({
                ...feasible,
                outputSpecId: specId,
                outputQty: nonPrimary.qty,
                snltPerUnit: snlt2,
            });
        }
    }

    // Sort each group by snltPerUnit ascending (most SNLT-efficient first)
    for (const list of bySpec.values()) {
        list.sort((a, b) => a.snltPerUnit - b.snltPerUnit);
    }

    return bySpec;
}

// =============================================================================
// PHASE 2: VF-NATIVE BACKWARD PASS (D-SERIES NEEDS LOOP)
// =============================================================================

const MAX_RECURSION_DEPTH = 10;

/**
 * VF-native backward pass — implements the Generator loop from
 * PLANNING_SEARCH_ENGINE.md in VF terms.
 *
 * Processing order (criticality, highest first):
 *   Infrastructure → intermediate supply chain → Insurance → Administration → Consumption → Support
 *
 * For each demanded spec:
 *   1. Use remaining inventory first.
 *   2. Select the most SNLT-efficient feasible recipe(s).
 *   3. Recipe inputs become new intermediate demands (recursive).
 *   4. Emit expansion signal when needed > feasible.
 *
 * Insurance is applied after all primary demands are satisfied:
 *   select an additional (total × insuranceFactor) of each spec.
 *
 * @param demands               Open demand slots (final needs).
 * @param feasibleBySpec        Feasibility envelopes per spec (from buildVfFeasibleRecipes).
 * @param observer              For reading current inventory.
 * @param recipeStore           For reading recipe structure during recursion.
 * @param config                Planning parameters.
 * @param infrastructureTargets Optional explicit infrastructure reproduction targets (specId → quantity).
 */
function vfPlanFromNeeds(
    demands: DemandSlot[],
    feasibleBySpec: Map<string, VfFeasibleRecipe[]>,
    observer: Observer,
    recipeStore: RecipeStore,
    config: IntegratedPlannerConfig,
    infrastructureTargets: Record<string, number> = {},
): VfProductionPlan {
    // Mutable remaining inventory (consumed as we plan)
    const remaining: Record<string, number> = {};
    for (const entry of observer.inventory()) {
        remaining[entry.spec] = (remaining[entry.spec] ?? 0) + entry.accountingQty;
    }

    const selectedRecipes: VfSelectedRecipe[] = [];
    const expansionSignals: VfProductionPlan['expansionSignals'] = [];

    // ── Inner recursive selector ──────────────────────────────────────────────
    function selectFor(
        specId: string,
        needed: number,
        purpose: VfSelectedRecipe['purpose'],
        depth: number,
        intentId?: string,
    ): void {
        if (needed <= 0 || depth > MAX_RECURSION_DEPTH) return;

        const originalNeeded = needed;

        // 1. Use available inventory first
        const fromStock = Math.min(remaining[specId] ?? 0, needed);
        remaining[specId] = (remaining[specId] ?? 0) - fromStock;
        needed -= fromStock;

        if (needed <= 0) return;

        // 2. Try feasible recipes (sorted by snltPerUnit)
        const candidates = feasibleBySpec.get(specId) ?? [];

        for (const candidate of candidates) {
            if (needed <= 0) break;

            // Compute max executions given CURRENT remaining inventory.
            // Only consumed (depleting) inputs constrain how many runs are possible.
            // Durable inputs (use/cite) require existence but do not deplete.
            const chain = recipeStore.getProcessChain(candidate.recipe.id);
            let maxExec = candidate.maxByLabor === Infinity
                ? Math.ceil(needed / candidate.outputQty)
                : candidate.maxByLabor;

            for (const rp of chain) {
                const { inputs } = recipeStore.flowsForProcess(rp.id);
                for (const flow of inputs) {
                    if (!flow.resourceConformsTo || flow.action === 'work') continue;
                    if (!isDepletingAction(flow.action)) {
                        // Durable — existence gate: if missing, zero executions possible
                        const reqQty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                        const avail  = remaining[flow.resourceConformsTo] ?? 0;
                        if (reqQty > 0 && avail < reqQty) { maxExec = 0; }
                        continue;
                    }
                    const reqQty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                    if (reqQty <= 0) continue;
                    const avail = remaining[flow.resourceConformsTo] ?? 0;
                    maxExec = Math.min(maxExec, Math.floor(avail / reqQty));
                }
            }

            if (maxExec <= 0) continue;

            const executionsNeeded = Math.ceil(needed / candidate.outputQty);
            const executions = Math.min(maxExec, executionsNeeded);
            const produced   = executions * candidate.outputQty;

            // 3. Consume material inputs from remaining inventory.
            // Durable inputs (use/cite) are NOT deducted — they are not consumed.
            for (const rp of chain) {
                const { inputs } = recipeStore.flowsForProcess(rp.id);
                for (const flow of inputs) {
                    if (!flow.resourceConformsTo || flow.action === 'work') continue;
                    if (!isDepletingAction(flow.action)) continue; // durable — no depletion
                    const qty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * executions;
                    remaining[flow.resourceConformsTo] = (remaining[flow.resourceConformsTo] ?? 0) - qty;

                    // If inventory goes negative, the deficit triggers an intermediate need
                    const deficit = -(remaining[flow.resourceConformsTo] ?? 0);
                    if (deficit > 0) {
                        remaining[flow.resourceConformsTo] = 0;
                        selectFor(flow.resourceConformsTo, deficit, 'intermediate', depth + 1);
                    }
                }
            }

            selectedRecipes.push({
                recipe:      candidate.recipe,
                executions,
                quantity:    produced,
                outputSpecId: candidate.outputSpecId,
                purpose,
                intentId,
            });
            needed -= produced;
        }

        // 4. D2 expansion signal if demand still unmet
        if (needed > 0) {
            const feasible = originalNeeded - needed;
            expansionSignals.push({ specId, needed: originalNeeded, feasible, gap: needed });
        }
    }

    // ── Infrastructure: Reproduction needs ───────────────────────────────────
    for (const [specId, qty] of Object.entries(infrastructureTargets)) {
        selectFor(specId, qty, 'infrastructure', 0);
    }

    // ── Primary demands (sorted by due date) ─────────────────────────────────
    const sortedDemands = demands
        .filter(s => s.spec_id)
        .sort((a, b) => new Date(a.due ?? 0).getTime() - new Date(b.due ?? 0).getTime());

    for (const slot of sortedDemands) {
        selectFor(slot.spec_id!, slot.remaining_quantity, 'primary', 0, slot.intent_id);
    }

    // ── Insurance ─────────────────────────────────────────────────────────────
    // For every primary selection, additionally plan
    // (quantity × insuranceFactor) as a safety buffer.
    if (config.insuranceFactor > 0) {
        const insuranceSnapshot = selectedRecipes.filter(
            s => s.purpose === 'infrastructure' || s.purpose === 'primary',
        );
        for (const sel of insuranceSnapshot) {
            const insuranceQty = sel.quantity * config.insuranceFactor;
            selectFor(sel.outputSpecId, insuranceQty, 'insurance', 0);
        }
    }

    return { selectedRecipes, expansionSignals };
}

// =============================================================================
// LEAF SCENARIO GENERATOR
// =============================================================================

export interface LeafScenarioParams {
    /** H3 cell at leafResolution. */
    h3Cell: string;
    /** Open demand slots for this cell. */
    demands: DemandSlot[];
    /** Current inventory. */
    observer: Observer;
    /** Agents whose `work` Intents express labour supply. */
    agents: Agent[];
    /** Open `work` Intents — combined with `agents` to build AgentIndex. */
    workIntents: Intent[];
    recipeStore: RecipeStore;
    planStore: PlanStore;
    /** All open Intents in scope (denominator for coverage scoring). */
    allIntents: Intent[];
    /** SpatialThing lookup: location ID → SpatialThing. */
    locations: Map<string, SpatialThing>;
    config: IntegratedPlannerConfig;
    /**
     * Optional infrastructure reproduction target overrides (specId → quantity).
     *
     * The planner auto-discovers infrastructure specs from recipe graph structure
     * (any resource that appears as a `use`/`cite` input) and computes their
     * reproduction needs from the Observer. Values provided here are MERGED
     * with auto-computed targets, with explicit values winning.
     *
     * Use this for depreciation-based targets that require external lifespan
     * or wear data not available in the Observer.
     */
    infrastructureTargets?: Record<string, number>;
}

/**
 * Generate a leaf Scenario for a single H3 cell.
 *
 * Full pipeline:
 *   Phase 1: buildVfFeasibleRecipes   — inventory + labour → feasibility envelopes
 *   Phase 2: vfPlanFromNeeds          — D-series backward pass → recipe selections
 *   Phase 3: PlanStore.instantiateRecipe — recipe selections → VF Processes + Commitments
 *   Package: Scenario with deterministic ID + Pareto score
 *
 * Returns null when `demands` is empty.
 */
export function generateLeafScenario(params: LeafScenarioParams): Scenario | null {
    const {
        h3Cell, demands, observer, agents, workIntents,
        recipeStore, planStore, allIntents, locations, config,
        infrastructureTargets = {},
    } = params;

    if (demands.length === 0) return null;

    // ── Build agent index (VF-native labour capacity) ─────────────────────────
    const horizonMs  = config.horizonDays * 24 * 60 * 60 * 1000;
    const agentIndex = buildAgentIndex(workIntents, agents, locations, config.leafResolution);

    // ── Phase 1: forward pass ─────────────────────────────────────────────────
    const feasibleBySpec = buildVfFeasibleRecipes(recipeStore, observer, agentIndex);

    if (feasibleBySpec.size === 0) {
        return buildDeficitOnlyScenario(h3Cell, demands, allIntents, config);
    }

    // ── Phase 2: backward pass ────────────────────────────────────────────────
    // Auto-compute infrastructure targets from recipe structure + Observer;
    // caller overrides (infrastructureTargets) take precedence — useful when
    // lifespan/depreciation data exists.
    const infraTargets = computeInfrastructureTargets(recipeStore, observer, infrastructureTargets);
    const productionPlan = vfPlanFromNeeds(
        demands, feasibleBySpec, observer, recipeStore, config, infraTargets,
    );

    // ── Phase 3: build in-memory recipe graphs (no PlanStore writes) ──────────
    const allProcesses   = new Map<string, Process>();
    const allCommitments = new Map<string, Commitment>();
    const producedBySpec: Record<string, number> = {};

    const dueDate =
        earliestDueDate(demands) ?? new Date(Date.now() + horizonMs);

    for (const sel of productionPlan.selectedRecipes) {
        const recipe = recipeStore.getRecipe(sel.recipe.id);
        if (!recipe || sel.quantity <= 0) continue;

        let graph: { processes: Process[]; commitments: Commitment[] };
        try {
            // Pure — no PlanStore writes. intentId sets satisfies on the
            // primary output Commitment so scoreScenario() counts coverage.
            graph = planStore.buildRecipeGraph(
                recipeStore, recipe.id, sel.quantity, dueDate, sel.intentId,
            );
        } catch {
            continue; // Recipe build failed — treat as deficit
        }

        for (const p of graph.processes)    allProcesses.set(p.id, p);
        for (const c of graph.commitments)  allCommitments.set(c.id, c);

        producedBySpec[sel.outputSpecId] =
            (producedBySpec[sel.outputSpecId] ?? 0) + sel.quantity;
    }

    // ── Compute deficits and surpluses ────────────────────────────────────────
    const demandBySpec: Record<string, { total: number; slots: DemandSlot[] }> = {};
    for (const slot of demands) {
        if (!slot.spec_id) continue;
        if (!demandBySpec[slot.spec_id]) {
            demandBySpec[slot.spec_id] = { total: 0, slots: [] };
        }
        demandBySpec[slot.spec_id].total += slot.remaining_quantity;
        demandBySpec[slot.spec_id].slots.push(slot);
    }

    const deficits: DemandSlot[] = [];
    for (const [specId, { total: demanded, slots }] of Object.entries(demandBySpec)) {
        const produced = producedBySpec[specId] ?? 0;
        if (produced < demanded) {
            const fraction = (demanded - produced) / demanded;
            for (const slot of slots) {
                deficits.push({ ...slot, remaining_quantity: slot.remaining_quantity * fraction });
            }
        }
    }

    const surpluses: Scenario['surpluses'] = [];
    for (const [specId, produced] of Object.entries(producedBySpec)) {
        const demanded = demandBySpec[specId]?.total ?? 0;
        if (produced > demanded) {
            surpluses.push({ spec_id: specId, quantity: produced - demanded });
        }
    }

    // ── Build Scenario with deterministic ID ──────────────────────────────────
    const signatures = [...allCommitments.values()].map(c => {
        const loc = c.atLocation ? locations.get(c.atLocation) : undefined;
        return commitmentSignature(c, loc, config.leafResolution);
    });
    const id = computeScenarioId(signatures);

    const scenario: Scenario = {
        id,
        processes:   allProcesses,
        commitments: allCommitments,
        deficits,
        surpluses,
        score: {
            coverage: 0, intents_satisfied: 0, intents_total: 0,
            total_effort_hours: 0, deficit_specs: [], h3_depth: config.leafResolution,
        },
        origin_cell: h3Cell,
        resolution:  config.leafResolution,
    };
    scenario.score = scoreScenario(scenario, allIntents);

    if (productionPlan.expansionSignals.length > 0) {
        scenario.expansionSignals = productionPlan.expansionSignals;
    }

    return scenario;
}

// =============================================================================
// MULTI-RESOLUTION SEARCH
// =============================================================================

export interface PlanningSearchParams {
    /**
     * Open demand slots grouped by H3 leaf cell.
     * Build by querying IndependentDemandIndex per cell.
     */
    leafDemands: Map<string, DemandSlot[]>;
    observer: Observer;
    /** Agents whose `work` Intents express labour supply. */
    agents: Agent[];
    /**
     * All open Intents in scope.
     * `work` Intents are used to build AgentIndex (labour capacity);
     * all Intents are used as the denominator for coverage scoring.
     */
    allIntents: Intent[];
    recipeStore: RecipeStore;
    planStore: PlanStore;
    /** SpatialThing lookup: location ID → SpatialThing. */
    locations: Map<string, SpatialThing>;
    config?: Partial<IntegratedPlannerConfig>;
    /**
     * Optional explicit infrastructure reproduction targets per cell.
     * Key = h3Cell, value = { specId → quantity }.
     */
    infrastructureTargetsByCell?: Map<string, Record<string, number>>;
}

/**
 * Run the full bottom-up planning search.
 *
 * 1. Leaf pass:   generateLeafScenario() for each h3Cell in leafDemands.
 * 2. Merge passes: mergeFrontier() from (leafResolution−1) down to rootResolution.
 * 3. Pareto prune: globalParetoFront() over the whole index.
 *
 * The returned `front` contains the non-dominated Scenarios.
 * Pass the winner to promoteToPlan().
 */
export function runPlanningSearch(params: PlanningSearchParams): {
    index: ScenarioIndex;
    front: Scenario[];
} {
    const config: IntegratedPlannerConfig = { ...DEFAULT_CONFIG, ...params.config };
    const {
        leafDemands, observer, agents, allIntents, recipeStore, planStore,
        locations, infrastructureTargetsByCell,
    } = params;

    // Split allIntents: work Intents feed AgentIndex; all feed coverage scoring
    const workIntents = allIntents.filter(i => i.action === 'work' && i.provider);

    const index = createScenarioIndex(config.leafResolution, config.rootResolution);

    // ── Leaf pass ─────────────────────────────────────────────────────────────
    let frontier: Scenario[] = [];

    for (const [h3Cell, demands] of leafDemands) {
        const scenario = generateLeafScenario({
            h3Cell,
            demands,
            observer,
            agents,
            workIntents,
            recipeStore,
            planStore,
            allIntents,
            locations,
            config,
            infrastructureTargets: infrastructureTargetsByCell?.get(h3Cell),
        });
        if (!scenario) continue;
        addScenarioToIndex(index, scenario, locations);
        frontier.push(scenario);
    }

    // ── Merge passes ─────────────────────────────────────────────────────────
    const generateId = () => nanoid();
    for (let res = config.leafResolution - 1; res >= config.rootResolution; res--) {
        frontier = mergeFrontier(index, frontier, res, locations, generateId, allIntents);
    }

    return { index, front: globalParetoFront(index) };
}

// =============================================================================
// PLAN PROMOTION
// =============================================================================

/**
 * Promote the winning Scenario to a committed VF Plan.
 *
 * This is the ONLY function that writes to PlanStore. The search itself
 * (generateLeafScenario + runPlanningSearch) is fully in-memory.
 *
 * Steps:
 *   1. Persist all Processes from the Scenario into ProcessRegistry.
 *   2. Persist all Commitments (including cross-cell transfers).
 *   3. Call scenarioToPlan() to create the Plan record and stamp
 *      plannedWithin on every Process and Commitment.
 */
export function promoteToPlan(
    scenario: Scenario,
    planStore: PlanStore,
    options?: { name?: string; due?: string },
): Plan {
    // 1. Register Processes (ProcessRegistry.register accepts pre-set IDs)
    for (const process of scenario.processes.values()) {
        if (!planStore.processes.get(process.id)) {
            planStore.processes.register(process);
        }
    }

    // 2. Register Commitments (addCommitment accepts pre-set IDs)
    for (const [id, commitment] of scenario.commitments) {
        if (!planStore.getCommitment(id)) {
            planStore.addCommitment(commitment);
        }
    }

    // 3. Promote — scenarioToPlan creates the Plan and stamps plannedWithin
    const updateProcess = (id: string, patch: Partial<Process>) => {
        const p = planStore.processes.get(id);
        if (p) Object.assign(p, patch);
    };

    const updateCommitment = (id: string, patch: Partial<Commitment>) => {
        const c = planStore.getCommitment(id);
        if (c) Object.assign(c, patch);
    };

    const plan = scenarioToPlan(
        scenario,
        planStore.addPlan.bind(planStore),
        updateProcess,
        updateCommitment,
        options,
    );

    // Stamp independentDemandOf on commitments that satisfy a demand intent.
    // Mirrors what instantiateRecipe() does for the direct instantiation path.
    const independentIds: string[] = [];
    for (const [id, commitment] of scenario.commitments) {
        if (commitment.satisfies) {
            const c = planStore.getCommitment(id);
            if (c) {
                c.independentDemandOf = plan.id;
                independentIds.push(id);
            }
        }
    }
    if (independentIds.length > 0) {
        plan.hasIndependentDemand = [
            ...(plan.hasIndependentDemand ?? []),
            ...independentIds,
        ];
    }

    return plan;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Build a deficit-only Scenario when no recipes are available for any spec.
 */
function buildDeficitOnlyScenario(
    h3Cell: string,
    demands: DemandSlot[],
    allIntents: Intent[],
    config: IntegratedPlannerConfig,
): Scenario {
    const id = computeScenarioId(
        demands.map(d => `${d.intent_id}|${d.spec_id ?? '_'}`),
    );
    const scenario: Scenario = {
        id,
        processes:   new Map(),
        commitments: new Map(),
        deficits:    [...demands],
        surpluses:   [],
        score: {
            coverage: 0, intents_satisfied: 0, intents_total: 0,
            total_effort_hours: 0,
            deficit_specs: demands.map(d => d.spec_id ?? '').filter(Boolean),
            h3_depth: config.leafResolution,
        },
        origin_cell: h3Cell,
        resolution:  config.leafResolution,
    };
    scenario.score = scoreScenario(scenario, allIntents);
    return scenario;
}

/**
 * Return the earliest due date from a set of demand slots, or null if none set.
 */
function earliestDueDate(demands: DemandSlot[]): Date | null {
    let earliest: Date | null = null;
    for (const slot of demands) {
        if (!slot.due) continue;
        const d = new Date(slot.due);
        if (!earliest || d < earliest) earliest = d;
    }
    return earliest;
}
