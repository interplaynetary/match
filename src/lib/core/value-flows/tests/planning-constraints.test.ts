/**
 * Planning Constraint Tests — VF spec compliance for the planning stack.
 *
 * C1: Durable inputs (use/cite) are existence gates, not quantity-netted
 * H1: Scale factor throws when primaryOutput spec not found in recipe outputs
 * H2: buildRecipeGraph throws when satisfies link cannot be set
 * H3: promoteToPlan stamps independentDemandOf on commitments with satisfies
 * H4: Intent unilaterality enforced (provider XOR receiver, not both)
 * C2: Action direction validated in createFlowFromRecipe / createFlowRecord
 */

import { describe, expect, test } from 'bun:test';
import { PlanStore } from '../planning/planning';
import { RecipeStore } from '../knowledge/recipes';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import { promoteToPlan } from '../docs/old/integrated-planner';
import type { Scenario } from '../utils/space-time-scenario';
import type { Commitment, Process, RecipeFlow } from '../schemas';

// =============================================================================
// HELPERS
// =============================================================================

function makeStores() {
    let idCount = 0;
    const reg = new ProcessRegistry();
    const planStore = new PlanStore(reg, () => `id_${idCount++}`);
    const recipes = new RecipeStore(() => `rid_${idCount++}`);
    const observer = new Observer(reg);
    return { reg, planStore, recipes, observer };
}

/**
 * RecipeStore subclass that allows injecting additional flows into a process
 * without RecipeStore's action-direction validation.
 * Used only for C2 direction-validation tests.
 */
class RecipeStoreWithInjection extends RecipeStore {
    private extraInputs = new Map<string, RecipeFlow[]>();
    private extraOutputs = new Map<string, RecipeFlow[]>();

    injectInput(processId: string, flow: RecipeFlow) {
        if (!this.extraInputs.has(processId)) this.extraInputs.set(processId, []);
        this.extraInputs.get(processId)!.push(flow);
    }

    injectOutput(processId: string, flow: RecipeFlow) {
        if (!this.extraOutputs.has(processId)) this.extraOutputs.set(processId, []);
        this.extraOutputs.get(processId)!.push(flow);
    }

    override flowsForProcess(rpId: string) {
        const base = super.flowsForProcess(rpId);
        return {
            inputs:  [...base.inputs,  ...(this.extraInputs.get(rpId)  ?? [])],
            outputs: [...base.outputs, ...(this.extraOutputs.get(rpId) ?? [])],
        };
    }
}

function makeScenario(
    commitments: Map<string, Commitment>,
    processes: Map<string, Process> = new Map(),
): Scenario {
    return {
        id: 'test-scenario',
        processes,
        commitments,
        deficits: [],
        surpluses: [],
        score: {
            coverage: 1,
            intents_satisfied: 1,
            intents_total: 1,
            total_effort_hours: 0,
            deficit_specs: [],
            h3_depth: 9,
        },
        origin_cell: 'test-cell',
        resolution: 9,
    };
}

// =============================================================================
// C1 — Durable input handling in instantiateRecipe
// =============================================================================

describe('C1 — Durable input handling in instantiateRecipe', () => {

    test('use input with matching inventory: not allocated, no use intent created', () => {
        const { reg, planStore, recipes, observer } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Build',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Build Widget',
            primaryOutput: 'spec:widget',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'use',
            resourceConformsTo: 'spec:tool',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // Seed the observer with the tool — it's present, so no demand should be created
        observer.seedResource({
            id: 'res-tool',
            conformsTo: 'spec:tool',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
        });

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(), undefined, 'back', undefined, observer,
        );

        // Existence gate — tool must NOT be quantity-allocated
        expect(result.allocated.some(a => a.specId === 'spec:tool')).toBe(false);
        // Tool was found present — no intent should be created for it
        expect(result.intents.some(i => i.resourceConformsTo === 'spec:tool')).toBe(false);
        // Output intent is still created (no agents assigned)
        expect(result.intents.some(i => i.resourceConformsTo === 'spec:widget')).toBe(true);
    });

    test('use input with no inventory: intent created, not allocated', () => {
        const { planStore, recipes, observer } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Build',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Build Widget',
            primaryOutput: 'spec:widget',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'use',
            resourceConformsTo: 'spec:tool',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // Observer present but no tool seeded
        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(), undefined, 'back', undefined, observer,
        );

        // Not present — intent created to signal the durable resource must be sourced
        expect(result.intents.some(i => i.resourceConformsTo === 'spec:tool')).toBe(true);
        // Still not allocated (existence gate, not depleted)
        expect(result.allocated.some(a => a.specId === 'spec:tool')).toBe(false);
    });

    test('use input with no observer: intent created', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Build',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Build Widget',
            primaryOutput: 'spec:widget',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'use',
            resourceConformsTo: 'spec:tool',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // No observer — can't check existence, so intent is created
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, new Date());

        expect(result.intents.some(i => i.resourceConformsTo === 'spec:tool')).toBe(true);
    });

    test('consume input with inventory: IS allocated (regression check)', () => {
        const { planStore, recipes, observer } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Bake',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Bake Bread',
            primaryOutput: 'spec:bread',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        observer.seedResource({
            id: 'res-flour',
            conformsTo: 'spec:flour',
            accountingQuantity: { hasNumericalValue: 4, hasUnit: 'kg' },
        });

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(), undefined, 'back', undefined, observer,
        );

        // consume depletes inventory — must appear in allocated
        expect(result.allocated.some(a => a.specId === 'spec:flour')).toBe(true);
        expect(result.allocated.find(a => a.specId === 'spec:flour')?.quantity).toBe(2);
    });
});

// =============================================================================
// H1 — Scale factor throw
// =============================================================================

describe('H1 — Scale factor throws on missing primaryOutput', () => {

    test('recipe with primaryOutput but no matching output flow: throws', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        // primaryOutput set to spec:bread but no output flow for spec:bread exists
        const recipe = recipes.addRecipe({
            name: 'Bad Recipe',
            primaryOutput: 'spec:bread',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        // No output flow → computeScaleFactor cannot find spec:bread

        expect(() => planStore.instantiateRecipe(recipes, recipe.id, 10, new Date()))
            .toThrow(/Recipe scale error/);
    });

    test('recipe with primaryOutput and matching output flow: correct scale factor', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Bake',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Bake Bread',
            primaryOutput: 'spec:bread',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // Want 10 breads: scale = 10/2 = 5 → flour demand = 1 × 5 = 5 kg
        const result = planStore.instantiateRecipe(recipes, recipe.id, 10, new Date());

        const flourIntent = result.intents.find(i => i.resourceConformsTo === 'spec:flour');
        expect(flourIntent?.resourceQuantity?.hasNumericalValue).toBe(5);
    });
});

// =============================================================================
// H2 — satisfies link throw
// =============================================================================

describe('H2 — buildRecipeGraph throws on missing satisfies target', () => {

    test('buildRecipeGraph with valid intentId: satisfies set on primary output commitment', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Bake',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Bake Bread',
            primaryOutput: 'spec:bread',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        const { commitments } = planStore.buildRecipeGraph(
            recipes, recipe.id, 2, new Date(), 'intent-42',
        );

        const primaryOut = commitments.find(
            c => c.resourceConformsTo === 'spec:bread' && c.outputOf !== undefined,
        );
        expect(primaryOut).toBeDefined();
        expect(primaryOut?.satisfies).toBe('intent-42');
    });

    test('buildRecipeGraph with intentId but no output flows: throws', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        // No primaryOutput → computeScaleFactor returns desiredQty (no H1 throw)
        // But with intentId and no output commitments → H2 throws
        const recipe = recipes.addRecipe({
            name: 'Empty Output Recipe',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });
        // No output flow → no output commitments generated

        expect(() => planStore.buildRecipeGraph(recipes, recipe.id, 1, new Date(), 'intent-99'))
            .toThrow(/buildRecipeGraph.*satisfies/);
    });

    test('buildRecipeGraph without intentId: no throw even when output is absent (regression)', () => {
        const { planStore, recipes } = makeStores();

        const proc = recipes.addRecipeProcess({
            name: 'Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Consume-only Recipe',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: proc.id,
        });

        // No intentId → satisfies check never runs
        expect(() => planStore.buildRecipeGraph(recipes, recipe.id, 1, new Date())).not.toThrow();
    });
});

// =============================================================================
// H3 — independentDemandOf in promoteToPlan
// =============================================================================

describe('H3 — promoteToPlan stamps independentDemandOf', () => {

    test('commitments with satisfies get independentDemandOf = plan.id', () => {
        const { planStore } = makeStores();

        const c1: Commitment = {
            id: 'commit-1',
            action: 'produce',
            outputOf: 'proc-1',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            satisfies: 'intent-42',
            finished: false,
        };
        const c2: Commitment = {
            id: 'commit-2',
            action: 'consume',
            inputOf: 'proc-1',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            finished: false,
        };

        const scenario = makeScenario(new Map([['commit-1', c1], ['commit-2', c2]]));
        const plan = promoteToPlan(scenario, planStore);

        const stored1 = planStore.getCommitment('commit-1');
        expect(stored1?.independentDemandOf).toBe(plan.id);

        // commit-2 has no satisfies → no stamp
        const stored2 = planStore.getCommitment('commit-2');
        expect(stored2?.independentDemandOf).toBeUndefined();
    });

    test('plan.hasIndependentDemand contains all commitment IDs with satisfies', () => {
        const { planStore } = makeStores();

        const cA: Commitment = { id: 'cA', action: 'produce', satisfies: 'intent-1', finished: false };
        const cB: Commitment = { id: 'cB', action: 'produce', satisfies: 'intent-2', finished: false };
        const cC: Commitment = { id: 'cC', action: 'consume', finished: false };

        const scenario = makeScenario(new Map([['cA', cA], ['cB', cB], ['cC', cC]]));
        const plan = promoteToPlan(scenario, planStore);

        expect(plan.hasIndependentDemand).toBeDefined();
        expect(plan.hasIndependentDemand).toContain('cA');
        expect(plan.hasIndependentDemand).toContain('cB');
        expect(plan.hasIndependentDemand).not.toContain('cC');
    });

    test('scenario with no satisfies commitments: plan.hasIndependentDemand is undefined', () => {
        const { planStore } = makeStores();

        const c: Commitment = { id: 'cx', action: 'consume', finished: false };
        const scenario = makeScenario(new Map([['cx', c]]));
        const plan = promoteToPlan(scenario, planStore);

        expect(plan.hasIndependentDemand).toBeUndefined();
    });
});

// =============================================================================
// H4 — Intent unilaterality
// =============================================================================

describe('H4 — Intent unilaterality enforced', () => {

    test('addIntent with both provider and receiver: throws', () => {
        const { planStore } = makeStores();
        expect(() => planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            receiver: 'bob',
            finished: false,
        })).toThrow(/VF constraint violation/);
    });

    test('addIntent with only provider: does not throw', () => {
        const { planStore } = makeStores();
        expect(() => planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            finished: false,
        })).not.toThrow();
    });

    test('addIntent with only receiver: does not throw', () => {
        const { planStore } = makeStores();
        expect(() => planStore.addIntent({
            action: 'transfer',
            receiver: 'bob',
            finished: false,
        })).not.toThrow();
    });

    test('addIntent with neither provider nor receiver: does not throw', () => {
        const { planStore } = makeStores();
        expect(() => planStore.addIntent({
            action: 'transfer',
            finished: false,
        })).not.toThrow();
    });
});

// =============================================================================
// C2 — Action direction validation in createFlowFromRecipe
// =============================================================================

describe('C2 — Action direction validation', () => {

    test('produce as process input: throws with direction mismatch message', () => {
        let idCount = 0;
        const reg = new ProcessRegistry();
        const planStore = new PlanStore(reg, () => `id_${idCount++}`);
        const recipes = new RecipeStoreWithInjection(() => `rid_${idCount++}`);

        const proc = recipes.addRecipeProcess({
            name: 'Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Test',
            primaryOutput: 'spec:out',
            recipeProcesses: [proc.id],
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:out',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // Inject 'produce' as an input — bypasses RecipeStore's addRecipeFlow guard
        recipes.injectInput(proc.id, {
            id: 'bad-produce-input',
            action: 'produce',
            resourceConformsTo: 'spec:something',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeInputOf: proc.id,
        });

        expect(() => planStore.instantiateRecipe(recipes, recipe.id, 1, new Date()))
            .toThrow(/cannot be used as a process input/);
    });

    test('consume as process output: throws with direction mismatch message', () => {
        let idCount = 0;
        const reg = new ProcessRegistry();
        const planStore = new PlanStore(reg, () => `id_${idCount++}`);
        const recipes = new RecipeStoreWithInjection(() => `rid_${idCount++}`);

        const proc = recipes.addRecipeProcess({
            name: 'Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Test',
            primaryOutput: 'spec:out',
            recipeProcesses: [proc.id],
        });
        // Valid primaryOutput so H1 doesn't fire
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:out',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // Inject 'consume' as an output — bypasses RecipeStore's addRecipeFlow guard
        recipes.injectOutput(proc.id, {
            id: 'bad-consume-output',
            action: 'consume',
            resourceConformsTo: 'spec:bad-out',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        expect(() => planStore.instantiateRecipe(recipes, recipe.id, 1, new Date()))
            .toThrow(/cannot be used as a process output/);
    });

    test('transfer (notApplicable) as process input or output: no direction error', () => {
        let idCount = 0;
        const reg = new ProcessRegistry();
        const planStore = new PlanStore(reg, () => `id_${idCount++}`);
        const recipes = new RecipeStoreWithInjection(() => `rid_${idCount++}`);

        const proc = recipes.addRecipeProcess({
            name: 'Transfer Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Transfer Recipe',
            recipeProcesses: [proc.id],
        });

        // Inject transfer as both input and output (notApplicable — bypasses RecipeStore guard)
        recipes.injectInput(proc.id, {
            id: 'tr-in',
            action: 'transfer',
            resourceConformsTo: 'spec:goods',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeInputOf: proc.id,
        });
        recipes.injectOutput(proc.id, {
            id: 'tr-out',
            action: 'transfer',
            resourceConformsTo: 'spec:goods',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // notApplicable actions skip the direction check — no throw
        expect(() => planStore.instantiateRecipe(recipes, recipe.id, 1, new Date())).not.toThrow();
    });

    test('deliverService (outputInput) as process input or output: no direction error', () => {
        let idCount = 0;
        const reg = new ProcessRegistry();
        const planStore = new PlanStore(reg, () => `id_${idCount++}`);
        const recipes = new RecipeStoreWithInjection(() => `rid_${idCount++}`);

        const proc = recipes.addRecipeProcess({
            name: 'Service Step',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const recipe = recipes.addRecipe({
            name: 'Service Recipe',
            recipeProcesses: [proc.id],
        });

        // deliverService is outputInput — allowed as both input and output by RecipeStore,
        // and the direction check skips it. Inject via subclass to avoid RecipeStore
        // routing them through the normal flow registration.
        recipes.injectInput(proc.id, {
            id: 'ds-in',
            action: 'deliverService',
            resourceConformsTo: 'spec:svc',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeInputOf: proc.id,
        });
        recipes.injectOutput(proc.id, {
            id: 'ds-out',
            action: 'deliverService',
            resourceConformsTo: 'spec:svc',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            recipeOutputOf: proc.id,
        });

        // outputInput actions skip the direction check — no throw
        expect(() => planStore.instantiateRecipe(recipes, recipe.id, 1, new Date())).not.toThrow();
    });
});
