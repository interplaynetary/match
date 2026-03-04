/**
 * Tests for three algorithm layer additions:
 *   1. Minimum batch sizes in dependent demand
 *   2. SNE feedback loop via updateSNEFromPlan
 *   3. Depreciation scorer in value equations
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { dependentDemand } from '../algorithms/dependent-demand';
import { updateSNEFromPlan, updateSNEFromActuals, type SNEIndex } from '../algorithms/SNE';
import { makeDepreciationScorer, makeHybridWithDepreciationEquation, distributeIncome, effortEquation } from '../algorithms/value-equations';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { RecipeStore } from '../knowledge/recipes';
import { Observer } from '../observation/observer';

// =============================================================================
// PART 1 — MINIMUM BATCH SIZES
// =============================================================================

describe('Minimum batch sizes in dependent demand', () => {
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

    // Build a simple single-process recipe: process produces 10 units of spec:widget
    function buildWidgetRecipe(minimumBatchQty?: number) {
        const recipe = recipes.addRecipe({ name: 'Widget', primaryOutput: 'spec:widget', recipeProcesses: [] });
        const proc = recipes.addRecipeProcess({
            name: 'Make Widget',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            ...(minimumBatchQty !== undefined
                ? { minimumBatchQuantity: { hasNumericalValue: minimumBatchQty, hasUnit: 'each' } }
                : {}),
        });
        recipe.recipeProcesses.push(proc.id);

        // Output: 10 widgets per run
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
            recipeOutputOf: proc.id,
            resourceConformsTo: 'spec:widget',
        });
        // Input: steel (no recipe for steel → purchase intent)
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            recipeInputOf: proc.id,
            resourceConformsTo: 'spec:steel',
        });
        return { recipe, proc };
    }

    test('demand below minimum triggers full minimum-batch run', () => {
        buildWidgetRecipe(100); // min 100 units per run; recipe output = 10/run
        const plan = planStore.addPlan({ name: 'Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget',
            demandQuantity: 40,           // need 40, but minimum batch is 100
            dueDate: new Date('2026-06-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Output intent should show 100 (the minimum batch), not 40
        const outputIntent = result.intents.find(i => i.action === 'produce' && i.resourceConformsTo === 'spec:widget')!;
        expect(outputIntent).toBeDefined();
        expect(outputIntent.resourceQuantity?.hasNumericalValue).toBe(100);

        // Input steel should be scaled to full batch: 5 kg/run × (100/10 scale) = 50 kg
        const steelIntent = result.intents.find(i => i.action === 'consume' && i.resourceConformsTo === 'spec:steel')!;
        expect(steelIntent).toBeDefined();
        expect(steelIntent.resourceQuantity?.hasNumericalValue).toBe(50);
    });

    test('demand exceeding minimum uses demand quantity', () => {
        buildWidgetRecipe(100); // min 100
        const plan = planStore.addPlan({ name: 'Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget',
            demandQuantity: 150,          // 150 > 100 minimum
            dueDate: new Date('2026-06-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const outputIntent = result.intents.find(i => i.action === 'produce' && i.resourceConformsTo === 'spec:widget')!;
        expect(outputIntent.resourceQuantity?.hasNumericalValue).toBe(150);
    });

    test('no minimum: scaleFactor equals demand/recipeOutput exactly', () => {
        buildWidgetRecipe(); // no minimum
        const plan = planStore.addPlan({ name: 'Plan' });

        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget',
            demandQuantity: 30,           // 30 / 10 = scale 3
            dueDate: new Date('2026-06-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        const outputIntent = result.intents.find(i => i.action === 'produce' && i.resourceConformsTo === 'spec:widget')!;
        expect(outputIntent.resourceQuantity?.hasNumericalValue).toBe(30);
    });

    test('minimum on intermediate process clamps scale factor', () => {
        // Two-process chain: cut steel → make widget
        // min batch on CUT STEEL (intermediate) is large enough to drive scale up

        const recipe = recipes.addRecipe({ name: 'Widget2', primaryOutput: 'spec:widget2', recipeProcesses: [] });

        // Intermediate process: cut steel → 20 half-slabs/run; min batch 60 half-slabs
        const cutProc = recipes.addRecipeProcess({
            name: 'Cut Steel',
            hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' },
            minimumBatchQuantity: { hasNumericalValue: 60, hasUnit: 'each' }, // 60 half-slabs/run minimum
        });
        recipe.recipeProcesses.push(cutProc.id);

        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'each' },
            recipeOutputOf: cutProc.id,
            resourceConformsTo: 'spec:half-slab',
        });
        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            recipeInputOf: cutProc.id,
            resourceConformsTo: 'spec:raw-steel',
        });

        // Final process: 2 half-slabs → 1 widget2; NO minimum
        const buildProc = recipes.addRecipeProcess({
            name: 'Build Widget2',
            hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' },
        });
        recipe.recipeProcesses.push(buildProc.id);

        recipes.addRecipeFlow({
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            recipeInputOf: buildProc.id,
            resourceConformsTo: 'spec:half-slab',
        });
        recipes.addRecipeFlow({
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            recipeOutputOf: buildProc.id,
            resourceConformsTo: 'spec:widget2',
        });

        const plan = planStore.addPlan({ name: 'Plan' });

        // Demand 5 widget2 → base scaleFactor = 5 / 1 = 5
        // CutProc minimum 60 half-slabs: minScaleFactor = 60 / 1 (recipeOutputQty of widget2) = 60
        // → effectiveScaleFactor = 60
        const result = dependentDemand({
            planId: plan.id,
            demandSpecId: 'spec:widget2',
            demandQuantity: 5,
            dueDate: new Date('2026-06-01T12:00:00Z'),
            recipeStore: recipes,
            planStore,
            processes: processReg,
        });

        // Output qty should be clamped to 60 (from intermediate process minimum)
        const outputIntent = result.intents.find(i => i.action === 'produce' && i.resourceConformsTo === 'spec:widget2')!;
        expect(outputIntent.resourceQuantity?.hasNumericalValue).toBe(60);
    });
});

// =============================================================================
// PART 2 — SNE FEEDBACK LOOP
// =============================================================================

describe('updateSNEFromPlan — SNE feedback loop', () => {
    let processReg: ProcessRegistry;
    let observer: Observer;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        observer = new Observer(processReg);
    });

    test('updates sneIndex toward observed labor/output ratio', () => {
        processReg.register({ id: 'proc-1', name: 'Production' });

        // 4 hours of work
        observer.record({ id: 'w1', action: 'work', inputOf: 'proc-1', effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' } });
        // 2 units produced
        observer.record({
            id: 'p1', action: 'produce', outputOf: 'proc-1',
            resourceConformsTo: 'spec:widget',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
        });

        const sneIndex: SNEIndex = new Map();
        updateSNEFromPlan(['proc-1'], 'spec:widget', observer, sneIndex);

        // actualSNE = 4 / 2 = 2.0
        // No prior → sneIndex is set to actualSNE = 2.0
        expect(sneIndex.get('spec:widget')).toBeCloseTo(2.0);
    });

    test('blends with existing prior via EMA', () => {
        processReg.register({ id: 'proc-2', name: 'Production 2' });

        observer.record({ id: 'w2', action: 'work', inputOf: 'proc-2', effortQuantity: { hasNumericalValue: 10, hasUnit: 'hours' } });
        observer.record({
            id: 'p2', action: 'produce', outputOf: 'proc-2',
            resourceConformsTo: 'spec:bolt',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
        });

        // Prior SNE = 3.0
        const sneIndex: SNEIndex = new Map([['spec:bolt', 3.0]]);
        updateSNEFromPlan(['proc-2'], 'spec:bolt', observer, sneIndex, 0.1);

        // actualSNE = 10 / 5 = 2.0
        // new = 0.1 × 2.0 + 0.9 × 3.0 = 0.2 + 2.7 = 2.9
        expect(sneIndex.get('spec:bolt')).toBeCloseTo(2.9);
    });

    test('no-op when no output events', () => {
        processReg.register({ id: 'proc-3', name: 'Production 3' });
        observer.record({ id: 'w3', action: 'work', inputOf: 'proc-3', effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' } });
        // No produce event

        const sneIndex: SNEIndex = new Map([['spec:gizmo', 5.0]]);
        updateSNEFromPlan(['proc-3'], 'spec:gizmo', observer, sneIndex);

        // Should be unchanged (zero denominator guard)
        expect(sneIndex.get('spec:gizmo')).toBe(5.0);
    });

    test('multiple processes — aggregates across all of them', () => {
        processReg.register({ id: 'pa', name: 'A' });
        processReg.register({ id: 'pb', name: 'B' });

        observer.record({ id: 'wa', action: 'work', inputOf: 'pa', effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' } });
        observer.record({ id: 'wb', action: 'work', inputOf: 'pb', effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' } });
        observer.record({
            id: 'pa-out', action: 'produce', outputOf: 'pb',
            resourceConformsTo: 'spec:part',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' },
        });

        const sneIndex: SNEIndex = new Map();
        updateSNEFromPlan(['pa', 'pb'], 'spec:part', observer, sneIndex);

        // totalWork = 4, totalOutput = 4; actualSNE = 1.0
        expect(sneIndex.get('spec:part')).toBeCloseTo(1.0);
    });

    test('modify output events count toward the denominator', () => {
        // VF accept→modify pair: accept removes from onhand, modify adds back at new stage.
        // The modify event IS an output and should count as produced quantity for SNE.
        processReg.register({ id: 'proc-mod', name: 'Refinement' });

        observer.record({ id: 'wm', action: 'work', inputOf: 'proc-mod', effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' } });
        observer.record({
            id: 'pm', action: 'modify', outputOf: 'proc-mod',
            resourceConformsTo: 'spec:refined-part',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
        });

        const sneIndex: SNEIndex = new Map();
        updateSNEFromPlan(['proc-mod'], 'spec:refined-part', observer, sneIndex);

        // actualSNE = 6 / 3 = 2.0
        expect(sneIndex.get('spec:refined-part')).toBeCloseTo(2.0);
    });

    test('mix of produce and modify outputs — both contribute to denominator', () => {
        // A process that both produces new units AND modifies existing ones
        // (e.g. an assembly step that outputs a finished good and returns a jig).
        processReg.register({ id: 'proc-mix', name: 'Mixed Output' });

        observer.record({ id: 'wm2', action: 'work', inputOf: 'proc-mix', effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' } });
        observer.record({
            id: 'out1', action: 'produce', outputOf: 'proc-mix',
            resourceConformsTo: 'spec:frame',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
        });
        observer.record({
            id: 'out2', action: 'modify', outputOf: 'proc-mix',
            resourceConformsTo: 'spec:frame',
            resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
        });

        const sneIndex: SNEIndex = new Map();
        updateSNEFromPlan(['proc-mix'], 'spec:frame', observer, sneIndex);

        // totalWork = 8, totalOutput = 2 + 2 = 4 → actualSNE = 2.0
        expect(sneIndex.get('spec:frame')).toBeCloseTo(2.0);
    });

    test('eventsForProcess returns the correct events', () => {
        processReg.register({ id: 'proc-q', name: 'Q' });
        observer.record({ id: 'eq1', action: 'work', inputOf: 'proc-q', effortQuantity: { hasNumericalValue: 1, hasUnit: 'hours' } });
        observer.record({ id: 'eq2', action: 'consume', inputOf: 'proc-q', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } });

        const events = observer.eventsForProcess('proc-q');
        expect(events.length).toBe(2);
        expect(events.map(e => e.id)).toContain('eq1');
        expect(events.map(e => e.id)).toContain('eq2');
    });
});

// =============================================================================
// PART 3 — DEPRECIATION SCORER
// =============================================================================

describe('makeDepreciationScorer', () => {
    let observer: Observer;
    let processReg: ProcessRegistry;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        observer = new Observer(processReg);
    });

    test('scores use event as (duration / lifespan) × SNE(spec)', () => {
        const sneIndex: SNEIndex = new Map([['spec:drill', 500]]);
        const lifespans = new Map([['spec:drill', 1000]]);
        const scorer = makeDepreciationScorer(sneIndex, lifespans);

        const event = {
            id: 'e1', action: 'use' as const,
            resourceConformsTo: 'spec:drill',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        };

        // (2 / 1000) × 500 = 1.0
        expect(scorer(event)).toBeCloseTo(1.0);
    });

    test('scores 0 for work events', () => {
        const sneIndex: SNEIndex = new Map([['spec:labor', 1]]);
        const lifespans = new Map([['spec:labor', 1000]]);
        const scorer = makeDepreciationScorer(sneIndex, lifespans);

        const event = {
            id: 'e2', action: 'work' as const,
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        };
        expect(scorer(event)).toBe(0);
    });

    test('scores 0 for consume events', () => {
        const sneIndex: SNEIndex = new Map();
        const lifespans = new Map();
        const scorer = makeDepreciationScorer(sneIndex, lifespans);

        const event = {
            id: 'e3', action: 'consume' as const,
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        };
        expect(scorer(event)).toBe(0);
    });

    test('scores 0 when lifespan is missing', () => {
        const sneIndex: SNEIndex = new Map([['spec:drill', 500]]);
        const lifespans = new Map<string, number>(); // empty — no lifespan for drill
        const scorer = makeDepreciationScorer(sneIndex, lifespans);

        const event = {
            id: 'e4', action: 'use' as const,
            resourceConformsTo: 'spec:drill',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        };
        expect(scorer(event)).toBe(0);
    });

    test('scores 0 when SNE is missing (unknown spec)', () => {
        const sneIndex: SNEIndex = new Map(); // no entry for drill
        const lifespans = new Map([['spec:drill', 1000]]);
        const scorer = makeDepreciationScorer(sneIndex, lifespans);

        const event = {
            id: 'e5', action: 'use' as const,
            resourceConformsTo: 'spec:drill',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        };
        // SNE defaults to 0 → score = 0
        expect(scorer(event)).toBe(0);
    });

    test('looks up conformsTo via observer when resourceConformsTo missing on event', () => {
        // Register a resource with conformsTo = spec:drill
        observer.record({
            id: 'create-drill',
            action: 'produce',
            resourceInventoriedAs: 'res:drill-1',
            resourceConformsTo: 'spec:drill',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
        });

        const sneIndex: SNEIndex = new Map([['spec:drill', 500]]);
        const lifespans = new Map([['spec:drill', 1000]]);
        const scorer = makeDepreciationScorer(sneIndex, lifespans, observer);

        const event = {
            id: 'e6', action: 'use' as const,
            resourceInventoriedAs: 'res:drill-1', // no resourceConformsTo on the event
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        };

        // Should resolve via observer: (2 / 1000) × 500 = 1.0
        expect(scorer(event)).toBeCloseTo(1.0);
    });

    test('makeHybridWithDepreciationEquation integrates into distributeIncome correctly', () => {
        // Setup: alice does 10h work on a production process
        //        bob owns a drill used for 5h (drill SNE=400, lifespan=2000 → depreciation score = 1.0)
        //        income = 1100
        processReg.register({ id: 'proc-h', name: 'Hybrid Proc' });

        observer.record({
            id: 'ew', action: 'work',
            provider: 'alice',
            effortQuantity: { hasNumericalValue: 10, hasUnit: 'hours' },
            inputOf: 'proc-h',
        });
        observer.record({
            id: 'eu', action: 'use',
            provider: 'bob',
            resourceConformsTo: 'spec:drill',
            effortQuantity: { hasNumericalValue: 5, hasUnit: 'hours' },
            inputOf: 'proc-h',
        });
        observer.record({
            id: 'e-out', action: 'produce',
            resourceInventoriedAs: 'res-prod',
            outputOf: 'proc-h',
        });
        observer.record({
            id: 'e-sale', action: 'transfer',
            provider: 'alice',
            resourceInventoriedAs: 'res-prod',
            resourceQuantity: { hasNumericalValue: 1100, hasUnit: 'USD' },
        });

        // drill SNE = 400 effort-hours/unit, lifespan = 2000h → depreciation = (5/2000)×400 = 1.0
        const sneIndex: SNEIndex = new Map([['spec:drill', 400]]);
        const lifespans = new Map([['spec:drill', 2000]]);
        const equation = makeHybridWithDepreciationEquation(sneIndex, lifespans, observer);

        const result = distributeIncome('e-sale', observer, processReg, equation);

        expect(result.totalIncome).toBe(1100);

        // Alice: effort scorer = 10, weight=0.6 → 6.0
        // Bob: effort scorer = 0 (use event has no effortQuantity for effortScorer — wait, it does)
        // Actually effortScorer returns event.effortQuantity?.hasNumericalValue for any event
        // Bob's use event has effortQuantity=5 → effortScorer returns 5
        // Alice weighted: 0.6 × 10 = 6.0
        // Bob weighted: 0.6 × 0 (work action check — effortScorer doesn't filter by action)
        //   Actually effortScorer = (event) => event.effortQuantity?.hasNumericalValue ?? 0
        //   Bob's use event effortQuantity = 5 → effortScorer(bob) = 5 → 0.6 × 5 = 3.0
        //   depreciation scorer for bob = (5/2000)×400 = 1.0 → 0.4 × 1.0 = 0.4
        //   Bob total = 3.0 + 0.4 = 3.4
        // Alice depreciation = 0 (not a use event) → 0.4 × 0 = 0
        //   Alice total = 6.0
        // Total = 6.0 + 3.4 = 9.4
        // Alice share = 6.0 / 9.4, Bob share = 3.4 / 9.4

        const aliceShare = result.shares.find(s => s.agentId === 'alice')!;
        const bobShare = result.shares.find(s => s.agentId === 'bob')!;

        expect(aliceShare).toBeDefined();
        expect(bobShare).toBeDefined();

        // Bob's score should be higher than zero (depreciation accounted for)
        expect(bobShare.rawScore).toBeGreaterThan(0);
        expect(aliceShare.rawScore).toBeGreaterThan(0);

        // Total should be 1100
        expect(aliceShare.amount + bobShare.amount).toBeCloseTo(1100);

        // Bob's score = 3.4, alice's = 6.0
        expect(aliceShare.rawScore).toBeCloseTo(6.0);
        expect(bobShare.rawScore).toBeCloseTo(3.4);
    });
});
