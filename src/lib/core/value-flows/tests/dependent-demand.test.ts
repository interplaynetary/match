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
        planStore = new PlanStore();
        recipes = new RecipeStore();
        observer = new Observer(processReg);
    });

    test('explodes demand backwards through a recipe chain', () => {
        // Build a recipe: Table = 1 wood + 10 nails + 2 hours
        const recipe = recipes.addRecipe({ name: 'Table', basedOn: 'spec:table', recipeProcesses: [] });
        
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

        // Verify quantities scaled by 5
        const woodDemand = result.commitments.find(c => c.action === 'consume' && c.resourceConformsTo === 'spec:wood')!;
        expect(woodDemand.resourceQuantity?.hasNumericalValue).toBe(5);
        
        const nailDemand = result.commitments.find(c => c.action === 'consume' && c.resourceConformsTo === 'spec:nails')!;
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
        const recipe = recipes.addRecipe({ name: 'Carve', basedOn: 'spec:carving', recipeProcesses: [] });
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
});
