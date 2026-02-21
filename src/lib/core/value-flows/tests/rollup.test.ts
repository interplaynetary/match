import { describe, expect, test, beforeEach } from 'bun:test';
import { rollupStandardCost, rollupActualCost, costVariance, type UnitConverter } from '../algorithms/rollup';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';
import { RecipeStore } from '../knowledge/recipes';

describe('Value Rollup Algorithms', () => {
    let observer: Observer;
    let processReg: ProcessRegistry;
    let recipes: RecipeStore;
    
    // A simple mock converter
    // let's say: hours = $50/hr, wood = $10/ea, nails = $1/ea
    const mockConverter: UnitConverter = (qty, unit) => {
        if (unit === 'hours') return qty * 50;
        if (unit === 'wood') return qty * 10;
        if (unit === 'nails') return qty * 1;
        return 0;
    };

    beforeEach(() => {
        processReg = new ProcessRegistry();
        observer = new Observer(processReg);
        recipes = new RecipeStore();
    });

    test('rollupStandardCost calculates BOM value across recipe processes', () => {
        // Build a recipe: Table = 1 wood + 10 nails + 2 hours
        const recipe = recipes.addRecipe({ name: 'Table', basedOn: 'spec:table', recipeProcesses: [] });
        
        const woodProcess = recipes.addRecipeProcess({ name: 'Cut Wood' });
        recipe.recipeProcesses.push(woodProcess.id);
        
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'wood' },
            recipeInputOf: woodProcess.id,
            resourceConformsTo: 'spec:wood'
        });
        
        const buildProcess = recipes.addRecipeProcess({ name: 'Build Table' });
        recipe.recipeProcesses.push(buildProcess.id);
        
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'nails' },
            recipeInputOf: buildProcess.id,
            resourceConformsTo: 'spec:nails'
        });
        
        recipes.addRecipeFlow({
            action: 'work',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
            recipeInputOf: buildProcess.id,
            resourceConformsTo: 'skill:carpentry'
        });

        const stdCost = rollupStandardCost(recipe.id, recipes, mockConverter, 'USD', 1);

        expect(stdCost.source).toBe('recipe');
        expect(stdCost.commonUnit).toBe('USD');
        
        // Value: (1 wood * $10) + (10 nails * $1) + (2 hours * $50) = 10 + 10 + 100 = 120
        expect(stdCost.totalValue).toBe(120);
        expect(stdCost.stages.length).toBe(2);
        
        const woodStage = stdCost.stages.find(s => s.processName === 'Cut Wood')!;
        expect(woodStage.stageTotalValue).toBe(10);
        
        const buildStage = stdCost.stages.find(s => s.processName === 'Build Table')!;
        expect(buildStage.stageTotalValue).toBe(110);
    });

    test('rollupActualCost calculates value based on observer trace', () => {
        processReg.register({ id: 'p1', name: 'Making Table' });
        
        // Wood (should cost 10)
        observer.record({
            id: 'e1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'wood' },
            inputOf: 'p1'
        });
        
        // Actually used 12 nails instead of 10 (should cost 12)
        observer.record({
            id: 'e2',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 12, hasUnit: 'nails' },
            inputOf: 'p1'
        });
        
        // Actually took 3 hours instead of 2 (should cost 150)
        observer.record({
            id: 'e3',
            action: 'work',
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
            inputOf: 'p1'
        });
        
        // Product
        observer.record({
            id: 'e-out',
            action: 'produce',
            resourceInventoriedAs: 'res-table', // Final product
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            outputOf: 'p1'
        });

        // Trace backward from res-table
        const actualCost = rollupActualCost('res-table', observer, processReg, mockConverter, 'USD');

        expect(actualCost.source).toBe('events');
        expect(actualCost.totalValue).toBe(10 + 12 + 150); // 172
        expect(actualCost.stages.length).toBe(1);
        expect(actualCost.stages[0].processName).toBe('Making Table');
    });

    test('costVariance calculates differences correctly', () => {
        const stdCost = { source: 'recipe' as const, stages: [], totalValue: 100, commonUnit: 'USD' };
        
        // Under budget
        let actualCost = { source: 'events' as const, stages: [], totalValue: 80, commonUnit: 'USD' };
        let variance = costVariance(stdCost, actualCost);
        expect(variance.variance).toBe(20); // 100 - 80
        expect(variance.variancePct).toBe(20); // (20 / 100) * 100
        
        // Over budget
        actualCost = { source: 'events' as const, stages: [], totalValue: 150, commonUnit: 'USD' };
        variance = costVariance(stdCost, actualCost);
        expect(variance.variance).toBe(-50); // 100 - 150
        expect(variance.variancePct).toBe(-50);
    });
});
