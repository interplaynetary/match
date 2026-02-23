/**
 * Workflow Recipe Tests
 *
 * Covers two gaps fixed against the VF spec:
 *
 * 1. Workflow recipe pattern — `getProcessChain()` now matches on (spec, stage) so
 *    that sequential accept→modify pairs on the same spec are ordered correctly
 *    without spurious back-edges triggering the cycle-detection guard.
 *
 * 2. RecipeExchange isPrimary — `instantiateRecipe()` now uses an explicit
 *    `isPrimary` flag on RecipeFlow to classify commitments into
 *    Agreement.stipulates vs Agreement.stipulatesReciprocal, falling back to
 *    the old first-flow heuristic only when the flag is absent.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { RecipeStore } from '../knowledge/recipes';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import { dependentDemand } from '../algorithms/dependent-demand';

// =============================================================================
// HELPERS
// =============================================================================

function makeStores() {
    let n = 0;
    const gen = () => `id_${n++}`;
    const recipes = new RecipeStore(gen);
    const processReg = new ProcessRegistry();
    const planStore = new PlanStore(processReg, gen);
    const observer = new Observer(processReg);
    return { recipes, processReg, planStore, observer };
}

/**
 * Build a 3-process workflow recipe on spec:metal.
 *
 * P1 (Polish):  accept(spec:metal, no stage)       → modify(spec:metal, stage:polished)
 * P2 (Test):    accept(spec:metal, stage:polished)  → modify(spec:metal, stage:tested)
 * P3 (Package): accept(spec:metal, stage:tested)    → modify(spec:metal, stage:packaged)
 *
 * All three processes share the same resourceConformsTo='spec:metal', which is
 * the canonical workflow recipe pattern where a single resource traverses
 * multiple stage-changing steps.
 */
function buildThreeProcessWorkflow(recipes: RecipeStore) {
    const p1 = recipes.addRecipeProcess({ name: 'Polish', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
    const p2 = recipes.addRecipeProcess({ name: 'Test',   hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
    const p3 = recipes.addRecipeProcess({ name: 'Package', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });

    const recipe = recipes.addRecipe({
        name: 'Metal Processing',
        primaryOutput: 'spec:metal',
        recipeProcesses: [p1.id, p2.id, p3.id],
    });

    // P1 – accept raw metal, modify to polished
    recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal',                             recipeInputOf: p1.id });
    recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'polished',
                            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                            recipeOutputOf: p1.id });

    // P2 – accept polished, modify to tested
    recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal', stage: 'polished', recipeInputOf: p2.id });
    recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'tested',
                            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                            recipeOutputOf: p2.id });

    // P3 – accept tested, modify to packaged (final output)
    recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal', stage: 'tested',   recipeInputOf: p3.id });
    recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'packaged',
                            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                            recipeOutputOf: p3.id });

    return { recipe, p1, p2, p3 };
}

// =============================================================================
// SECTION A — getProcessChain() with workflow recipes
// =============================================================================

describe('getProcessChain(): workflow recipe — stage-aware edge detection', () => {

    test('single-process workflow (accept→modify): returns [P1]', () => {
        const { recipes } = makeStores();

        const p1 = recipes.addRecipeProcess({ name: 'Finish', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        const recipe = recipes.addRecipe({ name: 'Part', primaryOutput: 'spec:part', recipeProcesses: [p1.id] });

        recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:part',                     recipeInputOf: p1.id });
        recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:part', stage: 'finished',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p1.id });

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain).toHaveLength(1);
        expect(chain[0].name).toBe('Finish');
    });

    test('two-process workflow: chain is [P1, P2], no cycle thrown', () => {
        const { recipes } = makeStores();

        const p1 = recipes.addRecipeProcess({ name: 'Polish', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        const p2 = recipes.addRecipeProcess({ name: 'Test',   hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        const recipe = recipes.addRecipe({
            name: 'Two-step',
            primaryOutput: 'spec:metal',
            recipeProcesses: [p1.id, p2.id],
        });

        // P1: accept(no stage) → modify(stage:polished)
        recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal',                     recipeInputOf: p1.id });
        recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'polished',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p1.id });

        // P2: accept(stage:polished) → modify(stage:tested)
        recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal', stage: 'polished', recipeInputOf: p2.id });
        recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'tested',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p2.id });

        // Before the fix, this would throw "process chain contains a cycle"
        expect(() => recipes.getProcessChain(recipe.id)).not.toThrow();

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain).toHaveLength(2);
        expect(chain[0].name).toBe('Polish');
        expect(chain[1].name).toBe('Test');
    });

    test('three-process workflow: sorted [P1, P2, P3]', () => {
        const { recipes } = makeStores();
        const { recipe, p1, p2, p3 } = buildThreeProcessWorkflow(recipes);

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain).toHaveLength(3);
        expect(chain[0].id).toBe(p1.id);
        expect(chain[1].id).toBe(p2.id);
        expect(chain[2].id).toBe(p3.id);
    });

    test('three-process workflow: P1 is first (inDegree=0), P3 is last', () => {
        const { recipes } = makeStores();
        const { recipe, p1, p3 } = buildThreeProcessWorkflow(recipes);

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain[0].id).toBe(p1.id);   // raw-metal entry
        expect(chain[2].id).toBe(p3.id);   // final packaged output
    });

    test('mixed recipe — workflow prefix then manufacturing produce: correct order', () => {
        const { recipes } = makeStores();

        // P1 (workflow): accept(spec:metal, no stage) → modify(spec:metal, stage:polished)
        const p1 = recipes.addRecipeProcess({ name: 'Polish', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        // P2 (manufacturing): consume(spec:metal, stage:polished) → produce(spec:product)
        const p2 = recipes.addRecipeProcess({ name: 'Assemble', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });

        const recipe = recipes.addRecipe({
            name: 'Mixed',
            primaryOutput: 'spec:product',
            recipeProcesses: [p1.id, p2.id],
        });

        recipes.addRecipeFlow({ action: 'accept',  resourceConformsTo: 'spec:metal',                             recipeInputOf: p1.id });
        recipes.addRecipeFlow({ action: 'modify',  resourceConformsTo: 'spec:metal', stage: 'polished',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p1.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:metal', stage: 'polished',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeInputOf: p2.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:product',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p2.id });

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain).toHaveLength(2);
        expect(chain[0].id).toBe(p1.id);
        expect(chain[1].id).toBe(p2.id);
    });

    test('manufacturing recipe (produce/consume, no stage): unchanged behaviour', () => {
        const { recipes } = makeStores();

        // Classic manufacturing: P1 produces spec:flour, P2 consumes spec:flour and produces spec:bread
        const p1 = recipes.addRecipeProcess({ name: 'Mill',   hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        const p2 = recipes.addRecipeProcess({ name: 'Bake',   hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });

        const recipe = recipes.addRecipe({
            name: 'Bread',
            primaryOutput: 'spec:bread',
            recipeProcesses: [p1.id, p2.id],
        });

        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:flour',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
                                recipeOutputOf: p1.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:flour',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' },
                                recipeInputOf: p2.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:bread',
                                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
                                recipeOutputOf: p2.id });

        const chain = recipes.getProcessChain(recipe.id);
        expect(chain).toHaveLength(2);
        expect(chain[0].name).toBe('Mill');
        expect(chain[1].name).toBe('Bake');
    });
});

// =============================================================================
// SECTION B — dependentDemand() with workflow recipes
// =============================================================================

describe('dependentDemand(): workflow recipe — composite spec|stage key', () => {

    let recipes: RecipeStore;
    let planStore: PlanStore;
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        ({ recipes, planStore, processReg, observer } = makeStores());
    });

    /**
     * Build workflow recipe where P1 also needs an EXTERNAL compound (spec:compound)
     * to make the purchase-intent assertion unambiguous.
     *
     * P1: accept(spec:metal) + consume(spec:compound) → modify(spec:metal, stage:polished)
     * P2: accept(spec:metal, stage:polished)           → modify(spec:metal, stage:tested)
     * P3: accept(spec:metal, stage:tested)             → modify(spec:metal, stage:packaged)
     */
    function buildWorkflowWithExternalInput() {
        const p1 = recipes.addRecipeProcess({ name: 'Polish',  hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        const p2 = recipes.addRecipeProcess({ name: 'Test',    hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        const p3 = recipes.addRecipeProcess({ name: 'Package', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });

        const recipe = recipes.addRecipe({
            name: 'Metal Workflow',
            primaryOutput: 'spec:metal',
            recipeProcesses: [p1.id, p2.id, p3.id],
        });

        // P1
        recipes.addRecipeFlow({ action: 'accept',  resourceConformsTo: 'spec:metal',
                                recipeInputOf: p1.id });
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:compound',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'litre' },
                                recipeInputOf: p1.id });
        recipes.addRecipeFlow({ action: 'modify',  resourceConformsTo: 'spec:metal', stage: 'polished',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p1.id });

        // P2
        recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal', stage: 'polished',
                                recipeInputOf: p2.id });
        recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'tested',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p2.id });

        // P3
        recipes.addRecipeFlow({ action: 'accept', resourceConformsTo: 'spec:metal', stage: 'tested',
                                recipeInputOf: p3.id });
        recipes.addRecipeFlow({ action: 'modify', resourceConformsTo: 'spec:metal', stage: 'packaged',
                                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                                recipeOutputOf: p3.id });

        return { recipe, p1, p2, p3 };
    }

    test('exploding workflow demand does not throw a cycle error', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        expect(() => dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 1,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        })).not.toThrow();
    });

    test('three processes are scheduled for a workflow demand', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 1,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        expect(result.processes).toHaveLength(3);
        const names = result.processes.map(p => p.name);
        expect(names).toContain('Polish');
        expect(names).toContain('Test');
        expect(names).toContain('Package');
    });

    test('intermediate stage (spec:metal|polished) is NOT an external demand', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 1,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // P2's input (spec:metal, stage:polished) must NOT appear as a purchase intent
        const polishedPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:metal' && i.stage === 'polished'
        );
        expect(polishedPurchase).toBeUndefined();
    });

    test('intermediate stage (spec:metal|tested) is NOT an external demand', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 1,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const testedPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:metal' && i.stage === 'tested'
        );
        expect(testedPurchase).toBeUndefined();
    });

    test('external spec:compound input IS a purchase intent', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 1,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const compoundPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:compound'
        );
        expect(compoundPurchase).toBeDefined();
        expect(compoundPurchase!.resourceQuantity?.hasNumericalValue).toBe(1);
    });

    test('intermediate stages (polished, tested) are not purchase intents even when qty > 1', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 5,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Stage-specific purchase intents for intermediate stages must not exist.
        // (P1's raw no-stage accept may appear as a durable existence-gate signal
        //  but that is separate from intermediate stage suppression.)
        const polishedPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:metal' && i.stage === 'polished'
        );
        const testedPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:metal' && i.stage === 'tested'
        );
        expect(polishedPurchase).toBeUndefined();
        expect(testedPurchase).toBeUndefined();
    });

    test('spec:compound purchase intent scaled by demand quantity', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 3,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const compoundPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:compound'
        );
        expect(compoundPurchase).toBeDefined();
        expect(compoundPurchase!.resourceQuantity?.hasNumericalValue).toBe(3);
    });

    test('existing spec:compound inventory reduces purchase intent qty', () => {
        buildWorkflowWithExternalInput();
        const plan = planStore.addPlan({ name: 'Workflow Plan' });

        observer.seedResource({
            id: 'res-compound',
            conformsTo: 'spec:compound',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'litre' },
        });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:metal',
            demandQuantity: 5,
            dueDate: new Date('2026-03-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Need 5 compound; 2 in inventory → purchase 3
        const compoundPurchase = result.purchaseIntents.find(
            i => i.resourceConformsTo === 'spec:compound'
        );
        expect(compoundPurchase).toBeDefined();
        expect(compoundPurchase!.resourceQuantity?.hasNumericalValue).toBe(3);
    });
});

// =============================================================================
// SECTION C — instantiateRecipe() with workflow recipes
// =============================================================================

describe('instantiateRecipe(): workflow recipe — scheduling', () => {

    test('processes are back-scheduled in correct temporal order (P1 earliest, P3 latest)', () => {
        const { recipes, planStore, processReg } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const dueDate = new Date('2026-03-01T12:00:00Z');
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, dueDate);

        expect(result.processes).toHaveLength(3);

        const pPolish  = result.processes.find(p => p.name === 'Polish')!;
        const pTest    = result.processes.find(p => p.name === 'Test')!;
        const pPackage = result.processes.find(p => p.name === 'Package')!;

        expect(pPolish).toBeDefined();
        expect(pTest).toBeDefined();
        expect(pPackage).toBeDefined();

        // P1 (Polish, 1h) starts before P2 (Test, 2h) which starts before P3 (Package, 1h)
        const polishBegin  = new Date(pPolish.hasBeginning!).getTime();
        const testBegin    = new Date(pTest.hasBeginning!).getTime();
        const packageBegin = new Date(pPackage.hasBeginning!).getTime();

        expect(polishBegin).toBeLessThan(testBegin);
        expect(testBegin).toBeLessThan(packageBegin);
    });

    test('processes are chained: P1.end = P2.begin, P2.end = P3.begin', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const dueDate = new Date('2026-03-01T12:00:00Z');
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, dueDate);

        const pPolish  = result.processes.find(p => p.name === 'Polish')!;
        const pTest    = result.processes.find(p => p.name === 'Test')!;
        const pPackage = result.processes.find(p => p.name === 'Package')!;

        // Back-scheduled: Package ends at dueDate, Test ends when Package starts, etc.
        expect(pPackage.hasEnd).toBe(dueDate.toISOString());
        expect(pTest.hasEnd).toBe(pPackage.hasBeginning);
        expect(pPolish.hasEnd).toBe(pTest.hasBeginning);
    });

    test('intents are created for each process accept and modify flow', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const dueDate = new Date('2026-03-01T12:00:00Z');
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, dueDate);

        // 3 processes × (1 accept input + 1 modify output) = 6 intents
        expect(result.intents).toHaveLength(6);

        const accepts  = result.intents.filter(i => i.action === 'accept');
        const modifies = result.intents.filter(i => i.action === 'modify');
        expect(accepts).toHaveLength(3);
        expect(modifies).toHaveLength(3);
    });

    test('modify output intents carry the correct stage for each step', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const dueDate = new Date('2026-03-01T12:00:00Z');
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, dueDate);

        const modifies = result.intents.filter(i => i.action === 'modify');
        const stages = modifies.map(i => i.stage).sort();
        expect(stages).toEqual(['packaged', 'polished', 'tested'].sort());
    });

    test('accept input intents carry correct stage (first accept has no stage)', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, new Date());

        const accepts = result.intents.filter(i => i.action === 'accept');

        const rawAccept = accepts.find(a => !a.stage);
        expect(rawAccept).toBeDefined();   // P1's raw accept has no stage

        const polishedAccept = accepts.find(a => a.stage === 'polished');
        expect(polishedAccept).toBeDefined();

        const testedAccept = accepts.find(a => a.stage === 'tested');
        expect(testedAccept).toBeDefined();
    });

    test('with agents, all workflow flows become Commitments (not Intents)', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildThreeProcessWorkflow(recipes);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'factory', receiver: 'warehouse' },
        );

        expect(result.intents).toHaveLength(0);
        expect(result.commitments).toHaveLength(6); // 3 accepts + 3 modifies
    });
});

// =============================================================================
// SECTION D — RecipeExchange isPrimary flag
// =============================================================================

describe('instantiateRecipe(): RecipeExchange isPrimary classification', () => {

    function buildRecipeWithExchange(recipes: RecipeStore, flows: Array<{
        resourceConformsTo: string;
        isPrimary?: boolean;
    }>) {
        const proc = recipes.addRecipeProcess({
            name: 'Produce',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
        });
        const rex = recipes.addRecipeExchange({ name: 'Trade' });
        const recipe = recipes.addRecipe({
            name: 'Sale',
            primaryOutput: 'spec:goods',
            recipeProcesses: [proc.id],
            recipeExchanges: [rex.id],
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:goods',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeOutputOf: proc.id,
        });

        for (const f of flows) {
            recipes.addRecipeFlow({
                action: 'transfer',
                resourceConformsTo: f.resourceConformsTo,
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                recipeClauseOf: rex.id,
                isPrimary: f.isPrimary,
            });
        }
        return { recipe, rex };
    }

    test('isPrimary:true on first flow → commitment goes to stipulates', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildRecipeWithExchange(recipes, [
            { resourceConformsTo: 'spec:goods',  isPrimary: true },
            { resourceConformsTo: 'spec:money',  isPrimary: false },
        ]);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'seller', receiver: 'buyer' },
        );

        expect(result.agreements).toHaveLength(1);
        const ag = result.agreements[0];
        expect(ag.stipulates).toHaveLength(1);
        expect(ag.stipulatesReciprocal).toHaveLength(1);

        const primaryC    = result.commitments.find(c => c.id === ag.stipulates![0])!;
        const reciprocalC = result.commitments.find(c => c.id === ag.stipulatesReciprocal![0])!;
        expect(primaryC.resourceConformsTo).toBe('spec:goods');
        expect(reciprocalC.resourceConformsTo).toBe('spec:money');
    });

    test('isPrimary:false on first flow → commitment goes to stipulatesReciprocal', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildRecipeWithExchange(recipes, [
            { resourceConformsTo: 'spec:money',  isPrimary: false },
            { resourceConformsTo: 'spec:goods' },  // no flag → heuristic makes this primary
        ]);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'seller', receiver: 'buyer' },
        );

        const ag = result.agreements[0];
        expect(ag.stipulates).toHaveLength(1);
        expect(ag.stipulatesReciprocal).toHaveLength(1);

        const primaryC = result.commitments.find(c => c.id === ag.stipulates![0])!;
        expect(primaryC.resourceConformsTo).toBe('spec:goods'); // second flow promoted
        const recipC = result.commitments.find(c => c.id === ag.stipulatesReciprocal![0])!;
        expect(recipC.resourceConformsTo).toBe('spec:money');
    });

    test('both flows isPrimary:true → both go to stipulates, none to stipulatesReciprocal', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildRecipeWithExchange(recipes, [
            { resourceConformsTo: 'spec:goods',   isPrimary: true },
            { resourceConformsTo: 'spec:service',  isPrimary: true },
        ]);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'seller', receiver: 'buyer' },
        );

        const ag = result.agreements[0];
        expect(ag.stipulates).toHaveLength(2);
        expect(ag.stipulatesReciprocal).toBeUndefined();
    });

    test('no isPrimary on any flow → first-flow-is-primary fallback preserved', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildRecipeWithExchange(recipes, [
            { resourceConformsTo: 'spec:goods' },
            { resourceConformsTo: 'spec:money' },
        ]);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'seller', receiver: 'buyer' },
        );

        const ag = result.agreements[0];
        expect(ag.stipulates).toHaveLength(1);
        expect(ag.stipulatesReciprocal).toHaveLength(1);

        // First flow (spec:goods) must be primary
        const primaryC = result.commitments.find(c => c.id === ag.stipulates![0])!;
        expect(primaryC.resourceConformsTo).toBe('spec:goods');
    });

    test('clauseOf is set on all exchange commitments', () => {
        const { recipes, planStore } = makeStores();
        const { recipe } = buildRecipeWithExchange(recipes, [
            { resourceConformsTo: 'spec:goods',  isPrimary: true },
            { resourceConformsTo: 'spec:money',  isPrimary: false },
        ]);

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 1, new Date(),
            { provider: 'seller', receiver: 'buyer' },
        );

        const ag = result.agreements[0];
        const allIds = [...(ag.stipulates ?? []), ...(ag.stipulatesReciprocal ?? [])];
        for (const id of allIds) {
            const c = result.commitments.find(c => c.id === id)!;
            expect(c.clauseOf).toBe(ag.id);
        }
    });
});
