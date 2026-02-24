/**
 * Dependent Demand — Recursive demand explosion from the VF spec.
 *
 * From algorithms/dependent-demand.md:
 *   "Traverse a graph of Recipe Processes backwards from the last Recipe Output,
 *    connecting Recipe Inputs with Recipe Outputs that have matching Resource
 *    Categories, and backscheduling all the processes and resource requirements
 *    based on estimated process durations."
 *
 * Algorithm:
 *   1. Start with a demand: (specId, quantity, neededBy)
 *   2a. Check on-hand inventory for conforming resources
 *   2b. Check previously scheduled output Intents not yet allocated
 *   3. Allocate available inventory / Intents to satisfy demand (soft allocation)
 *   4. For remaining unfilled demand, find the most SNLT-efficient Recipe
 *   5. Back-schedule the Recipe Process(es), create Intents/Commitments in the plan
 *   6. For each input of those processes, recurse (step 1)
 *   7. If no recipe and no inventory, create a purchase Intent
 *
 * VF spec compliance:
 *   - Flows without both provider+receiver become Intents (not Commitments)
 *   - Durable inputs (use/cite — accountingEffect='noEffect') are existence gates only
 *   - Work inputs are labour commitments tracked via SNLT, not material sub-demands
 *   - Multiple recipes ranked by SNLT (most labour-efficient chosen first)
 *   - Previously scheduled output Intents netted against demand before recipe explosion
 *
 * Unlike instantiateRecipe(), this works at the demand level (single spec + qty)
 * and adds to an EXISTING plan rather than creating a new one.
 */

import type {
    Plan,
    Process,
    Commitment,
    Intent,
    RecipeFlow,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { PlanStore } from '../planning/planning';
import { PlanNetter } from '../planning/netting';
import type { Observer } from '../observation/observer';
import type { ProcessRegistry } from '../process-registry';

// =============================================================================
// TYPES
// =============================================================================

export interface DemandAllocation {
    specId: string;
    resourceId: string;
    quantity: number;
}

export interface DependentDemandResult {
    plan: Plan;
    processes: Process[];
    /** Bilateral process flows (both provider and receiver known) */
    commitments: Commitment[];
    /** Unilateral process flows (one or both agents unknown) */
    intents: Intent[];
    /** Purchase intents — inputs with no recipe (need to source externally) */
    purchaseIntents: Intent[];
    allocated: DemandAllocation[];
    /**
     * IDs of pre-existing scheduled outputs (Intents OR Commitments with outputOf set)
     * that were soft-allocated to satisfy demand during the explosion.
     */
    allocatedScheduledIds: Set<string>;
}

interface DemandTask {
    specId: string;
    quantity: number;
    neededBy: Date;
    /** The process that needs this input (for commitment linkage) */
    forProcessId?: string;
    /** Unit for quantities */
    unit: string;
    /**
     * Durable inputs (use/cite — accountingEffect='noEffect').
     * Existence gate only: does not deplete inventory, does not recurse.
     */
    isDurable?: boolean;
    /**
     * Required stage (ProcessSpecification ID) of a conforming resource.
     * VF spec (resources.md §Stage and state): dependent demand selects
     * only resources that fit the specified stage and state.
     */
    stage?: string;
    /** Required state string of a conforming resource. */
    state?: string;
    /** SpatialThing ID — where this input is needed. */
    atLocation?: string;
}

// =============================================================================
// DEPENDENT DEMAND
// =============================================================================

/**
 * Perform a full recursive dependent demand explosion.
 *
 * @param planId - The plan to add processes/commitments to (must exist in planStore)
 * @param demandSpecId - The resource specification being demanded
 * @param demandQuantity - How many are needed
 * @param dueDate - When the final output is required
 * @param recipeStore - Knowledge layer
 * @param planStore - Planning layer (adds to this plan)
 * @param observer - Optional: check inventory for netting
 * @param agents - Optional: assign provider/receiver on commitments
 */
export function dependentDemand(params: {
    planId: string;
    demandSpecId: string;
    demandQuantity: number;
    dueDate: Date;
    recipeStore: RecipeStore;
    planStore: PlanStore;
    processes: ProcessRegistry;
    observer?: Observer;
    agents?: { provider?: string; receiver?: string };
    generateId?: () => string;
    /** Optional shared netter — pass to share allocated state across algorithm calls (Mode C). */
    netter?: PlanNetter;
    /** SpatialThing ID — where the final output is needed. */
    atLocation?: string;
}): DependentDemandResult {
    const {
        planId,
        demandSpecId,
        demandQuantity,
        dueDate,
        recipeStore,
        planStore,
    } = params;

    const plan = planStore.getPlan(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    // Use the provided netter or create a fresh one (backward compatible).
    const netter = params.netter ?? new PlanNetter(planStore, params.observer);

    const result: DependentDemandResult = {
        plan,
        processes: [],
        commitments: [],
        intents: [],
        purchaseIntents: [],
        allocated: [],
        allocatedScheduledIds: netter.allocated,
    };

    // Prevent infinite recursion (circular recipes)
    const visited = new Set<string>();

    // Work queue: demands to satisfy
    const queue: DemandTask[] = [{
        specId: demandSpecId,
        quantity: demandQuantity,
        neededBy: dueDate,
        unit: recipeStore.getResourceSpec(demandSpecId)?.defaultUnitOfResource ?? 'each',
        atLocation: params.atLocation,
    }];

    while (queue.length > 0) {
        const demand = queue.shift()!;
        processDemand(demand, visited, queue, result, params, netter);
    }

    return result;
}

// =============================================================================
// INTERNAL
// =============================================================================

function processDemand(
    demand: DemandTask,
    visited: Set<string>,
    queue: DemandTask[],
    result: DependentDemandResult,
    params: Parameters<typeof dependentDemand>[0],
    netter: PlanNetter,
): void {
    const { recipeStore, planStore, processes, observer, agents, planId } = params;

    // --- Durable inputs: existence gate only ---
    // Actions with accountingEffect='noEffect' (use, cite) do not deplete
    // resources — we only check that a conforming resource exists.
    if (demand.isDurable) {
        if (observer) {
            const exists = observer.conformingResources(demand.specId)
                .some(r => {
                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                    if (demand.stage && r.stage !== demand.stage) return false;
                    if (demand.state && r.state !== demand.state) return false;
                    return true;
                });
            if (exists) return; // Present and accounted for
        }
        // Not available — signal that this durable resource must be sourced
        const intent = planStore.addIntent({
            action: 'transfer',
            receiver: agents?.receiver,
            resourceConformsTo: demand.specId,
            resourceQuantity: { hasNumericalValue: demand.quantity, hasUnit: demand.unit },
            due: demand.neededBy.toISOString(),
            plannedWithin: planId,
            inputOf: demand.forProcessId,
            atLocation: demand.atLocation,
            note: `Durable resource required (must be present): ${demand.quantity} ${demand.unit} of ${demand.specId}`,
            finished: false,
        });
        result.purchaseIntents.push(intent);
        return;
    }

    // --- Net against inventory + scheduled outputs via PlanNetter ---
    // VF spec: "on-hand inventory OR previously scheduled output Intents not yet allocated"
    // Extends to Commitments: when agents are known, planned outputs are Commitments,
    // not Intents — both represent WIP that should count against demand.
    const { remaining: afterNetting, inventoryAllocated } = netter.netDemand(
        demand.specId,
        demand.quantity,
        { stage: demand.stage, state: demand.state, neededBy: demand.neededBy, atLocation: demand.atLocation },
    );
    for (const alloc of inventoryAllocated) {
        result.allocated.push({ specId: demand.specId, resourceId: alloc.resourceId, quantity: alloc.quantity });
    }

    let remaining = afterNetting;

    if (remaining <= 0) return; // Fully covered by inventory / scheduled Intents

    // --- Step 2: Find most SNLT-efficient recipe that produces this spec ---
    const candidates = recipeStore.recipesForOutput(demand.specId);
    const recipe = candidates.length === 0
        ? undefined
        : candidates
              .map(r => ({ recipe: r, snlt: computeSnlt(recipeStore, r.id, demand.specId) }))
              .sort((a, b) => a.snlt - b.snlt)[0].recipe;

    if (!recipe) {
        // No recipe — create a purchase Intent for external sourcing
        const intent = planStore.addIntent({
            action: 'transfer',
            receiver: agents?.receiver,
            resourceConformsTo: demand.specId,
            resourceQuantity: { hasNumericalValue: remaining, hasUnit: demand.unit },
            due: demand.neededBy.toISOString(),
            plannedWithin: planId,
            inputOf: demand.forProcessId,
            atLocation: demand.atLocation,
            note: `External purchase required: ${remaining} ${demand.unit} of ${demand.specId}`,
            finished: false,
        });
        result.purchaseIntents.push(intent);
        return;
    }

    // Avoid re-exploding the same recipe (cycle protection)
    if (visited.has(recipe.id)) return;
    visited.add(recipe.id);

    // --- Step 3: Scale recipe to demanded quantity ---
    const chain = recipeStore.getProcessChain(recipe.id);
    if (chain.length === 0) return;

    const lastProcess = chain[chain.length - 1];
    const { outputs: lastOutputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryOutputFlow = lastOutputs.find(f => f.resourceConformsTo === demand.specId);
    const recipeOutputQty = primaryOutputFlow?.resourceQuantity?.hasNumericalValue ?? 1;
    const scaleFactor = remaining / recipeOutputQty;

    // --- Step 4: Back-schedule processes and create flow records ---
    // Collect specs produced internally by this chain (intermediate outputs).
    // Sub-demands for these specs are satisfied by other processes in the chain
    // and must not be enqueued as external demands or purchase intents.
    // Key = "specId|stage" so workflow processes with the same spec but different
    // stages are not conflated. Manufacturing recipes with no stage use "specId|".
    const internallyProduced = new Set<string>();
    for (const rp of chain) {
        const { outputs } = recipeStore.flowsForProcess(rp.id);
        for (const outFlow of outputs) {
            if (outFlow.resourceConformsTo) {
                internallyProduced.add(`${outFlow.resourceConformsTo}|${outFlow.stage ?? ''}`);
            }
        }
    }
    internallyProduced.delete(`${demand.specId}|${demand.stage ?? ''}`);

    let cursor = demand.neededBy;
    const orderedChain = [...chain].reverse(); // back-schedule: from due date towards past

    // If both agents are known, flows become Commitments; otherwise Intents.
    const hasAgents = !!(agents?.provider && agents?.receiver);

    for (const rp of orderedChain) {
        const durationMs = rpDurationMs(rp);
        const processEnd = new Date(cursor);
        const processBegin = new Date(cursor.getTime() - durationMs);
        cursor = processBegin;

        const process = processes.register({
            name: rp.name,
            note: rp.note,
            basedOn: rp.processConformsTo,
            classifiedAs: rp.processClassifiedAs,
            plannedWithin: planId,
            hasBeginning: processBegin.toISOString(),
            hasEnd: processEnd.toISOString(),
            finished: false,
        });
        result.processes.push(process);

        const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

        for (const flow of outputs) {
            const record = createFlowRecord(flow, process.id, 'output', scaleFactor, processEnd, planId, agents, planStore, demand.atLocation);
            if (hasAgents) {
                result.commitments.push(record as Commitment);
            } else {
                result.intents.push(record as Intent);
            }
        }

        for (const flow of inputs) {
            const record = createFlowRecord(flow, process.id, 'input', scaleFactor, processBegin, planId, agents, planStore, demand.atLocation);
            if (hasAgents) {
                result.commitments.push(record as Commitment);
            } else {
                result.intents.push(record as Intent);
            }

            if (flow.resourceConformsTo && !internallyProduced.has(`${flow.resourceConformsTo}|${flow.stage ?? ''}`)) {
                // Work flows are labour commitments tracked via SNLT/capacity;
                // they are not material sub-demands and must not recurse.
                if (flow.action === 'work') continue;

                // Durable inputs (use/cite) are existence gates only.
                const actionDef = ACTION_DEFINITIONS[flow.action];
                const isDurable = actionDef?.accountingEffect === 'noEffect';

                const inputQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;

                if (inputQty > 0 || isDurable) {
                    queue.push({
                        specId: flow.resourceConformsTo,
                        quantity: inputQty,
                        neededBy: processBegin,
                        forProcessId: process.id,
                        unit: flow.resourceQuantity?.hasUnit ?? 'each',
                        isDurable,
                        // Propagate stage/state requirements from the recipe flow so that
                        // inventory netting selects only correctly-staged resources.
                        // VF spec: resources.md §Stage and state.
                        stage: flow.stage,
                        state: flow.state,
                        // Propagate location: sub-processes in the same recipe chain
                        // run at the same location as the parent demand.
                        atLocation: demand.atLocation,
                    });
                }
            }
        }
    }

    // Allow this recipe to be used again for different demand items
    visited.delete(recipe.id);
}

/**
 * Create a Commitment (when both agents known) or Intent (when agents unknown)
 * from a RecipeFlow.
 */
function createFlowRecord(
    flow: RecipeFlow,
    processId: string,
    direction: 'input' | 'output',
    scaleFactor: number,
    dueDate: Date,
    planId: string,
    agents: { provider?: string; receiver?: string } | undefined,
    planStore: PlanStore,
    atLocation?: string,
): Commitment | Intent {
    // Validate action direction against VF spec
    const def = ACTION_DEFINITIONS[flow.action];
    if (def && def.inputOutput !== 'outputInput' && def.inputOutput !== 'notApplicable') {
        if (direction === 'input' && def.inputOutput !== 'input') {
            throw new Error(
                `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                `cannot be used as a process input.`
            );
        }
        if (direction === 'output' && def.inputOutput !== 'output') {
            throw new Error(
                `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                `cannot be used as a process output.`
            );
        }
    }

    const scaledQty = flow.resourceQuantity
        ? { hasNumericalValue: flow.resourceQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.resourceQuantity.hasUnit }
        : undefined;
    const scaledEffort = flow.effortQuantity
        ? { hasNumericalValue: flow.effortQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.effortQuantity.hasUnit }
        : undefined;

    const provider = agents?.provider;
    const receiver = agents?.receiver;

    if (provider && receiver) {
        return planStore.addCommitment({
            action: flow.action,
            inputOf: direction === 'input' ? processId : undefined,
            outputOf: direction === 'output' ? processId : undefined,
            resourceConformsTo: flow.resourceConformsTo,
            resourceClassifiedAs: flow.resourceClassifiedAs,
            resourceQuantity: scaledQty,
            effortQuantity: scaledEffort,
            stage: flow.stage,
            state: flow.state,
            provider,
            receiver,
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
            plannedWithin: planId,
            atLocation,
            finished: false,
        });
    }

    return planStore.addIntent({
        action: flow.action,
        inputOf: direction === 'input' ? processId : undefined,
        outputOf: direction === 'output' ? processId : undefined,
        resourceConformsTo: flow.resourceConformsTo,
        resourceClassifiedAs: flow.resourceClassifiedAs,
        resourceQuantity: scaledQty,
        effortQuantity: scaledEffort,
        stage: flow.stage,
        state: flow.state,
        provider,
        receiver,
        due: dueDate.toISOString(),
        plannedWithin: planId,
        atLocation,
        finished: false,
    });
}

/**
 * Compute SNLT (Socially Necessary Labour Time) for one recipe execution,
 * expressed as total work-hours per unit of primary output.
 *
 * Lower SNLT = more labour-efficient. Recipes with zero work flows have SNLT=0
 * (pure material transformation, maximally efficient from a labour standpoint).
 * Returns Infinity for degenerate recipes that produce zero output.
 */
function computeSnlt(recipeStore: RecipeStore, recipeId: string, specId: string): number {
    const chain = recipeStore.getProcessChain(recipeId);

    let totalWorkHours = 0;
    for (const rp of chain) {
        const { inputs } = recipeStore.flowsForProcess(rp.id);
        for (const flow of inputs) {
            if (flow.action === 'work') {
                totalWorkHours += flow.effortQuantity?.hasNumericalValue ?? 0;
            }
        }
    }

    const lastProcess = chain[chain.length - 1];
    if (!lastProcess) return Infinity;
    const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryFlow = outputs.find(f => f.resourceConformsTo === specId);
    const outputQty = primaryFlow?.resourceQuantity?.hasNumericalValue ?? 0;
    if (outputQty <= 0) return Infinity;

    return totalWorkHours / outputQty;
}

function rpDurationMs(rp: { hasDuration?: { hasNumericalValue: number; hasUnit: string } }): number {
    if (!rp.hasDuration) return 3_600_000; // default: 1 hour
    const { hasNumericalValue: v, hasUnit: u } = rp.hasDuration;
    switch (u) {
        case 'days': return v * 86_400_000;
        case 'hours': return v * 3_600_000;
        case 'minutes': return v * 60_000;
        case 'seconds': return v * 1_000;
        default: return v * 3_600_000; // assume hours
    }
}
