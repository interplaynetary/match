/**
 * Advanced Planning Tests — promoteToCommitment, forward scheduling,
 * inventory netting, agreements, proposals, recurring intents.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { PlanStore } from '../planning/planning';
import { RecipeStore } from '../knowledge/recipes';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';

// ─── shared setup helpers ─────────────────────────────────────────────────────

function makeStores() {
    let idCount = 0;
    const reg      = new ProcessRegistry();
    const planStore = new PlanStore(reg, () => `id_${idCount++}`);
    const recipes   = new RecipeStore(() => `rid_${idCount++}`);
    const observer  = new Observer(reg);
    return { reg, planStore, recipes, observer };
}

/** Build a two-process recipe: ProcessA (aHours) → ProcessB (bHours). */
function buildTwoProcessRecipe(
    recipes: RecipeStore,
    opts: {
        specIn: string;     // input consumed by ProcessA
        specMid: string;    // intermediate: output of A / input of B
        specOut: string;    // final output of B
        aHours: number;
        bHours: number;
    },
) {
    const recipe = recipes.addRecipe({
        name: `${opts.specOut} recipe`,
        primaryOutput: opts.specOut,
        recipeProcesses: [],
    });

    const procA = recipes.addRecipeProcess({ name: 'ProcessA', hasDuration: { hasNumericalValue: opts.aHours, hasUnit: 'hours' } });
    const procB = recipes.addRecipeProcess({ name: 'ProcessB', hasDuration: { hasNumericalValue: opts.bHours, hasUnit: 'hours' } });
    recipe.recipeProcesses!.push(procA.id, procB.id);

    recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: opts.specIn, resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: procA.id });
    recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: opts.specMid, resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: procA.id });
    recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: opts.specMid, resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: procB.id });
    recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: opts.specOut, resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeOutputOf: procB.id });

    return { recipe, procA, procB };
}

// ─── promoteToCommitment ─────────────────────────────────────────────────────

describe('PlanStore.promoteToCommitment', () => {

    test('offer (provider-only intent) gains a receiver and becomes a Commitment', () => {
        const { planStore } = makeStores();

        const intent = planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            finished: false,
        });

        const commitment = planStore.promoteToCommitment(intent.id, { receiver: 'bob' });

        expect(commitment.provider).toBe('alice');
        expect(commitment.receiver).toBe('bob');
        expect(commitment.action).toBe('transfer');
        expect(commitment.resourceConformsTo).toBe('spec:wheat');
        expect(commitment.resourceQuantity?.hasNumericalValue).toBe(50);
        expect(commitment.satisfies).toBe(intent.id);
        expect(commitment.finished).toBe(false);
    });

    test('request (receiver-only intent) gains a provider and becomes a Commitment', () => {
        const { planStore } = makeStores();

        const intent = planStore.addIntent({
            action: 'transfer',
            receiver: 'carol',
            resourceConformsTo: 'spec:apples',
            finished: false,
        });

        const commitment = planStore.promoteToCommitment(intent.id, { provider: 'dave' });

        expect(commitment.provider).toBe('dave');
        expect(commitment.receiver).toBe('carol');
        expect(commitment.satisfies).toBe(intent.id);
    });

    test('non-recurring intent is marked finished after promote', () => {
        const { planStore } = makeStores();

        const intent = planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            finished: false,
        });

        planStore.promoteToCommitment(intent.id, { receiver: 'bob' });

        // A one-off intent is consumed by the commitment
        expect(planStore.getIntent(intent.id)!.finished).toBe(true);
    });

    test('recurring intent stays open after promote (availability_window set)', () => {
        const { planStore } = makeStores();

        const intent = planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            finished: false,
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [] }],
            },
        });

        planStore.promoteToCommitment(intent.id, { receiver: 'bob' });

        // Recurring intent must stay open — future Mondays can still match
        expect(planStore.getIntent(intent.id)!.finished).toBe(false);
    });

    test('throws if the promoted commitment would still lack provider or receiver', () => {
        const { planStore } = makeStores();

        // Intent has only a provider; counterparty doesn't supply receiver
        const intent = planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            finished: false,
        });

        expect(() =>
            planStore.promoteToCommitment(intent.id, {}), // empty counterparty
        ).toThrow(/need both provider and receiver/);
    });

    test('throws when intent does not exist', () => {
        const { planStore } = makeStores();
        expect(() =>
            planStore.promoteToCommitment('nonexistent', { receiver: 'bob' }),
        ).toThrow(/not found/);
    });

    test('commitment inherits due date and plan membership from the intent', () => {
        const { planStore } = makeStores();
        const plan = planStore.addPlan({ name: 'Test' });

        const intent = planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            due: '2026-04-15T10:00:00Z',
            plannedWithin: plan.id,
            finished: false,
        });

        const commitment = planStore.promoteToCommitment(intent.id, { receiver: 'bob' });

        expect(commitment.due).toBe('2026-04-15T10:00:00Z');
        expect(commitment.plannedWithin).toBe(plan.id);
    });
});

// ─── forward scheduling ───────────────────────────────────────────────────────

describe('instantiateRecipe: forward scheduling', () => {

    test('processes are scheduled forward from startDate', () => {
        const { planStore, recipes } = makeStores();

        buildTwoProcessRecipe(recipes, {
            specIn: 'spec:raw',
            specMid: 'spec:semi',
            specOut: 'spec:final',
            aHours: 2,
            bHours: 3,
        });

        const recipeId = recipes.allRecipes()[0].id;
        const startDate = new Date('2026-03-02T08:00:00Z');
        const dueDate   = new Date('2026-03-02T20:00:00Z'); // won't be used for timing

        const result = planStore.instantiateRecipe(
            recipes,
            recipeId,
            1,
            dueDate,
            undefined,
            'forward',
            startDate,
        );

        expect(result.processes.length).toBe(2);

        // Topological order: ProcessA first (it produces the intermediate)
        const procA = result.processes.find(p => p.name === 'ProcessA')!;
        const procB = result.processes.find(p => p.name === 'ProcessB')!;

        expect(procA.hasBeginning).toBe('2026-03-02T08:00:00.000Z');
        expect(procA.hasEnd).toBe('2026-03-02T10:00:00.000Z');  // +2h

        expect(procB.hasBeginning).toBe('2026-03-02T10:00:00.000Z');
        expect(procB.hasEnd).toBe('2026-03-02T13:00:00.000Z');  // +3h
    });

    test('back-scheduling: processes cascade backwards from dueDate', () => {
        const { planStore, recipes } = makeStores();

        buildTwoProcessRecipe(recipes, {
            specIn: 'spec:raw',
            specMid: 'spec:semi',
            specOut: 'spec:final',
            aHours: 2,
            bHours: 3,
        });

        const recipeId = recipes.allRecipes()[0].id;
        const dueDate  = new Date('2026-03-02T13:00:00Z');

        const result = planStore.instantiateRecipe(recipes, recipeId, 1, dueDate);

        const procA = result.processes.find(p => p.name === 'ProcessA')!;
        const procB = result.processes.find(p => p.name === 'ProcessB')!;

        // ProcessB is last: ends at dueDate, begins 3h earlier
        expect(procB.hasEnd).toBe('2026-03-02T13:00:00.000Z');
        expect(procB.hasBeginning).toBe('2026-03-02T10:00:00.000Z');

        // ProcessA comes before B
        expect(procA.hasEnd).toBe('2026-03-02T10:00:00.000Z');
        expect(procA.hasBeginning).toBe('2026-03-02T08:00:00.000Z');
    });
});

// ─── inventory netting in instantiateRecipe ───────────────────────────────────

describe('instantiateRecipe: observer inventory netting', () => {

    test('existing inventory reduces the demanded quantity', () => {
        const { planStore, recipes, observer } = makeStores();

        const recipe = recipes.addRecipe({
            name: 'Make Cake',
            primaryOutput: 'spec:cake',
            recipeProcesses: [],
        });
        const proc = recipes.addRecipeProcess({ name: 'Bake', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses!.push(proc.id);
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:flour', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' }, recipeInputOf: proc.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:cake', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeOutputOf: proc.id });

        // 3 kg of flour already in stock
        observer.seedResource({
            id: 'res-flour',
            conformsTo: 'spec:flour',
            accountingQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
        });

        const dueDate = new Date('2026-03-02T12:00:00Z');
        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, dueDate, undefined, 'back', undefined, observer);

        // 3 kg allocated from inventory → only 2 kg remaining as intent
        expect(result.allocated.length).toBe(1);
        expect(result.allocated[0].resourceId).toBe('res-flour');
        expect(result.allocated[0].quantity).toBe(3);

        // The consume intent should be for the remaining 2 kg
        const consumeIntent = result.intents.find(i => i.action === 'consume' && i.resourceConformsTo === 'spec:flour');
        expect(consumeIntent?.resourceQuantity?.hasNumericalValue).toBe(2);
    });

    test('fully satisfied by inventory — no consume flow created', () => {
        const { planStore, recipes, observer } = makeStores();

        const recipe = recipes.addRecipe({
            name: 'Assemble Widget',
            primaryOutput: 'spec:widget',
            recipeProcesses: [],
        });
        const proc = recipes.addRecipeProcess({ name: 'Assemble', hasDuration: { hasNumericalValue: 1, hasUnit: 'hours' } });
        recipe.recipeProcesses!.push(proc.id);
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:part', resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' }, recipeInputOf: proc.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:widget', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' }, recipeOutputOf: proc.id });

        // 5 parts in stock → more than enough
        observer.seedResource({
            id: 'res-parts',
            conformsTo: 'spec:part',
            accountingQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
        });

        const result = planStore.instantiateRecipe(recipes, recipe.id, 1, new Date(), undefined, 'back', undefined, observer);

        // Fully covered by inventory — no consume demand needed
        expect(result.allocated.length).toBe(1);
        expect(result.allocated[0].quantity).toBe(2);

        const consumeIntent = result.intents.find(i => i.action === 'consume' && i.resourceConformsTo === 'spec:part');
        expect(consumeIntent).toBeUndefined();
    });
});

// ─── agents produce Commitments (not Intents) ─────────────────────────────────

describe('instantiateRecipe: agents → Commitments', () => {

    test('providing both agents produces Commitments, not Intents', () => {
        const { planStore, recipes } = makeStores();

        const recipe = recipes.addRecipe({
            name: 'Produce Bread',
            primaryOutput: 'spec:bread',
            recipeProcesses: [],
        });
        const proc = recipes.addRecipeProcess({ name: 'Bake', hasDuration: { hasNumericalValue: 2, hasUnit: 'hours' } });
        recipe.recipeProcesses!.push(proc.id);
        recipes.addRecipeFlow({ action: 'consume', resourceConformsTo: 'spec:flour', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'kg' }, recipeInputOf: proc.id });
        recipes.addRecipeFlow({ action: 'produce', resourceConformsTo: 'spec:bread', resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' }, recipeOutputOf: proc.id });

        const result = planStore.instantiateRecipe(
            recipes, recipe.id, 10, new Date(),
            { provider: 'alice', receiver: 'warehouse' },
        );

        // All flows should be Commitments, not Intents
        expect(result.commitments.length).toBe(2);   // consume + produce
        expect(result.intents.length).toBe(0);

        const consumeC = result.commitments.find(c => c.action === 'consume')!;
        expect(consumeC.provider).toBe('alice');
        expect(consumeC.receiver).toBe('warehouse');
        expect(consumeC.resourceQuantity?.hasNumericalValue).toBe(5); // scaled: 10 breads / 2 per run = 5
    });
});

// ─── non-process commitments ─────────────────────────────────────────────────

describe('PlanStore.addNonProcessCommitment', () => {

    test('creates a standalone Commitment not attached to any process', () => {
        const { planStore } = makeStores();
        const plan = planStore.addPlan({ name: 'Logistics' });

        const commitment = planStore.addNonProcessCommitment({
            planId: plan.id,
            action: 'transfer',
            provider: 'supplier',
            receiver: 'warehouse',
            resourceConformsTo: 'spec:steel',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            due: '2026-04-01T08:00:00Z',
        });

        expect(commitment.inputOf).toBeUndefined();
        expect(commitment.outputOf).toBeUndefined();
        expect(commitment.plannedWithin).toBe(plan.id);
        expect(commitment.action).toBe('transfer');
        expect(planStore.allCommitments().length).toBe(1);
    });
});

// ─── commitmentsForProcess ────────────────────────────────────────────────────

describe('PlanStore.commitmentsForProcess', () => {

    test('returns only commitments linked to the specified process', () => {
        const { planStore } = makeStores();

        planStore.addCommitment({ action: 'consume', inputOf: 'proc-1', finished: false });
        planStore.addCommitment({ action: 'produce', outputOf: 'proc-1', finished: false });
        planStore.addCommitment({ action: 'consume', inputOf: 'proc-2', finished: false }); // different process

        const forProc1 = planStore.commitmentsForProcess('proc-1');
        expect(forProc1.length).toBe(2);
        expect(forProc1.every(c => c.inputOf === 'proc-1' || c.outputOf === 'proc-1')).toBe(true);
    });
});

// ─── Proposals with reciprocal intents ────────────────────────────────────────

describe('PlanStore.publishOffer with reciprocal intent', () => {

    test('creates both primary and reciprocal intents in the proposal', () => {
        const { planStore } = makeStores();

        const result = planStore.publishOffer({
            provider: 'alice',
            action: 'produce',
            resourceConformsTo: 'spec:apples',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            reciprocal: {
                action: 'transfer',
                resourceConformsTo: 'spec:money',
                resourceQuantity: { hasNumericalValue: 20, hasUnit: 'EUR' },
            },
        });

        expect(result.primaryIntent.provider).toBe('alice');
        expect(result.primaryIntent.action).toBe('produce');
        expect(result.reciprocalIntent).toBeDefined();
        expect(result.reciprocalIntent!.action).toBe('transfer');
        expect(result.reciprocalIntent!.receiver).toBe('alice'); // alice expects payment in return
        expect(result.proposal.publishes).toContain(result.primaryIntent.id);
        expect(result.proposal.reciprocal).toContain(result.reciprocalIntent!.id);
    });
});

// ─── offers() and requests() filtering ───────────────────────────────────────

describe('PlanStore offers and requests filtering', () => {

    test('offers() returns provider-only intents, requests() receiver-only intents', () => {
        const { planStore } = makeStores();

        // Offer: alice will produce apples
        planStore.addIntent({ action: 'produce', provider: 'alice', finished: false });
        // Request: bob wants to consume wheat
        planStore.addIntent({ action: 'consume', receiver: 'bob', finished: false });
        // Bilateral (both provider+receiver): must use addCommitment(), not addIntent()
        // Commitments appear in neither offers() nor requests() — same intent as before.
        planStore.addCommitment({ action: 'transfer', provider: 'carol', receiver: 'dave', finished: false });
        // Finished offer: should not appear
        planStore.addIntent({ action: 'produce', provider: 'eve', finished: true });

        const offers    = planStore.offers();
        const requests  = planStore.requests();

        expect(offers.length).toBe(1);
        expect(offers[0].provider).toBe('alice');

        expect(requests.length).toBe(1);
        expect(requests[0].receiver).toBe('bob');
    });
});

// ─── AgreementBundle ──────────────────────────────────────────────────────────

describe('PlanStore: AgreementBundle', () => {

    test('agreementsInBundle returns agreements belonging to the bundle', () => {
        const { planStore } = makeStores();

        const a1 = planStore.addAgreement({ name: 'Wheat deal' });
        const a2 = planStore.addAgreement({ name: 'Labour deal' });
        const a3 = planStore.addAgreement({ name: 'Separate deal' });  // not in bundle

        const bundle = planStore.addAgreementBundle({
            name: 'Harvest Package',
            bundles: [a1.id, a2.id],
        });

        const bundleAgreements = planStore.agreementsInBundle(bundle.id);

        expect(bundleAgreements.length).toBe(2);
        expect(bundleAgreements.map(a => a.id)).toContain(a1.id);
        expect(bundleAgreements.map(a => a.id)).toContain(a2.id);
        expect(bundleAgreements.map(a => a.id)).not.toContain(a3.id);
    });
});

// ─── ProposalList ─────────────────────────────────────────────────────────────

describe('PlanStore: ProposalList', () => {

    test('proposalsInList returns proposals in the list', () => {
        const { planStore } = makeStores();

        const p1 = planStore.addProposal({ purpose: 'offer', publishes: [] });
        const p2 = planStore.addProposal({ purpose: 'request', publishes: [] });
        const p3 = planStore.addProposal({ purpose: 'offer', publishes: [] }); // not in list

        const list = planStore.addProposalList({
            name: 'Spring Market',
            lists: [p1.id, p2.id],
        });

        const inList = planStore.proposalsInList(list.id);

        expect(inList.length).toBe(2);
        expect(inList.map(p => p.id)).toContain(p1.id);
        expect(inList.map(p => p.id)).not.toContain(p3.id);
    });
});

// ─── Scenario / ScenarioDefinition ───────────────────────────────────────────

describe('PlanStore: Scenarios', () => {

    test('scenariosForDefinition and scenarioRefinements work correctly', () => {
        const { planStore } = makeStores();

        const def = planStore.addScenarioDefinition({ name: 'Harvest Forecast' });

        const scenarioA = planStore.addScenario({
            name: 'Optimistic harvest',
            definedAs: def.id,
        });
        const scenarioB = planStore.addScenario({
            name: 'Conservative harvest',
            definedAs: def.id,
        });
        const subScenario = planStore.addScenario({
            name: 'Conservative harvest - low rainfall',
            refinementOf: scenarioB.id,
        });

        expect(planStore.scenariosForDefinition(def.id).length).toBe(2);
        expect(planStore.scenarioRefinements(scenarioB.id)).toContainEqual(expect.objectContaining({ id: subScenario.id }));
        expect(planStore.scenarioRefinements(scenarioA.id).length).toBe(0);
    });

    test('plansForScenario returns plans that refine a given scenario', () => {
        const { planStore } = makeStores();

        const scenario = planStore.addScenario({ name: 'Q2 Plan' });
        const plan1    = planStore.addPlan({ name: 'Plant wheat', refinementOf: scenario.id });
        const plan2    = planStore.addPlan({ name: 'Plant rye', refinementOf: scenario.id });
        const plan3    = planStore.addPlan({ name: 'Unrelated plan' });

        const plans = planStore.plansForScenario(scenario.id);
        expect(plans.length).toBe(2);
        expect(plans.map(p => p.id)).toContain(plan1.id);
        expect(plans.map(p => p.id)).toContain(plan2.id);
        expect(plans.map(p => p.id)).not.toContain(plan3.id);
    });
});
