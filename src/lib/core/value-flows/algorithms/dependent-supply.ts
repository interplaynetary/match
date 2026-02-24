/**
 * Dependent Supply — Forward supply explosion from available input.
 *
 * The exact dual of dependent-demand.ts:
 *   - Entry: (specId, available quantity, availableFrom)
 *   - Direction: forward from input
 *   - Recipe lookup: recipesForInput(specId) — new RecipeStore method
 *   - Scheduling: forward-schedule from availableFrom
 *   - Input recursion: each output becomes a new supply (BFS forward)
 *   - Unfulfilled signal: surplus[] (supply that can't be absorbed)
 *   - Complementary needs: purchaseIntents[] (other inputs recipes need)
 *
 * Algorithm:
 *   1. Start with available supply: (specId, quantity, availableFrom)
 *   2. Find all recipes that consume this spec as input
 *   3. Sort by SNLT ascending (most labour-efficient first)
 *   4. Determine how many executions the supply allows (capped by other materials)
 *   5. Forward-schedule the recipe's process chain, create Intents/Commitments
 *   6. Outputs of each process become new supply tasks (BFS queue)
 *   7. Any supply not absorbed → surplus[]
 *   8. Complementary inputs not in inventory → purchaseIntents[]
 *
 * VF spec compliance:
 *   - Flows without both provider+receiver become Intents (not Commitments)
 *   - Durable inputs (use/cite — accountingEffect='noEffect') are existence gates
 *   - Work inputs are labour flows; excluded from material constraint computation
 *   - Multiple recipes ranked by SNLT (most efficient first)
 *   - Internally-produced intermediate specs not re-queued
 */

import type {
    Plan,
    Process,
    Commitment,
    Intent,
    RecipeFlow,
    RecipeProcess,
    EconomicResource,
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

export interface SupplyAllocation {
    specId: string;
    quantity: number;       // how much of the supply was absorbed into this recipe
    recipeId: string;
}

export interface DependentSupplyResult {
    plan: Plan;
    processes: Process[];
    /** Bilateral process flows (both agents known) */
    commitments: Commitment[];
    /** Unilateral process flows (one agent unknown) */
    intents: Intent[];
    /** Portions of each spec that could not be absorbed by any recipe. */
    surplus: Array<{ specId: string; quantity: number }>;
    /** Other inputs (not the starting supply) that recipes need but have no recipe to make. */
    purchaseIntents: Intent[];
    /** How much of each spec was absorbed into production. */
    absorbed: SupplyAllocation[];
}

interface SupplyTask {
    specId: string;
    quantity: number;
    availableFrom: Date;
    /**
     * True when this task was pushed by a process output (a derived supply).
     * Derived supply with no recipe to absorb it is a terminal product — NOT surplus.
     * Only original supply (isDerived=false) with no recipe to absorb it is surplus.
     */
    isDerived?: boolean;
    /** SpatialThing ID — where this supply is available. */
    atLocation?: string;
}

// =============================================================================
// DEPENDENT SUPPLY
// =============================================================================

/**
 * Perform a full recursive dependent supply explosion.
 *
 * @param planId - The plan to add processes/commitments to (must exist in planStore)
 * @param supplySpecId - The resource specification available as supply
 * @param supplyQuantity - How many are available
 * @param availableFrom - When the supply is available
 * @param recipeStore - Knowledge layer
 * @param planStore - Planning layer (adds to this plan)
 * @param processes - ProcessRegistry (shared with planning/observation)
 * @param observer - Optional: check inventory for complementary material constraints
 * @param agents - Optional: assign provider/receiver on commitments
 * @param generateId - Optional: ID generator (defaults to nanoid)
 */
export function dependentSupply(params: {
    planId: string;
    supplySpecId: string;
    supplyQuantity: number;
    availableFrom: Date;
    recipeStore: RecipeStore;
    planStore: PlanStore;
    processes: ProcessRegistry;
    observer?: Observer;
    agents?: { provider?: string; receiver?: string };
    generateId?: () => string;
    /** Optional shared netter — pass to share allocated state across algorithm calls (Mode C). */
    netter?: PlanNetter;
    /** SpatialThing ID — where the supply is available. */
    atLocation?: string;
}): DependentSupplyResult {
    const { planId, supplySpecId, supplyQuantity, availableFrom, recipeStore, planStore, processes, observer, agents } = params;

    const plan = planStore.getPlan(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const result: DependentSupplyResult = {
        plan,
        processes: [],
        commitments: [],
        intents: [],
        surplus: [],
        purchaseIntents: [],
        absorbed: [],
    };

    // Prevent infinite loops (circular recipes)
    const visited = new Set<string>();

    const queue: SupplyTask[] = [{
        specId: supplySpecId,
        quantity: supplyQuantity,
        availableFrom,
        atLocation: params.atLocation,
    }];

    const netter = params.netter;

    while (queue.length > 0) {
        const task = queue.shift()!;
        processSupply(task, visited, queue, result, params, planId, processes, plan, netter);
    }

    return result;
}

// =============================================================================
// INTERNAL
// =============================================================================

function processSupply(
    task: SupplyTask,
    visited: Set<string>,
    queue: SupplyTask[],
    result: DependentSupplyResult,
    params: Parameters<typeof dependentSupply>[0],
    planId: string,
    processReg: ProcessRegistry,
    _plan: Plan,
    netter?: PlanNetter,
): void {
    const { recipeStore, planStore, observer, agents } = params;

    // --- Mode C gate: net against pre-claimed consumptions ---
    // If demand explosion already scheduled consumption of this spec, deduct
    // those pre-claims from available supply before routing into recipes.
    if (netter) {
        task = { ...task, quantity: netter.netSupply(task.specId, task.quantity, task.availableFrom, task.atLocation) };
    }
    if (task.quantity <= 0) return; // Fully pre-claimed by demand plan

    const candidates = recipeStore.recipesForInput(task.specId);

    if (candidates.length === 0) {
        // Original supply with no recipe → surplus.
        // Derived supply (output of a process) with no recipe → terminal product, NOT surplus.
        if (!task.isDerived) {
            result.surplus.push({ specId: task.specId, quantity: task.quantity });
        }
        return;
    }

    // Sort by SNLT ascending (most labour-efficient first)
    const ranked = candidates
        .map(r => ({ recipe: r, snlt: computeSnlt(recipeStore, r.id) }))
        .sort((a, b) => a.snlt - b.snlt);

    let remaining = task.quantity;

    for (const { recipe } of ranked) {
        if (remaining <= 0) break;
        if (visited.has(recipe.id)) continue;

        const chain = recipeStore.getProcessChain(recipe.id);
        if (chain.length === 0) continue;

        // Find how much of task.specId this recipe consumes per execution
        // (sum across all processes in case the spec appears in multiple processes)
        let supplyInputQtyPerExec = 0;
        for (const rp of chain) {
            const { inputs } = recipeStore.flowsForProcess(rp.id);
            for (const f of inputs) {
                if (f.resourceConformsTo === task.specId && f.action !== 'work') {
                    const actionDef = ACTION_DEFINITIONS[f.action];
                    const isDurable = actionDef?.accountingEffect === 'noEffect';
                    if (!isDurable) {
                        supplyInputQtyPerExec += f.resourceQuantity?.hasNumericalValue ?? 0;
                    }
                }
            }
        }

        if (supplyInputQtyPerExec <= 0) continue;

        const maxByThisSupply = Math.floor(remaining / supplyInputQtyPerExec);
        if (maxByThisSupply <= 0) continue;

        const maxByOtherMaterials = computeMaxByOtherMaterials(recipeStore, chain, task.specId, observer, netter, task.availableFrom, task.atLocation);
        const executions = Math.min(maxByThisSupply, maxByOtherMaterials);
        if (executions <= 0) continue;

        visited.add(recipe.id);

        // Build sets for internal flow tracking within this recipe chain.
        // internallyConsumedSpecs = specs that are output of one process AND
        // input of another within the same chain (intermediate products).
        // These should NOT be pushed to the queue as new top-level supply tasks.
        const internallyProducedSpecs = new Set<string>();
        for (const rp of chain) {
            const { outputs } = recipeStore.flowsForProcess(rp.id);
            for (const f of outputs) {
                if (f.resourceConformsTo) internallyProducedSpecs.add(f.resourceConformsTo);
            }
        }
        const internallyConsumedSpecs = new Set<string>();
        for (const rp of chain) {
            const { inputs } = recipeStore.flowsForProcess(rp.id);
            for (const f of inputs) {
                if (f.resourceConformsTo && internallyProducedSpecs.has(f.resourceConformsTo)) {
                    internallyConsumedSpecs.add(f.resourceConformsTo);
                }
            }
        }

        const hasAgents = !!(agents?.provider && agents?.receiver);

        // Forward-schedule processes (FORWARD order, from availableFrom)
        let cursor = task.availableFrom;

        for (const rp of chain) {
            const durationMs = rpDurationMs(rp);
            const processBegin = new Date(cursor);
            const processEnd = new Date(cursor.getTime() + durationMs);
            cursor = processEnd;

            const process = processReg.register({
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

            // --- Inputs ---
            for (const flow of inputs) {
                if (!flow.resourceConformsTo) continue;

                const actionDef = ACTION_DEFINITIONS[flow.action];
                const isDurable = actionDef?.accountingEffect === 'noEffect';

                // --- Durable inputs (use/cite): existence gate only ---
                // work also has noEffect but is excluded by the explicit action check
                if (isDurable && flow.action !== 'work') {
                    if (observer) {
                        const exists = observer.conformingResources(flow.resourceConformsTo)
                            .some(r => (r.accountingQuantity?.hasNumericalValue ?? 0) > 0);
                        if (exists) continue; // Present — no demand needed
                    }
                    // Not present or no observer — signal as purchase intent
                    const intent = planStore.addIntent({
                        action: 'transfer',
                        receiver: agents?.receiver,
                        resourceConformsTo: flow.resourceConformsTo,
                        resourceQuantity: {
                            hasNumericalValue: flow.resourceQuantity?.hasNumericalValue ?? 1,
                            hasUnit: flow.resourceQuantity?.hasUnit ?? 'each',
                        },
                        due: processBegin.toISOString(),
                        plannedWithin: planId,
                        inputOf: process.id,
                        note: `Durable resource required (must be present): ${flow.resourceConformsTo}`,
                        finished: false,
                    });
                    result.purchaseIntents.push(intent);
                    continue;
                }

                // --- Create the flow record (commitment/intent) ---
                const record = createFlowRecord(flow, process.id, 'input', executions, processBegin, planId, agents, planStore, task.atLocation);
                if (hasAgents) {
                    result.commitments.push(record as Commitment);
                } else {
                    result.intents.push(record as Intent);
                }

                // --- Work flows: just record, no further tracking ---
                if (flow.action === 'work') continue;

                const scaledQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * executions;

                if (flow.resourceConformsTo === task.specId) {
                    // Absorbed from available supply — record it
                    result.absorbed.push({
                        specId: task.specId,
                        quantity: scaledQty,
                        recipeId: recipe.id,
                    });
                } else if (!internallyConsumedSpecs.has(flow.resourceConformsTo)) {
                    // Complementary input (not the supply, not internally produced) — check observer
                    const available = observer
                        ? observer.conformingResources(flow.resourceConformsTo)
                            .reduce((sum, r) => sum + (r.accountingQuantity?.hasNumericalValue ?? 0), 0)
                        : 0;
                    if (available < scaledQty) {
                        const gap = scaledQty - available;
                        const unit = flow.resourceQuantity?.hasUnit ?? 'each';
                        const intent = planStore.addIntent({
                            action: 'transfer',
                            receiver: agents?.receiver,
                            resourceConformsTo: flow.resourceConformsTo,
                            resourceQuantity: { hasNumericalValue: gap, hasUnit: unit },
                            due: processBegin.toISOString(),
                            plannedWithin: planId,
                            inputOf: process.id,
                            note: `Complementary input needed: ${gap} ${unit} of ${flow.resourceConformsTo}`,
                            finished: false,
                        });
                        result.purchaseIntents.push(intent);
                    }
                }
                // else: internally consumed — produced by a prior process in this chain, no action
            }

            // --- Outputs ---
            for (const flow of outputs) {
                if (!flow.resourceConformsTo) continue;

                const scaledQty = (flow.resourceQuantity?.hasNumericalValue ?? 0) * executions;

                const record = createFlowRecord(flow, process.id, 'output', executions, processEnd, planId, agents, planStore, task.atLocation);
                if (hasAgents) {
                    result.commitments.push(record as Commitment);
                } else {
                    result.intents.push(record as Intent);
                }

                // Outputs become new available supply → push to queue
                // Skip intermediate specs consumed within this recipe chain.
                // Mark as derived so terminal products don't become surplus.
                if (scaledQty > 0 && !internallyConsumedSpecs.has(flow.resourceConformsTo)) {
                    queue.push({
                        specId: flow.resourceConformsTo,
                        quantity: scaledQty,
                        availableFrom: processEnd,
                        isDerived: true,
                        atLocation: task.atLocation,
                    });
                }
            }
        }

        remaining -= executions * supplyInputQtyPerExec;

        // Allow this recipe to be reused for different supply tasks
        visited.delete(recipe.id);
    }

    if (remaining > 0) {
        result.surplus.push({ specId: task.specId, quantity: remaining });
    }
}

/**
 * Compute SNLT (Socially Necessary Labour Time) for one recipe execution,
 * expressed as total work-hours per unit of primary output.
 *
 * Lower SNLT = more labour-efficient. Used to rank candidate recipes.
 * Recipes with zero work flows have SNLT=0 (pure material transformation).
 * Returns Infinity for degenerate recipes with no primary output.
 */
function computeSnlt(recipeStore: RecipeStore, recipeId: string): number {
    const recipe = recipeStore.getRecipe(recipeId);
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

    const primaryOutputSpec = recipe?.primaryOutput;
    if (!primaryOutputSpec) return totalWorkHours;

    const lastProcess = chain[chain.length - 1];
    if (!lastProcess) return Infinity;
    const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
    const primaryFlow = outputs.find(f => f.resourceConformsTo === primaryOutputSpec);
    const outputQty = primaryFlow?.resourceQuantity?.hasNumericalValue ?? 0;
    if (outputQty <= 0) return Infinity;

    return totalWorkHours / outputQty;
}

/**
 * Compute the maximum number of recipe executions constrained by OTHER materials
 * (all consumed inputs except the primary supply spec and work/durable flows).
 *
 * When netter is provided, uses netAvailableQty (inventory + scheduled outputs -
 * scheduled consumptions) for a correct net capacity ceiling (Mode C).
 *
 * Returns Infinity if no observer/netter or no other consumed inputs constrain the run.
 */
function computeMaxByOtherMaterials(
    recipeStore: RecipeStore,
    chain: RecipeProcess[],
    supplySpecId: string,
    observer: Observer | undefined,
    netter?: PlanNetter,
    asOf?: Date,
    atLocation?: string,
): number {
    if (!observer && !netter) return Infinity;

    let minExecutions = Infinity;

    for (const rp of chain) {
        const { inputs } = recipeStore.flowsForProcess(rp.id);
        for (const flow of inputs) {
            if (!flow.resourceConformsTo) continue;
            if (flow.resourceConformsTo === supplySpecId) continue;
            if (flow.action === 'work') continue;

            const actionDef = ACTION_DEFINITIONS[flow.action];
            const isDurable = actionDef?.accountingEffect === 'noEffect';
            if (isDurable) continue; // existence gate, not quantity constraint

            const reqQtyPerExec = flow.resourceQuantity?.hasNumericalValue ?? 0;
            if (reqQtyPerExec <= 0) continue;

            const available = netter
                ? netter.netAvailableQty(flow.resourceConformsTo, { asOf, atLocation })
                : observer!.conformingResources(flow.resourceConformsTo)
                    .reduce((sum, r) => sum + (r.accountingQuantity?.hasNumericalValue ?? 0), 0);

            const maxForThisInput = Math.floor(available / reqQtyPerExec);
            minExecutions = Math.min(minExecutions, maxForThisInput);
        }
    }

    return minExecutions;
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

// =============================================================================
// CONVENIENCE WRAPPER
// =============================================================================

/**
 * Thin wrapper: run dependentSupply from an EconomicResource instance.
 * Extracts supplySpecId (conformsTo) and supplyQuantity (accountingQuantity)
 * from the resource and delegates to dependentSupply().
 */
export function dependentSupplyFromResource(params: {
    resource: EconomicResource;
    availableFrom: Date;
    planId: string;
    recipeStore: RecipeStore;
    planStore: PlanStore;
    processes: ProcessRegistry;
    observer?: Observer;
    netter?: PlanNetter;
    agents?: { provider?: string; receiver?: string };
}): DependentSupplyResult {
    return dependentSupply({
        ...params,
        supplySpecId: params.resource.conformsTo,
        supplyQuantity: params.resource.accountingQuantity?.hasNumericalValue ?? 1,
        atLocation: params.resource.currentLocation,
    });
}
