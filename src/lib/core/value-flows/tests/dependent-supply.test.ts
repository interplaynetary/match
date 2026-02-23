import { describe, expect, test, beforeEach } from 'bun:test';
import { dependentSupply } from '../algorithms/dependent-supply';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';

// =============================================================================
// TEST HELPERS
// =============================================================================

/** Build a simple single-process recipe: 1 unit of inputSpec → outputQty units of outputSpec */
function makeSimpleRecipe(
    recipes: RecipeStore,
    name: string,
    inputSpec: string,
    inputQty: number,
    outputSpec: string,
    outputQty: number,
    durationHours = 1,
): void {
    const process = recipes.addRecipeProcess({ name, hasDuration: { hasNumericalValue: durationHours, hasUnit: 'hours' } });
    const recipe = recipes.addRecipe({ name, primaryOutput: outputSpec, recipeProcesses: [process.id] });
    recipes.addRecipeFlow({
        action: 'consume',
        resourceConformsTo: inputSpec,
        resourceQuantity: { hasNumericalValue: inputQty, hasUnit: 'each' },
        recipeInputOf: process.id,
    });
    recipes.addRecipeFlow({
        action: 'produce',
        resourceConformsTo: outputSpec,
        resourceQuantity: { hasNumericalValue: outputQty, hasUnit: 'each' },
        recipeOutputOf: process.id,
    });
    // Suppress "unused variable" warning
    void recipe;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Dependent Supply (forward explosion)', () => {
    let planStore: PlanStore;
    let recipes: RecipeStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    // ── Test 1+2: Basic forward explosion ────────────────────────────────────

    test('single recipe: supply absorbed, process scheduled, output produced', () => {
        // shear recipe: 1 kg wool → 0.8 kg yarn (per execution)
        makeSimpleRecipe(recipes, 'Shear', 'spec:wool', 1, 'spec:yarn', 0.8);

        const plan = planStore.addPlan({ name: 'Supply Plan' });
        const t0 = new Date('2026-04-01T08:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool',
            supplyQuantity: 10,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // One shearing process
        expect(result.processes.length).toBe(1);
        expect(result.processes[0].name).toBe('Shear');

        // Process forward-scheduled from t0
        expect(result.processes[0].hasBeginning).toBe(t0.toISOString());
        expect(result.processes[0].hasEnd).toBe(new Date('2026-04-01T09:00:00Z').toISOString());

        // No surplus (all 10 kg absorbed)
        expect(result.surplus).toHaveLength(0);

        // 10 kg absorbed into production
        expect(result.absorbed).toHaveLength(1);
        expect(result.absorbed[0].specId).toBe('spec:wool');
        expect(result.absorbed[0].quantity).toBe(10);
    });

    test('absorbed records quantity and recipeId', () => {
        makeSimpleRecipe(recipes, 'Shear', 'spec:wool', 2, 'spec:yarn', 1.5);

        const recipe = recipes.allRecipes().find(r => r.name === 'Shear')!;

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T08:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool',
            supplyQuantity: 6, // 6/2 = 3 executions
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.absorbed.length).toBe(1);
        expect(result.absorbed[0].quantity).toBe(6);      // 3 exec × 2 kg/exec
        expect(result.absorbed[0].recipeId).toBe(recipe.id);
    });

    // ── Test 3: Chain of two recipes ─────────────────────────────────────────

    test('chain of two recipes: wool → yarn → fabric, both processes scheduled', () => {
        makeSimpleRecipe(recipes, 'Shear', 'spec:wool', 1, 'spec:yarn', 0.8, 1);
        makeSimpleRecipe(recipes, 'Weave', 'spec:yarn', 0.8, 'spec:fabric', 1, 2);

        const plan = planStore.addPlan({ name: 'Textile Plan' });
        const t0 = new Date('2026-04-01T08:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool',
            supplyQuantity: 10,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Two processes
        const pShear = result.processes.find(p => p.name === 'Shear')!;
        const pWeave = result.processes.find(p => p.name === 'Weave')!;
        expect(pShear).toBeDefined();
        expect(pWeave).toBeDefined();

        // Shear: t0 → t0+1h
        expect(pShear.hasBeginning).toBe(t0.toISOString());
        expect(pShear.hasEnd).toBe(new Date('2026-04-01T09:00:00Z').toISOString());

        // Weave starts when Shear ends: t0+1h → t0+3h
        expect(pWeave.hasBeginning).toBe(new Date('2026-04-01T09:00:00Z').toISOString());
        expect(pWeave.hasEnd).toBe(new Date('2026-04-01T11:00:00Z').toISOString());

        // Yarn was intermediate — absorbed into weave, not surplus
        expect(result.surplus).toHaveLength(0);

        // Absorbed: 10 kg wool
        const woolAbsorbed = result.absorbed.find(a => a.specId === 'spec:wool');
        expect(woolAbsorbed).toBeDefined();
        expect(woolAbsorbed!.quantity).toBe(10);
    });

    // ── Test 4: Supply netting — multiple executions ──────────────────────────

    test('supply netting: multiple executions when supply exceeds one execution', () => {
        // Recipe: 3 kg A per execution → 1 kg B
        makeSimpleRecipe(recipes, 'Process A', 'spec:a', 3, 'spec:b', 1);

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:a',
            supplyQuantity: 9, // 9/3 = 3 executions
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.surplus).toHaveLength(0);
        expect(result.absorbed[0].quantity).toBe(9); // 3 exec × 3 kg/exec

        // The output intent should reflect 3 executions worth of B
        const outputFlows = result.intents.filter(i => i.resourceConformsTo === 'spec:b');
        expect(outputFlows.length).toBe(1);
        expect(outputFlows[0].resourceQuantity?.hasNumericalValue).toBe(3); // 3 exec × 1
    });

    // ── Test 5: Partial absorption with surplus ───────────────────────────────

    test('partial absorption: leftover supply goes to surplus', () => {
        // Recipe: 3 units per execution
        makeSimpleRecipe(recipes, 'Process A', 'spec:a', 3, 'spec:b', 1);

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:a',
            supplyQuantity: 7, // floor(7/3) = 2 executions → absorbs 6, surplus 1
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.absorbed[0].quantity).toBe(6);     // 2 exec × 3
        expect(result.surplus).toHaveLength(1);
        expect(result.surplus[0].specId).toBe('spec:a');
        expect(result.surplus[0].quantity).toBe(1);
    });

    // ── Test 6: Surplus — no recipe consumes supply ──────────────────────────

    test('surplus: no recipe consumes the supply spec → entire quantity in surplus', () => {
        // No recipe that consumes 'spec:unknown'
        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:unknown',
            supplyQuantity: 42,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.surplus).toHaveLength(1);
        expect(result.surplus[0].specId).toBe('spec:unknown');
        expect(result.surplus[0].quantity).toBe(42);
        expect(result.processes).toHaveLength(0);
    });

    // ── Test 7: Other material constraint limits executions ───────────────────

    test('material constraint: other input limits executions, remaining goes to surplus', () => {
        // Recipe: 1 kg wool + 3 kg dye per execution → 1 kg dyed_wool
        const process = recipes.addRecipeProcess({ name: 'Dye Wool', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipes.addRecipe({ name: 'Dye Wool', primaryOutput: 'spec:dyed_wool', recipeProcesses: [process.id] });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:dye', resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:dyed_wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: process.id });

        // Observer has only 6 kg dye → floor(6/3) = 2 executions max
        observer.seedResource({ id: 'res-dye', conformsTo: 'spec:dye', accountingQuantity: { hasNumericalValue: 6, hasUnit: 'kg' } });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool',
            supplyQuantity: 10, // would allow 10 executions but dye allows only 2
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Only 2 executions possible
        expect(result.absorbed[0].quantity).toBe(2);     // 2 exec × 1 kg/exec
        expect(result.surplus[0].specId).toBe('spec:wool');
        expect(result.surplus[0].quantity).toBe(8);      // 10 - 2 = 8 surplus
    });

    // ── Test 8: Complementary inputs → purchaseIntents ───────────────────────

    test('complementary input not in observer → purchaseIntent created', () => {
        // Recipe: 1 kg wool + 1 kg dye → 1 kg dyed_wool
        const process = recipes.addRecipeProcess({ name: 'Dye', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipes.addRecipe({ name: 'Dye', primaryOutput: 'spec:dyed2', recipeProcesses: [process.id] });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:wool2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:dye2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:dyed2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: process.id });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool2',
            supplyQuantity: 5,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            // No observer → all other materials treated as unavailable
        });

        // dye not available → purchaseIntent for dye
        const dyeIntent = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:dye2');
        expect(dyeIntent).toBeDefined();
        expect(dyeIntent!.resourceQuantity?.hasNumericalValue).toBe(5); // 5 executions × 1 kg
    });

    // ── Test 9: Complementary input in observer → no purchaseIntent ───────────

    test('complementary input in observer → no purchaseIntent', () => {
        // Recipe: 1 kg wool + 1 kg dye → 1 kg dyed_wool
        const process = recipes.addRecipeProcess({ name: 'Dye3', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipes.addRecipe({ name: 'Dye3', primaryOutput: 'spec:dyed3', recipeProcesses: [process.id] });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:wool3', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:dye3', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:dyed3', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: process.id });

        // Enough dye in observer (5 kg = exactly 5 executions worth)
        observer.seedResource({ id: 'res-dye3', conformsTo: 'spec:dye3', accountingQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool3',
            supplyQuantity: 5,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Dye is in observer → no purchaseIntent for dye
        const dyeIntent = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:dye3');
        expect(dyeIntent).toBeUndefined();

        expect(result.surplus).toHaveLength(0);
    });

    // ── Test 10: Durable inputs (existence gate) ──────────────────────────────

    test('durable input: observer has loom → no purchaseIntent', () => {
        // Recipe: use:loom + 1 kg yarn → 1 m fabric
        const process = recipes.addRecipeProcess({ name: 'Weave4', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipes.addRecipe({ name: 'Weave4', primaryOutput: 'spec:fabric4', recipeProcesses: [process.id] });
        recipes.addRecipeFlow({ action: 'use', resourceConformsTo: 'spec:loom', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:yarn4', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:fabric4', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'm' }, recipeOutputOf: process.id });

        // Observer has a loom
        observer.seedResource({ id: 'res-loom', conformsTo: 'spec:loom', accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' } });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:yarn4',
            supplyQuantity: 5,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Loom is present → no purchaseIntent for loom
        const loomIntent = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:loom');
        expect(loomIntent).toBeUndefined();

        expect(result.processes.length).toBe(1);
        expect(result.surplus).toHaveLength(0);
    });

    test('durable input: no loom in observer → purchaseIntent created', () => {
        // Same recipe as above, no loom in observer
        const process = recipes.addRecipeProcess({ name: 'Weave5', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipes.addRecipe({ name: 'Weave5', primaryOutput: 'spec:fabric5', recipeProcesses: [process.id] });
        recipes.addRecipeFlow({ action: 'use', resourceConformsTo: 'spec:loom5', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:yarn5', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: process.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:fabric5', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'm' }, recipeOutputOf: process.id });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:yarn5',
            supplyQuantity: 3,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer, // observer has no loom
        });

        // No loom → purchaseIntent created
        const loomIntent = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:loom5');
        expect(loomIntent).toBeDefined();
        expect(loomIntent!.action).toBe('transfer');
    });

    // ── Test 11: Temporal forward scheduling ──────────────────────────────────

    test('processes scheduled forward from availableFrom', () => {
        makeSimpleRecipe(recipes, 'Proc11', 'spec:in11', 1, 'spec:out11', 1, 3); // 3-hour duration

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-06-15T10:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:in11',
            supplyQuantity: 4,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.processes.length).toBe(1);
        expect(result.processes[0].hasBeginning).toBe(t0.toISOString());
        expect(result.processes[0].hasEnd).toBe(new Date('2026-06-15T13:00:00Z').toISOString());
    });

    // ── Test 12: Two-process chain temporal chaining ───────────────────────────

    test('two-process chain: processB begins when processA ends', () => {
        // Recipe with two processes in sequence (single recipe, multi-process)
        // processA: 1h, processB: 2h
        const rpA = recipes.addRecipeProcess({ name: 'Step A', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        const rpB = recipes.addRecipeProcess({ name: 'Step B', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        const recipe = recipes.addRecipe({ name: 'Two Step', primaryOutput: 'spec:final12', recipeProcesses: [rpA.id, rpB.id] });
        void recipe;

        // A: in12 → intermediate12
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:in12', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeInputOf: rpA.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:intermediate12', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeOutputOf: rpA.id });
        // B: intermediate12 → final12
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:intermediate12', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeInputOf: rpB.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:final12', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeOutputOf: rpB.id });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-06-15T08:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:in12',
            supplyQuantity: 1,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const pA = result.processes.find(p => p.name === 'Step A')!;
        const pB = result.processes.find(p => p.name === 'Step B')!;
        expect(pA).toBeDefined();
        expect(pB).toBeDefined();

        // A: t0 → t0+1h
        expect(pA.hasBeginning).toBe(t0.toISOString());
        expect(pA.hasEnd).toBe(new Date('2026-06-15T09:00:00Z').toISOString());

        // B starts when A ends: t0+1h → t0+3h
        expect(pB.hasBeginning).toBe(new Date('2026-06-15T09:00:00Z').toISOString());
        expect(pB.hasEnd).toBe(new Date('2026-06-15T11:00:00Z').toISOString());

        // intermediate12 is internally consumed — NOT in surplus
        const intermediateSurplus = result.surplus.find(s => s.specId === 'spec:intermediate12');
        expect(intermediateSurplus).toBeUndefined();
    });

    // ── Test 13: SNLT ordering ─────────────────────────────────────────────────

    test('SNLT ordering: lower SNLT recipe selected first', () => {
        // Recipe A: consumes 1 wool, 2 work-hours → 1 yarn (SNLT = 2/1 = 2)
        const procA = recipes.addRecipeProcess({ name: 'Spin Slow' });
        recipes.addRecipe({ name: 'Spin Slow', primaryOutput: 'spec:yarn13', recipeProcesses: [procA.id] });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:wool13', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: procA.id });
        recipes.addRecipeFlow({ action: 'work', effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' }, recipeInputOf: procA.id, resourceConformsTo: 'spec:labour13' });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:yarn13', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: procA.id });

        // Recipe B: consumes 1 wool, 1 work-hour → 1 yarn (SNLT = 1/1 = 1) — more efficient
        const procB = recipes.addRecipeProcess({ name: 'Spin Fast' });
        recipes.addRecipe({ name: 'Spin Fast', primaryOutput: 'spec:yarn13', recipeProcesses: [procB.id] });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:wool13', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: procB.id });
        recipes.addRecipeFlow({ action: 'work', effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' }, recipeInputOf: procB.id, resourceConformsTo: 'spec:labour13' });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:yarn13', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: procB.id });

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:wool13',
            supplyQuantity: 5,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Recipe B (Spin Fast, SNLT=1) should be selected first
        expect(result.processes.length).toBe(1);
        expect(result.processes[0].name).toBe('Spin Fast');
    });

    // ── Agent handling ────────────────────────────────────────────────────────

    test('with agents: flows become commitments instead of intents', () => {
        makeSimpleRecipe(recipes, 'Proc', 'spec:x', 1, 'spec:y', 1);

        const plan = planStore.addPlan({ name: 'P' });
        const t0 = new Date('2026-04-01T00:00:00Z');

        const result = dependentSupply({
            planId: plan.id,
            supplySpecId: 'spec:x',
            supplyQuantity: 2,
            availableFrom: t0,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            agents: { provider: 'agent:alice', receiver: 'agent:bob' },
        });

        expect(result.commitments.length).toBeGreaterThan(0);
        expect(result.intents.length).toBe(0);
    });

    // ── Regression: recipesForOutput unaffected ───────────────────────────────

    test('recipesForOutput still works correctly after recipesForInput added', () => {
        makeSimpleRecipe(recipes, 'Make Widget', 'spec:parts', 2, 'spec:widget', 1);

        const found = recipes.recipesForOutput('spec:widget');
        expect(found.length).toBe(1);
        expect(found[0].primaryOutput).toBe('spec:widget');

        // recipesForInput should NOT return this recipe for 'spec:widget' (it's an output, not input)
        const inputSearch = recipes.recipesForInput('spec:widget');
        expect(inputSearch.length).toBe(0);
    });
});
