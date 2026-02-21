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
 *   2. Check on-hand inventory for conforming resources
 *   3. Allocate available inventory to satisfy demand (soft allocation)
 *   4. For remaining unfilled demand, find a Recipe that produces that spec
 *   5. Back-schedule the Recipe Process(es), create Commitments in the plan
 *   6. For each input of those processes, recurse (step 1)
 *   7. If no recipe and no inventory, create a purchase Intent
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
import type { RecipeStore } from '../knowledge/recipes';
import type { PlanStore } from '../planning/planning';
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
    commitments: Commitment[];
    /** Purchase intents — inputs with no recipe (need to source externally) */
    purchaseIntents: Intent[];
    allocated: DemandAllocation[];
}

interface DemandTask {
    specId: string;
    quantity: number;
    neededBy: Date;
    /** The process that needs this input (for commitment linkage) */
    forProcessId?: string;
    /** Unit for quantities */
    unit: string;
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

    const result: DependentDemandResult = {
        plan,
        processes: [],
        commitments: [],
        purchaseIntents: [],
        allocated: [],
    };

    // Prevent infinite recursion (circular recipes)
    const visited = new Set<string>();

    // Work queue: demands to satisfy
    const queue: DemandTask[] = [{
        specId: demandSpecId,
        quantity: demandQuantity,
        neededBy: dueDate,
        unit: recipeStore.getResourceSpec(demandSpecId)?.defaultUnitOfResource ?? 'each',
    }];

    while (queue.length > 0) {
        const demand = queue.shift()!;
        processDemand(demand, visited, queue, result, params);
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
): void {
    const { recipeStore, planStore, processes, observer, agents, planId } = params;

    // --- Step 1: Net against inventory ---
    let remaining = demand.quantity;

    if (observer) {
        const available = observer.conformingResources(demand.specId)
            .filter(r => (r.accountingQuantity?.hasNumericalValue ?? 0) > 0);

        // Allocate to demand (highest-priority = earliest due date, already processing in order)
        for (const r of available) {
            if (remaining <= 0) break;
            const avail = r.accountingQuantity?.hasNumericalValue ?? 0;
            const take = Math.min(avail, remaining);
            result.allocated.push({ specId: demand.specId, resourceId: r.id, quantity: take });
            remaining -= take;
        }
    }

    if (remaining <= 0) return; // Fully covered by inventory

    // --- Step 2: Find recipe that produces this spec ---
    const recipe = recipeStore.recipeForOutput(demand.specId);

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

    // Compute scale factor: how many recipe-runs needed to satisfy demand
    const lastProcess = chain[chain.length - 1];
    const { outputs: lastOutputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryOutputFlow = lastOutputs.find(f => f.resourceConformsTo === demand.specId);
    const recipeOutputQty = primaryOutputFlow?.resourceQuantity?.hasNumericalValue ?? 1;
    const scaleFactor = remaining / recipeOutputQty;

    // --- Step 4: Back-schedule processes and create commitments ---
    let cursor = demand.neededBy;
    const orderedChain = [...chain].reverse(); // back-schedule: from due date towards past

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

        // Create output commitments/intents
        for (const flow of outputs) {
            const c = createFlowCommitment(flow, process.id, 'output', scaleFactor, processEnd, planId, agents, planStore);
            result.commitments.push(c);
        }

        // Create input commitments and enqueue sub-demands
        for (const flow of inputs) {
            const c = createFlowCommitment(flow, process.id, 'input', scaleFactor, processBegin, planId, agents, planStore);
            result.commitments.push(c);

            // Recurse: enqueue a demand for each input spec
            if (flow.resourceConformsTo) {
                const inputQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;
                if (inputQty > 0) {
                    queue.push({
                        specId: flow.resourceConformsTo,
                        quantity: inputQty,
                        neededBy: processBegin,
                        forProcessId: process.id,
                        unit: flow.resourceQuantity?.hasUnit ?? 'each',
                    });
                }
            }
        }
    }

    // Allow this recipe to be used again for different demand items
    visited.delete(recipe.id);
}

function createFlowCommitment(
    flow: RecipeFlow,
    processId: string,
    direction: 'input' | 'output',
    scaleFactor: number,
    dueDate: Date,
    planId: string,
    agents: { provider?: string; receiver?: string } | undefined,
    planStore: PlanStore,
): Commitment {
    const scaledQty = flow.resourceQuantity
        ? { hasNumericalValue: flow.resourceQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.resourceQuantity.hasUnit }
        : undefined;
    const scaledEffort = flow.effortQuantity
        ? { hasNumericalValue: flow.effortQuantity.hasNumericalValue * scaleFactor, hasUnit: flow.effortQuantity.hasUnit }
        : undefined;

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
        provider: agents?.provider,
        receiver: agents?.receiver,
        due: dueDate.toISOString(),
        created: new Date().toISOString(),
        plannedWithin: planId,
        finished: false,
    });
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
