/**
 * Transport planning tests.
 *
 * Verifies that dependentDemand() generates transport sub-tasks when a resource
 * is needed at location B but only available at location A, and a transport recipe
 * (pickup/dropoff pair) is registered.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { dependentDemand } from '../algorithms/dependent-demand';
import { RecipeStore } from '../knowledge/recipes';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';

// =============================================================================
// Helpers
// =============================================================================

function makeTransportRecipe(recipes: RecipeStore, specId: string, truckSpecId?: string) {
    // Transport recipes do NOT set primaryOutput — they displace resources, not produce them.
    // This keeps them out of recipesForOutput() and reserved for recipesForTransport().
    const recipe = recipes.addRecipe({
        name: `Transport ${specId}`,
        recipeProcesses: [],
    });
    const rp = recipes.addRecipeProcess({ name: 'Truck leg', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
    recipe.recipeProcesses.push(rp.id);

    recipes.addRecipeFlow({
        action: 'pickup',
        resourceConformsTo: specId,
        resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
        recipeInputOf: rp.id,
    });
    recipes.addRecipeFlow({
        action: 'dropoff',
        resourceConformsTo: specId,
        resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
        recipeOutputOf: rp.id,
    });
    if (truckSpecId) {
        recipes.addRecipeFlow({
            action: 'use',
            resourceConformsTo: truckSpecId,
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
            recipeInputOf: rp.id,
        });
    }
    return { recipe, rp };
}

function seedResource(observer: Observer, id: string, conformsTo: string, qty: number, location: string, containedIn?: string) {
    observer.record({
        id: `evt-seed-${id}`,
        action: 'raise',
        resourceInventoriedAs: id,
        resourceQuantity: { hasNumericalValue: qty, hasUnit: 'kg' },
    });
    // Patch location and conformsTo directly (raise creates/increments the resource)
    const r = observer.getResource(id);
    if (r) {
        (r as any).currentLocation = location;
        (r as any).conformsTo = conformsTo;
        if (containedIn) (r as any).containedIn = containedIn;
    }
}

// =============================================================================
// recipesForTransport
// =============================================================================

describe('recipesForTransport', () => {
    let recipes: RecipeStore;
    beforeEach(() => { recipes = new RecipeStore(); });

    test('returns a recipe with pickup input and dropoff output for the spec', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        const result = recipes.recipesForTransport('spec:wool');
        expect(result).toHaveLength(1);
    });

    test('does NOT return a production recipe (produce/consume) for the spec', () => {
        const recipe = recipes.addRecipe({ name: 'Produce wool', primaryOutput: 'spec:wool', recipeProcesses: [] });
        const rp = recipes.addRecipeProcess({ name: 'Spin', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(rp.id);
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:raw', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: rp.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: rp.id });

        expect(recipes.recipesForTransport('spec:wool')).toHaveLength(0);
    });

    test('does NOT return a recipe that only has pickup but no dropoff', () => {
        const recipe = recipes.addRecipe({ name: 'Pickup only', primaryOutput: 'spec:wool', recipeProcesses: [] });
        const rp = recipes.addRecipeProcess({ name: 'Load', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(rp.id);
        recipes.addRecipeFlow({ action: 'pickup', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: rp.id });

        expect(recipes.recipesForTransport('spec:wool')).toHaveLength(0);
    });

    test('returns a multi-leg chain recipe that has pickup on first process and dropoff on last', () => {
        const recipe = recipes.addRecipe({ name: 'Multi-leg', recipeProcesses: [] });
        const rp1 = recipes.addRecipeProcess({ name: 'Leg 1', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        const rp2 = recipes.addRecipeProcess({ name: 'Leg 2', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(rp1.id, rp2.id);
        recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf:  rp1.id });
        recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: rp1.id });
        recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf:  rp2.id });
        recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: rp2.id });

        expect(recipes.recipesForTransport('spec:wool')).toHaveLength(1);
    });

    test('does not return a transport recipe for a different spec', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        expect(recipes.recipesForTransport('spec:cotton')).toHaveLength(0);
    });
});

// =============================================================================
// Transport sub-task generation — basic
// =============================================================================

describe('transport sub-task — basic', () => {
    let recipes: RecipeStore;
    let planStore: PlanStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    test('generates pickup intent@FarmA and dropoff intent@FactoryB when wool exists at FarmA', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        const pickupIntent = result.intents.find(i => i.action === 'pickup');
        const dropoffIntent = result.intents.find(i => i.action === 'dropoff');

        expect(pickupIntent).toBeDefined();
        expect(pickupIntent?.atLocation).toBe('loc:FarmA');

        expect(dropoffIntent).toBeDefined();
        expect(dropoffIntent?.atLocation).toBe('loc:FactoryB');
    });

    test('pickup sub-demand resolves via netting — no purchase intent generated', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.purchaseIntents).toHaveLength(0);
    });

    test('use (truck) intent is stamped with atLocation = origin (FarmA)', () => {
        makeTransportRecipe(recipes, 'spec:wool', 'spec:truck');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        const useIntent = result.intents.find(i => i.action === 'use');
        expect(useIntent).toBeDefined();
        expect(useIntent?.atLocation).toBe('loc:FarmA');
    });

    test('transport process is registered', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.processes).toHaveLength(1);
        expect(result.processes[0].name).toBe('Truck leg');
    });
});

// =============================================================================
// Transport sub-task — fallback to purchase
// =============================================================================

describe('transport sub-task — fallback to purchase', () => {
    let recipes: RecipeStore;
    let planStore: PlanStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    test('falls through to purchase intent when wool exists elsewhere but NO transport recipe', () => {
        // No transport recipe registered — only a resource at FarmA
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.purchaseIntents).toHaveLength(1);
        expect(result.intents.find(i => i.action === 'pickup')).toBeUndefined();
    });

    test('falls through to purchase intent when transport recipe exists but NO wool anywhere', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        // No wool seeded at any location

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.purchaseIntents).toHaveLength(1);
        expect(result.intents.find(i => i.action === 'pickup')).toBeUndefined();
    });

    test('netting satisfies demand when wool IS already at destination — no transport', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FactoryB'); // at destination!

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.purchaseIntents).toHaveLength(0);
        expect(result.intents.find(i => i.action === 'pickup')).toBeUndefined();
        expect(result.allocated).toHaveLength(1);
    });

    test('no transport triggered when atLocation is not specified', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            // atLocation intentionally omitted
        });

        // Without atLocation there's no destination constraint — falls to purchase
        expect(result.intents.find(i => i.action === 'pickup')).toBeUndefined();
    });
});

// =============================================================================
// Transport — containedIn guard
// =============================================================================

describe('transport — containedIn guard', () => {
    let recipes: RecipeStore;
    let planStore: PlanStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    test('wool containedIn a container is NOT eligible as transport origin', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA', 'res:container-1');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        // Contained resource should be ignored → falls back to purchase
        expect(result.purchaseIntents).toHaveLength(1);
        expect(result.intents.find(i => i.action === 'pickup')).toBeUndefined();
    });

    test('wool free (no containedIn) at FarmA IS eligible as transport origin', () => {
        makeTransportRecipe(recipes, 'spec:wool');
        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA'); // no containedIn

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        expect(result.intents.find(i => i.action === 'pickup')).toBeDefined();
        expect(result.purchaseIntents).toHaveLength(0);
    });
});

// =============================================================================
// Transport — SNLT ranking
// =============================================================================

describe('transport — SNLT ranking', () => {
    test('picks the lowest-SNLT transport recipe when multiple candidates exist', () => {
        const recipes = new RecipeStore();
        const processReg = new ProcessRegistry();
        const planStore = new PlanStore(processReg);
        const observer = new Observer(processReg);

        // Direct route: 6h total, no work inputs → SNLT=0 but we compare by duration
        const direct = recipes.addRecipe({ name: 'Direct Route', primaryOutput: 'spec:wool', recipeProcesses: [] });
        const rpDirect = recipes.addRecipeProcess({ name: 'Direct Truck leg', hasDuration: { hasNumericalValue: 6, hasUnit: 'hours' } });
        direct.recipeProcesses.push(rpDirect.id);
        recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf:  rpDirect.id });
        recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: rpDirect.id });
        // Work input on direct → SNLT > 0
        recipes.addRecipeFlow({ action: 'work', effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' }, recipeInputOf: rpDirect.id });

        // Relay route: no work inputs → SNLT=0 (picked first)
        const relay = recipes.addRecipe({ name: 'Relay Route', primaryOutput: 'spec:wool', recipeProcesses: [] });
        const rpRelay = recipes.addRecipeProcess({ name: 'Relay Truck leg', hasDuration: { hasNumericalValue: 4, hasUnit: 'hours' } });
        relay.recipeProcesses.push(rpRelay.id);
        recipes.addRecipeFlow({ action: 'pickup',  resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf:  rpRelay.id });
        recipes.addRecipeFlow({ action: 'dropoff', resourceConformsTo: 'spec:wool', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: rpRelay.id });
        // No work flows → SNLT=0

        seedResource(observer, 'res:wool-1', 'spec:wool', 100, 'loc:FarmA');

        const plan = planStore.addPlan({ name: 'test-plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:wool',
            demandQuantity: 50,
            dueDate: new Date('2025-06-01'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
            atLocation: 'loc:FactoryB',
        });

        // Relay has SNLT=0 (no work), direct has SNLT>0 (has work input) → relay chosen
        expect(result.processes[0].name).toBe('Relay Truck leg');
    });
});
