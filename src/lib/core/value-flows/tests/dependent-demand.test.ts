import { describe, expect, test, beforeEach } from 'bun:test';
import { dependentDemand } from '../algorithms/dependent-demand';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';

describe('Dependent Demand (MRP)', () => {
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

    test('explodes demand backwards through a recipe chain', () => {
        // Build a recipe: Table = 1 wood + 10 nails + 2 hours
        const recipe = recipes.addRecipe({ name: 'Table', primaryOutput: 'spec:table', recipeProcesses: [] });
        
        const woodProcess = recipes.addRecipeProcess({ name: 'Cut Wood', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(woodProcess.id);
        
        // Output from woodProcess: 1 wood
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'wood' },
            recipeOutputOf: woodProcess.id,
            resourceConformsTo: 'spec:wood'
        });
        
        // Input to buildProcess: 1 wood
        const buildProcess = recipes.addRecipeProcess({ name: 'Build Table', hasDuration: { hasNumericalValue: 3, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(buildProcess.id);

        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'wood' },
            recipeInputOf: buildProcess.id,
            resourceConformsTo: 'spec:wood'
        });

        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'nails' },
            recipeInputOf: buildProcess.id,
            resourceConformsTo: 'spec:nails'
        });

        // Output from buildProcess: 1 table
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'table' },
            recipeOutputOf: buildProcess.id,
            resourceConformsTo: 'spec:table'
        });

        // Add plan
        const plan = planStore.addPlan({ name: 'Factory Plan' });
        
        const dueDate = new Date('2026-02-22T17:00:00Z');
        
        // Explode!
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:table',
            demandQuantity: 5, // We want 5 tables
            dueDate: dueDate,
            recipeStore: recipes,
            planStore: planStore,
            processes: processReg,
            observer: observer,
        });

        // We should have 2 processes created
        expect(result.processes.length).toBe(2);
        const pBuild = result.processes.find(p => p.name === 'Build Table')!;
        const pWood = result.processes.find(p => p.name === 'Cut Wood')!;
        
        // Verify scheduling (reverse process: Build finishes at due date, Cut finishes when Build starts)
        expect(pBuild.hasEnd).toBe(dueDate.toISOString());
        // 3 hours before 17:00 = 14:00
        expect(pBuild.hasBeginning).toBe(new Date('2026-02-22T14:00:00Z').toISOString());
        
        expect(pWood.hasEnd).toBe(pBuild.hasBeginning!);
        expect(pWood.hasBeginning).toBe(new Date('2026-02-22T13:00:00Z').toISOString());

        // No agents were provided, so all process flows are Intents (not Commitments)
        expect(result.commitments.length).toBe(0);

        // Verify quantities scaled by 5 — flows are in result.intents
        const woodDemand = result.intents.find(i => i.action === 'consume' && i.resourceConformsTo === 'spec:wood')!;
        expect(woodDemand.resourceQuantity?.hasNumericalValue).toBe(5);

        const nailDemand = result.intents.find(i => i.action === 'consume' && i.resourceConformsTo === 'spec:nails')!;
        expect(nailDemand.resourceQuantity?.hasNumericalValue).toBe(50);

        // Nails have no recipe -> purchase intent
        expect(result.purchaseIntents.length).toBe(1);
        expect(result.purchaseIntents[0].resourceConformsTo).toBe('spec:nails');
        expect(result.purchaseIntents[0].resourceQuantity?.hasNumericalValue).toBe(50);
        // Purchase intent due by start of build process
        expect(result.purchaseIntents[0].due).toBe(pBuild.hasBeginning!);
    });

    test('nets against existing inventory', () => {
        // Setup simple recipe demanding 'spec:wood'
        const recipe = recipes.addRecipe({ name: 'Carve', primaryOutput: 'spec:carving', recipeProcesses: [] });
        const process = recipes.addRecipeProcess({ name: 'Carve Wood' });
        recipe.recipeProcesses.push(process.id);

        recipes.addRecipeFlow({ action: 'consume', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'wood' }, recipeInputOf: process.id, resourceConformsTo: 'spec:wood' });
        recipes.addRecipeFlow({ action: 'produce', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'carving' }, recipeOutputOf: process.id, resourceConformsTo: 'spec:carving' });

        // Add 2 pieces of wood to inventory via Observer
        observer.seedResource({
            id: 'res-1',
            conformsTo: 'spec:wood',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'wood' }
        });

        const plan = planStore.addPlan({ name: 'P' });
        const dueDate = new Date();

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:carving',
            demandQuantity: 5,
            dueDate,
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // It should need 5 wood, but 2 are in inventory.
        // So it should allocate the 2 wood from inventory.
        // (Wait, netting applies to the exact demand! In this case, demand is 'spec:carving'.
        // So 'spec:carving' gets exploded, and 'spec:wood' becomes a sub-demand.
        // The sub-demand 'spec:wood' asks for 5 wood. It sees 2 in inventory and allocates them.
        // the remaining 3 'spec:wood' have no recipe -> purchase intent for 3!)

        expect(result.allocated.length).toBe(1);
        expect(result.allocated[0].resourceId).toBe('res-1');
        expect(result.allocated[0].quantity).toBe(2);

        expect(result.purchaseIntents.length).toBe(1);
        expect(result.purchaseIntents[0].resourceConformsTo).toBe('spec:wood');
        expect(result.purchaseIntents[0].resourceQuantity?.hasNumericalValue).toBe(3);
    });

    test('ranks recipes by SNLT efficiency', () => {
        // Recipe A: produces 1 spec:widget using 2 work-hours (less efficient)
        const recipeA = recipes.addRecipe({ name: 'Widget (Slow)', primaryOutput: 'spec:widget', recipeProcesses: [] });
        const procA = recipes.addRecipeProcess({ name: 'Make Widget Slow' });
        recipeA.recipeProcesses!.push(procA.id);
        recipes.addRecipeFlow({
            action: 'work',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
            recipeInputOf: procA.id,
            resourceConformsTo: 'spec:labour',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeOutputOf: procA.id,
            resourceConformsTo: 'spec:widget',
        });

        // Recipe B: produces 1 spec:widget using 1 work-hour (more efficient)
        const recipeB = recipes.addRecipe({ name: 'Widget (Fast)', primaryOutput: 'spec:widget', recipeProcesses: [] });
        const procB = recipes.addRecipeProcess({ name: 'Make Widget Fast' });
        recipeB.recipeProcesses!.push(procB.id);
        recipes.addRecipeFlow({
            action: 'work',
            effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' },
            recipeInputOf: procB.id,
            resourceConformsTo: 'spec:labour',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeOutputOf: procB.id,
            resourceConformsTo: 'spec:widget',
        });

        const plan = planStore.addPlan({ name: 'SNLT Test Plan' });
        const dueDate = new Date('2026-02-22T17:00:00Z');

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget',
            demandQuantity: 1,
            dueDate,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Must pick Recipe B (SNLT = 1 h/unit vs 2 h/unit)
        expect(result.processes.length).toBe(1);
        expect(result.processes[0].name).toBe('Make Widget Fast');
    });

    test('nets against previously scheduled output Intents', () => {
        // Recipe for spec:carving that needs 5 spec:wood per carving
        const recipe = recipes.addRecipe({ name: 'Carve2', primaryOutput: 'spec:carving2', recipeProcesses: [] });
        const proc = recipes.addRecipeProcess({ name: 'Carve Wood 2' });
        recipe.recipeProcesses!.push(proc.id);
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'wood' },
            recipeInputOf: proc.id,
            resourceConformsTo: 'spec:wood2',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'carving' },
            recipeOutputOf: proc.id,
            resourceConformsTo: 'spec:carving2',
        });

        const plan = planStore.addPlan({ name: 'Intent Netting Plan' });

        // Pre-seed a scheduled output Intent for spec:wood2, qty=3
        // (simulates a prior planned production run already in the planStore)
        const woodIntent = planStore.addIntent({
            action: 'produce',
            outputOf: 'some-prior-process-id',
            resourceConformsTo: 'spec:wood2',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'wood' },
            plannedWithin: plan.id,
            finished: false,
        });

        const dueDate = new Date('2026-02-22T17:00:00Z');

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:carving2',
            demandQuantity: 1,  // needs 5 wood
            dueDate,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // The wood Intent (qty=3) should have been soft-allocated
        expect(result.allocatedScheduledIds.size).toBe(1);
        expect(result.allocatedScheduledIds.has(woodIntent.id)).toBe(true);

        // Only 2 wood unmet → purchase intent for 2 (not 5)
        const woodPurchase = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:wood2');
        expect(woodPurchase).toBeDefined();
        expect(woodPurchase!.resourceQuantity?.hasNumericalValue).toBe(2);
    });

    test('nets against previously scheduled output Commitments (agent-known plans)', () => {
        // Same setup as the Intent test but the prior plan used agents → Commitments
        const recipe = recipes.addRecipe({ name: 'Carve3', primaryOutput: 'spec:carving3', recipeProcesses: [] });
        const proc = recipes.addRecipeProcess({ name: 'Carve Wood 3' });
        recipe.recipeProcesses!.push(proc.id);
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'wood' },
            recipeInputOf: proc.id,
            resourceConformsTo: 'spec:wood3',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'carving' },
            recipeOutputOf: proc.id,
            resourceConformsTo: 'spec:carving3',
        });

        const plan = planStore.addPlan({ name: 'Commitment Netting Plan' });

        // Pre-seed a scheduled output COMMITMENT for spec:wood3, qty=4
        // (agents known → Commitment, not Intent)
        const woodCommitment = planStore.addCommitment({
            action: 'produce',
            outputOf: 'some-prior-process-id',
            provider: 'agent:alice',
            receiver: 'agent:warehouse',
            resourceConformsTo: 'spec:wood3',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'wood' },
            plannedWithin: plan.id,
            finished: false,
        });

        const dueDate = new Date('2026-02-22T17:00:00Z');

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:carving3',
            demandQuantity: 1,  // needs 5 wood
            dueDate,
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // The wood Commitment (qty=4) should have been soft-allocated
        expect(result.allocatedScheduledIds.has(woodCommitment.id)).toBe(true);

        // Only 1 wood unmet → purchase intent for 1 (not 5)
        const woodPurchase = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:wood3');
        expect(woodPurchase).toBeDefined();
        expect(woodPurchase!.resourceQuantity?.hasNumericalValue).toBe(1);
    });

    // ── Stage/state netting (VF spec: resources.md §Stage and state) ──────────

    test('inventory netting: wrong-stage resource is NOT allocated', () => {
        // Recipe requires input flour that has been through 'milling' stage.
        const recipe = recipes.addRecipe({ name: 'Bread', primaryOutput: 'spec:bread', recipeProcesses: [] });
        const bakeProc = recipes.addRecipeProcess({ name: 'Bake', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(bakeProc.id);
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            recipeInputOf: bakeProc.id,
            stage: 'proc-spec:milled', // requires milled flour
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'loaf' },
            recipeOutputOf: bakeProc.id,
        });

        // Seed: 5 kg flour but in wrong stage ('raw', not 'milled')
        observer.seedResource({
            id: 'res-flour-raw',
            conformsTo: 'spec:flour',
            accountingQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            stage: 'proc-spec:raw',
        });

        const plan = planStore.addPlan({ name: 'Bread plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:bread',
            demandQuantity: 1,
            dueDate: new Date('2026-03-10T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Wrong-stage flour must NOT be allocated
        expect(result.allocated.length).toBe(0);
        // Purchase intent for flour should be created (full 5 kg unmet)
        const flourPurchase = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:flour');
        expect(flourPurchase).toBeDefined();
        expect(flourPurchase!.resourceQuantity?.hasNumericalValue).toBe(5);
    });

    test('inventory netting: correct-stage resource IS allocated', () => {
        const recipe = recipes.addRecipe({ name: 'Bread', primaryOutput: 'spec:bread2', recipeProcesses: [] });
        const bakeProc = recipes.addRecipeProcess({ name: 'Bake', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(bakeProc.id);
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:flour2',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
            recipeInputOf: bakeProc.id,
            stage: 'proc-spec:milled',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:bread2',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'loaf' },
            recipeOutputOf: bakeProc.id,
        });

        // Seed: correctly milled flour
        observer.seedResource({
            id: 'res-flour-milled',
            conformsTo: 'spec:flour2',
            accountingQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
            stage: 'proc-spec:milled',
        });

        const plan = planStore.addPlan({ name: 'Bread plan 2' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:bread2',
            demandQuantity: 1,
            dueDate: new Date('2026-03-10T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Correctly-staged flour IS allocated
        expect(result.allocated.length).toBe(1);
        expect(result.allocated[0].resourceId).toBe('res-flour-milled');
        expect(result.allocated[0].quantity).toBe(3);
        // No purchase intent needed
        expect(result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:flour2')).toBeUndefined();
    });

    test('inventory netting: wrong-state resource is NOT allocated', () => {
        const recipe = recipes.addRecipe({ name: 'Certified Widget', primaryOutput: 'spec:widget', recipeProcesses: [] });
        const assembleProc = recipes.addRecipeProcess({ name: 'Assemble', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses.push(assembleProc.id);
        recipes.addRecipeFlow({
            action: 'consume',
            resourceConformsTo: 'spec:component',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            recipeInputOf: assembleProc.id,
            state: 'pass', // must have passed quality test
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceConformsTo: 'spec:widget',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeOutputOf: assembleProc.id,
        });

        // Seed: components that failed QC
        observer.seedResource({
            id: 'res-comp-fail',
            conformsTo: 'spec:component',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            state: 'fail',
        });

        const plan = planStore.addPlan({ name: 'Widget plan' });
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget',
            demandQuantity: 1,
            dueDate: new Date('2026-03-10T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
            observer,
        });

        // Failed components must NOT be allocated
        expect(result.allocated.length).toBe(0);
        const compPurchase = result.purchaseIntents.find(i => i.resourceConformsTo === 'spec:component');
        expect(compPurchase).toBeDefined();
    });
});
