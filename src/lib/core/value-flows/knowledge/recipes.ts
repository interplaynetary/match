/**
 * RecipeStore — Knowledge layer for production templates.
 *
 * A Recipe is a reusable template that describes how to make something:
 *   Recipe → RecipeProcess(es) → RecipeFlow(s)
 *
 * RecipeProcesses define WHAT happens (basedOn a ProcessSpecification).
 * RecipeFlows define WHAT goes in/out (action, resource spec, quantities).
 *
 * Flows connect processes:
 *   - recipeOutputOf: this flow is an output of that RecipeProcess
 *   - recipeInputOf: this flow is an input of that RecipeProcess
 *   - When an output's resourceConformsTo matches an input's resourceConformsTo,
 *     those processes are implicitly connected.
 *
 * Recipes can generate Plans via the planning layer.
 */

import { nanoid } from 'nanoid';
import type {
    Recipe,
    RecipeProcess,
    RecipeFlow,
    RecipeExchange,
    RecipeGroup,
    ResourceSpecification,
    ProcessSpecification,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';

// =============================================================================
// RECIPE STORE
// =============================================================================

export class RecipeStore {
    private recipes = new Map<string, Recipe>();
    private recipeGroups = new Map<string, RecipeGroup>();
    private recipeProcesses = new Map<string, RecipeProcess>();
    private recipeFlows = new Map<string, RecipeFlow>();
    private recipeExchanges = new Map<string, RecipeExchange>();
    private resourceSpecs = new Map<string, ResourceSpecification>();
    private processSpecs = new Map<string, ProcessSpecification>();

    constructor(private generateId: () => string = () => nanoid()) {}

    // =========================================================================
    // SPECIFICATIONS — Register catalog types
    // =========================================================================

    addResourceSpec(spec: ResourceSpecification): ResourceSpecification {
        this.resourceSpecs.set(spec.id, spec);
        return spec;
    }

    addProcessSpec(spec: ProcessSpecification): ProcessSpecification {
        this.processSpecs.set(spec.id, spec);
        return spec;
    }

    getResourceSpec(id: string): ResourceSpecification | undefined {
        return this.resourceSpecs.get(id);
    }

    getProcessSpec(id: string): ProcessSpecification | undefined {
        return this.processSpecs.get(id);
    }

    allResourceSpecs(): ResourceSpecification[] {
        return Array.from(this.resourceSpecs.values());
    }

    allProcessSpecs(): ProcessSpecification[] {
        return Array.from(this.processSpecs.values());
    }

    // =========================================================================
    // RECIPE PROCESSES — Template process steps
    // =========================================================================

    addRecipeProcess(rp: Omit<RecipeProcess, 'id'> & { id?: string }): RecipeProcess {
        const process: RecipeProcess = { id: rp.id ?? this.generateId(), ...rp };
        this.recipeProcesses.set(process.id, process);
        return process;
    }

    getRecipeProcess(id: string): RecipeProcess | undefined {
        return this.recipeProcesses.get(id);
    }

    // =========================================================================
    // RECIPE FLOWS — Template inputs/outputs
    // =========================================================================

    addRecipeFlow(rf: Omit<RecipeFlow, 'id'> & { id?: string }): RecipeFlow {
        const flow: RecipeFlow = { id: rf.id ?? this.generateId(), ...rf };

        // Validate action direction matches inputOf/outputOf
        const def = ACTION_DEFINITIONS[flow.action];
        if (flow.recipeInputOf && def.inputOutput !== 'input' && def.inputOutput !== 'outputInput') {
            throw new Error(
                `Flow ${flow.id}: action '${flow.action}' is not valid as input (expected inputOutput=${def.inputOutput})`
            );
        }
        if (flow.recipeOutputOf && def.inputOutput !== 'output' && def.inputOutput !== 'outputInput') {
            throw new Error(
                `Flow ${flow.id}: action '${flow.action}' is not valid as output (expected inputOutput=${def.inputOutput})`
            );
        }

        this.recipeFlows.set(flow.id, flow);
        return flow;
    }

    getRecipeFlow(id: string): RecipeFlow | undefined {
        return this.recipeFlows.get(id);
    }

    // =========================================================================
    // RECIPES — Grouping of processes
    // =========================================================================

    addRecipe(recipe: Omit<Recipe, 'id'> & { id?: string }): Recipe {
        const r: Recipe = { id: recipe.id ?? this.generateId(), ...recipe };
        this.recipes.set(r.id, r);
        return r;
    }

    getRecipe(id: string): Recipe | undefined {
        return this.recipes.get(id);
    }

    allRecipes(): Recipe[] {
        return Array.from(this.recipes.values());
    }

    // =========================================================================
    // RECIPE GROUPS — Multiple-output recipe bundles (GAP-D)
    // =========================================================================

    /**
     * Add a RecipeGroup — groups several Recipes into one plan-generation unit.
     * VF spec: model-text.md §vf:RecipeGroup, recipes.md §Recipe and Recipe Group.
     */
    addRecipeGroup(rg: Omit<RecipeGroup, 'id'> & { id?: string }): RecipeGroup {
        const group: RecipeGroup = { id: rg.id ?? this.generateId(), ...rg };
        this.recipeGroups.set(group.id, group);
        return group;
    }

    getRecipeGroup(id: string): RecipeGroup | undefined {
        return this.recipeGroups.get(id);
    }

    allRecipeGroups(): RecipeGroup[] {
        return Array.from(this.recipeGroups.values());
    }

    /**
     * Get all recipes that belong to a RecipeGroup.
     */
    recipesForGroup(groupId: string): Recipe[] {
        const group = this.recipeGroups.get(groupId);
        if (!group) return [];
        return group.recipes
            .map(id => this.recipes.get(id))
            .filter((r): r is Recipe => r !== undefined);
    }

    // =========================================================================
    // QUERIES — Navigate recipe structure
    // =========================================================================

    /**
     * Get all flows for a recipe process (both inputs and outputs).
     */
    flowsForProcess(rpId: string): { inputs: RecipeFlow[]; outputs: RecipeFlow[] } {
        const inputs: RecipeFlow[] = [];
        const outputs: RecipeFlow[] = [];
        for (const flow of this.recipeFlows.values()) {
            if (flow.recipeInputOf === rpId) inputs.push(flow);
            if (flow.recipeOutputOf === rpId) outputs.push(flow);
        }
        return { inputs, outputs };
    }

    // =========================================================================
    // RECIPE EXCHANGES — Template exchange agreements
    // =========================================================================

    addRecipeExchange(rex: Omit<RecipeExchange, 'id'> & { id?: string }): RecipeExchange {
        const exchange: RecipeExchange = { id: rex.id ?? this.generateId(), ...rex };
        this.recipeExchanges.set(exchange.id, exchange);
        return exchange;
    }

    getRecipeExchange(id: string): RecipeExchange | undefined {
        return this.recipeExchanges.get(id);
    }

    /**
     * Get all flows that are clauses of a RecipeExchange.
     */
    flowsForExchange(rexId: string): RecipeFlow[] {
        const flows: RecipeFlow[] = [];
        for (const flow of this.recipeFlows.values()) {
            if (flow.recipeClauseOf === rexId) flows.push(flow);
        }
        return flows;
    }

    /**
     * Get all recipe processes belonging to a recipe.
     */
    processesForRecipe(recipeId: string): RecipeProcess[] {
        const recipe = this.recipes.get(recipeId);
        if (!recipe?.recipeProcesses) return [];
        return recipe.recipeProcesses
            .map(id => this.recipeProcesses.get(id))
            .filter((rp): rp is RecipeProcess => rp !== undefined);
    }

    /**
     * Find the recipe that produces a given resource specification as primary output.
     */
    recipeForOutput(specId: string): Recipe | undefined {
        for (const recipe of this.recipes.values()) {
            if (recipe.primaryOutput === specId) return recipe;
        }
        return undefined;
    }

    /**
     * Find ALL recipes that produce a given resource specification as primary output.
     * Use this when you need SNLT-ranked selection (dependent demand algorithm).
     */
    recipesForOutput(specId: string): Recipe[] {
        const matches: Recipe[] = [];
        for (const recipe of this.recipes.values()) {
            if (recipe.primaryOutput === specId) matches.push(recipe);
        }
        return matches;
    }

    /**
     * Find all recipes that consume a given resource specification as input
     * in any process of their chain.
     *
     * Used by dependentSupply() to find recipes that can absorb available supply.
     */
    recipesForInput(specId: string): Recipe[] {
        // Find all recipe-process IDs that have an input flow for this spec
        const processIds = new Set<string>();
        for (const flow of this.recipeFlows.values()) {
            if (flow.recipeInputOf && flow.resourceConformsTo === specId) {
                processIds.add(flow.recipeInputOf);
            }
        }
        // Find all recipes that include any of those processes
        const result: Recipe[] = [];
        for (const recipe of this.recipes.values()) {
            if (recipe.recipeProcesses?.some(pId => processIds.has(pId))) {
                result.push(recipe);
            }
        }
        return result;
    }

    /**
     * Find all recipes that transport a resource spec — recipes that have both a
     * `pickup specId` input and a `dropoff specId` output in their process chain.
     *
     * Location comes from the planning task, not the recipe (recipes stay abstract).
     * Used by dependentDemand() to resolve spatial displacement sub-tasks.
     */
    recipesForTransport(specId: string): Recipe[] {
        const pickupProcessIds = new Set<string>();
        const dropoffProcessIds = new Set<string>();
        for (const flow of this.recipeFlows.values()) {
            if (flow.resourceConformsTo !== specId) continue;
            if (flow.action === 'pickup'  && flow.recipeInputOf)  pickupProcessIds.add(flow.recipeInputOf);
            if (flow.action === 'dropoff' && flow.recipeOutputOf) dropoffProcessIds.add(flow.recipeOutputOf);
        }
        return Array.from(this.recipes.values()).filter(r =>
            r.recipeProcesses?.some(pId => pickupProcessIds.has(pId)) &&
            r.recipeProcesses?.some(pId => dropoffProcessIds.has(pId)),
        );
    }

    /**
     * Get the process chain for a recipe in topological order
     * (dependencies first, final output process last).
     *
     * Uses the flow connections: an output flow of process A with
     * resourceConformsTo X connects to an input flow of process B
     * with the same resourceConformsTo X.
     */
    getProcessChain(recipeId: string): RecipeProcess[] {
        const processes = this.processesForRecipe(recipeId);
        if (processes.length === 0) return [];

        // Build adjacency: processA → processB if A outputs what B inputs
        const adj = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        for (const p of processes) {
            adj.set(p.id, new Set());
            inDegree.set(p.id, 0);
        }

        // For each process, look at its outputs and find which processes need those
        for (const srcProcess of processes) {
            const { outputs } = this.flowsForProcess(srcProcess.id);
            for (const outFlow of outputs) {
                const outSpec = outFlow.resourceConformsTo;
                if (!outSpec) continue;

                // Find processes that have an input matching this spec
                for (const dstProcess of processes) {
                    if (dstProcess.id === srcProcess.id) continue;
                    const { inputs } = this.flowsForProcess(dstProcess.id);
                    // Match on (spec, stage) pair — workflow recipes share a spec but carry
                    // distinct stages. undefined === undefined covers manufacturing recipes
                    // where neither output nor input has a stage attribute.
                    const needsThis = inputs.some(f =>
                        f.resourceConformsTo === outSpec && f.stage === outFlow.stage
                    );
                    if (needsThis) {
                        adj.get(srcProcess.id)!.add(dstProcess.id);
                        inDegree.set(dstProcess.id, (inDegree.get(dstProcess.id) ?? 0) + 1);
                    }
                }
            }
        }

        // Kahn's algorithm — topological sort
        const queue: string[] = [];
        for (const [id, degree] of inDegree) {
            if (degree === 0) queue.push(id);
        }

        const sorted: RecipeProcess[] = [];
        while (queue.length > 0) {
            const current = queue.shift()!;
            sorted.push(this.recipeProcesses.get(current)!);
            for (const next of adj.get(current) ?? []) {
                const newDegree = (inDegree.get(next) ?? 1) - 1;
                inDegree.set(next, newDegree);
                if (newDegree === 0) queue.push(next);
            }
        }

        if (sorted.length !== processes.length) {
            throw new Error(`Recipe ${recipeId}: circular dependency detected in process chain`);
        }

        return sorted;
    }

    // =========================================================================
    // VALIDATION
    // =========================================================================

    /**
     * Validate a recipe's structural integrity.
     */
    validateRecipe(recipeId: string): string[] {
        const errors: string[] = [];
        const recipe = this.recipes.get(recipeId);
        if (!recipe) {
            errors.push(`Recipe ${recipeId} not found`);
            return errors;
        }

        const processes = this.processesForRecipe(recipeId);
        if (processes.length === 0) {
            errors.push(`Recipe ${recipeId}: no processes defined`);
            return errors;
        }

        // Each process should have at least one flow
        for (const rp of processes) {
            const { inputs, outputs } = this.flowsForProcess(rp.id);
            if (inputs.length === 0 && outputs.length === 0) {
                errors.push(`RecipeProcess ${rp.id} (${rp.name}): no flows defined`);
            }
        }

        // Check for the primary output
        if (recipe.primaryOutput) {
            const lastProcess = processes[processes.length - 1];
            if (lastProcess) {
                const { outputs } = this.flowsForProcess(lastProcess.id);
                const hasOutput = outputs.some(f => f.resourceConformsTo === recipe.primaryOutput);
                if (!hasOutput) {
                    errors.push(`Recipe ${recipeId}: primary output ${recipe.primaryOutput} not found in any process output flow`);
                }
            }
        }

        // Check for circular dependencies
        try {
            this.getProcessChain(recipeId);
        } catch (e) {
            errors.push((e as Error).message);
        }

        return errors;
    }
}
