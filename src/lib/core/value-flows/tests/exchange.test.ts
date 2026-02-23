/**
 * Exchange Tests — covers all VF exchange gaps:
 *   1. Multilateral recordExchange() (3+ events)
 *   2. Eligibility validation (custody-only actions, provider === receiver)
 *   3. acceptProposal() lifecycle
 *   4. instantiateRecipe() multilateral heuristic fix
 *   5. reciprocalEvents() multilateral
 *   6. Claims lifecycle (CRUD, settles tracking, settlement queries)
 *   7. proposedTo enforcement
 *   8. Proposal temporal validation (hasBeginning / hasEnd)
 *   9. availableQuantity decrement + minimumQuantity guard
 *  10. unitBased proposal scaling
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';
import type { ObserverEvent } from '../observation/observer';
import { PlanStore } from '../planning/planning';
import { RecipeStore } from '../knowledge/recipes';
import { ProcessRegistry } from '../process-registry';
import { VfQueries } from '../query';
import type { Agreement, EconomicEvent } from '../schemas';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeAgreement(id: string): Agreement {
    return { id, name: `Agreement ${id}`, created: new Date().toISOString() };
}

function captureErrors(observer: Observer): string[] {
    const errors: string[] = [];
    observer.subscribe((e: ObserverEvent) => {
        if (e.type === 'error') errors.push(e.error);
    });
    return errors;
}

function makeStore() {
    let counter = 0;
    const registry = new ProcessRegistry(() => `id-${counter++}`);
    const store = new PlanStore(registry, () => `id-${counter++}`);
    return store;
}

function makeOfferWithReciprocal(store: PlanStore) {
    return store.publishOffer({
        provider: 'alice',
        action: 'transfer',
        resourceConformsTo: 'spec:apple',
        resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
        reciprocal: {
            action: 'transfer',
            resourceConformsTo: 'spec:usd',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'USD' },
        },
    });
}

// ─── recordExchange() — bilateral ─────────────────────────────────────────────

describe('recordExchange() — bilateral', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
        observer.seedResource({
            id: 'res-apple',
            conformsTo: 'spec:apple',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });
        observer.seedResource({
            id: 'res-money',
            conformsTo: 'spec:usd',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
            onhandQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
        });
    });

    test('records both events; each gets realizationOf = agreement.id', () => {
        const agreement = makeAgreement('agr-1');
        const e1: EconomicEvent = { id: 'ev-1', action: 'transfer', provider: 'alice',
            receiver: 'bob', resourceInventoriedAs: 'res-apple',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } };
        const e2: EconomicEvent = { id: 'ev-2', action: 'transfer', provider: 'bob',
            receiver: 'alice', resourceInventoriedAs: 'res-money',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'USD' } };

        observer.recordExchange({ agreement, events: [e1, e2] });

        expect(observer.getEvent('ev-1')?.realizationOf).toBe('agr-1');
        expect(observer.getEvent('ev-2')?.realizationOf).toBe('agr-1');
    });

    test('returns array of resource arrays, one per event', () => {
        const agreement = makeAgreement('agr-2');
        const result = observer.recordExchange({
            agreement,
            events: [
                { id: 'ev-3', action: 'transfer', provider: 'alice', receiver: 'bob',
                  resourceInventoriedAs: 'res-apple',
                  resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' } },
                { id: 'ev-4', action: 'transfer', provider: 'bob', receiver: 'alice',
                  resourceInventoriedAs: 'res-money',
                  resourceQuantity: { hasNumericalValue: 12, hasUnit: 'USD' } },
            ],
        });

        expect(result).toHaveLength(2);
        result.forEach(arr => expect(Array.isArray(arr)).toBe(true));
    });
});

// ─── recordExchange() — multilateral (3 events) ───────────────────────────────

describe('recordExchange() — multilateral (3 events)', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
        for (const [id, spec] of [['r-apples','spec:apple'],['r-bread','spec:bread'],['r-labour','spec:labour']] as const) {
            observer.seedResource({
                id, conformsTo: spec,
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
                onhandQuantity:     { hasNumericalValue: 10, hasUnit: 'each' },
            });
        }
    });

    test('all 3 events get realizationOf = agreement.id', () => {
        const agreement = makeAgreement('agr-multi');
        const events: EconomicEvent[] = [
            { id: 'e-a', action: 'transfer', provider: 'A', receiver: 'B',
              resourceInventoriedAs: 'r-apples', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
            { id: 'e-b', action: 'transfer', provider: 'B', receiver: 'C',
              resourceInventoriedAs: 'r-bread',  resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
            { id: 'e-c', action: 'transfer', provider: 'C', receiver: 'A',
              resourceInventoriedAs: 'r-labour', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
        ];
        observer.recordExchange({ agreement, events });
        for (const { id } of events) {
            expect(observer.getEvent(id)?.realizationOf).toBe('agr-multi');
        }
    });

    test('all three resource effects are applied', () => {
        const agreement = makeAgreement('agr-multi-2');
        observer.recordExchange({
            agreement,
            events: [
                { id: 'e-a2', action: 'transferAllRights', provider: 'A', receiver: 'B',
                  resourceInventoriedAs: 'r-apples', resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' } },
                { id: 'e-b2', action: 'transferAllRights', provider: 'B', receiver: 'C',
                  resourceInventoriedAs: 'r-bread',  resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' } },
                { id: 'e-c2', action: 'transferAllRights', provider: 'C', receiver: 'A',
                  resourceInventoriedAs: 'r-labour', resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' } },
            ],
        });
        expect(observer.getResource('r-apples')!.accountingQuantity!.hasNumericalValue).toBe(8);
        expect(observer.getResource('r-bread')!.accountingQuantity!.hasNumericalValue).toBe(7);
        expect(observer.getResource('r-labour')!.accountingQuantity!.hasNumericalValue).toBe(6);
    });

    test('returns 3 inner arrays', () => {
        const result = observer.recordExchange({
            agreement: makeAgreement('agr-multi-3'),
            events: [
                { id: 'x1', action: 'transfer', provider: 'A', receiver: 'B',
                  resourceInventoriedAs: 'r-apples', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'x2', action: 'transfer', provider: 'B', receiver: 'C',
                  resourceInventoriedAs: 'r-bread',  resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'x3', action: 'transfer', provider: 'C', receiver: 'A',
                  resourceInventoriedAs: 'r-labour', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
            ],
        });
        expect(result).toHaveLength(3);
        result.forEach(arr => expect(Array.isArray(arr)).toBe(true));
    });
});

// ─── recordExchange() — eligibility validation ────────────────────────────────

describe('recordExchange() — eligibility validation', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
        observer.seedResource({
            id: 'res-pkg', conformsTo: 'spec:pkg',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            onhandQuantity:     { hasNumericalValue: 1, hasUnit: 'each' },
        });
    });

    test('custody-only action (pickup) emits error, does NOT throw, still records', () => {
        const errors = captureErrors(observer);
        expect(() => observer.recordExchange({
            agreement: makeAgreement('agr-e1'),
            events: [{ id: 'ev-pickup', action: 'pickup', provider: 'courier',
                       receiver: 'warehouse', resourceInventoriedAs: 'res-pkg',
                       resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } }],
        })).not.toThrow();
        expect(observer.getEvent('ev-pickup')).toBeDefined();
        expect(errors.some(e => e.includes('custody-only'))).toBe(true);
    });

    test('provider === receiver emits error, does NOT throw, still records', () => {
        const errors = captureErrors(observer);
        expect(() => observer.recordExchange({
            agreement: makeAgreement('agr-e2'),
            events: [{ id: 'ev-same', action: 'transfer', provider: 'alice',
                       receiver: 'alice', resourceInventoriedAs: 'res-pkg',
                       resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } }],
        })).not.toThrow();
        expect(observer.getEvent('ev-same')).toBeDefined();
        expect(errors.some(e => e.includes('provider !== receiver'))).toBe(true);
    });

    test('eligible action (transfer) produces zero error events', () => {
        observer.seedResource({
            id: 'res-usd', conformsTo: 'spec:usd',
            accountingQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
            onhandQuantity:     { hasNumericalValue: 50, hasUnit: 'USD' },
        });
        const errors = captureErrors(observer);
        observer.recordExchange({
            agreement: makeAgreement('agr-e3'),
            events: [
                { id: 'ev-ok-1', action: 'transfer', provider: 'alice', receiver: 'bob',
                  resourceInventoriedAs: 'res-pkg',  resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'ev-ok-2', action: 'transfer', provider: 'bob', receiver: 'alice',
                  resourceInventoriedAs: 'res-usd',  resourceQuantity: { hasNumericalValue: 10, hasUnit: 'USD' } },
            ],
        });
        expect(errors).toHaveLength(0);
    });
});

// ─── acceptProposal() — core lifecycle ────────────────────────────────────────

describe('acceptProposal() — core lifecycle', () => {
    let store: PlanStore;
    beforeEach(() => { store = makeStore(); });

    test('primary intent → stipulates, reciprocal intent → stipulatesReciprocal', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        const { agreement, commitments } = store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
        );
        expect(agreement.stipulates).toHaveLength(1);
        expect(agreement.stipulatesReciprocal).toHaveLength(1);
        expect(commitments).toHaveLength(2);
    });

    test('clauseOf is set on all commitments', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        const { agreement, commitments } = store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
        );
        for (const c of commitments) expect(c.clauseOf).toBe(agreement.id);
    });

    test('non-recurring Intents are marked finished after acceptance', () => {
        const { proposal, primaryIntent, reciprocalIntent } = makeOfferWithReciprocal(store);
        store.acceptProposal(proposal.id, { provider: 'bob', receiver: 'alice' });
        expect(store.getIntent(primaryIntent.id)?.finished).toBe(true);
        if (reciprocalIntent) expect(store.getIntent(reciprocalIntent.id)?.finished).toBe(true);
    });

    test('due date propagates via options.due', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        const due = '2026-03-01T00:00:00.000Z';
        const { commitments } = store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' }, { due },
        );
        for (const c of commitments) expect(c.due).toBe(due);
    });

    test('throws when proposal not found', () => {
        expect(() => store.acceptProposal('nonexistent', {})).toThrow(/not found/);
    });
});

// ─── acceptProposal() — proposedTo enforcement ────────────────────────────────

describe('acceptProposal() — proposedTo enforcement', () => {
    let store: PlanStore;
    beforeEach(() => { store = makeStore(); });

    test('throws when proposedTo is set and acceptingAgentId is missing', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.proposedTo = ['bob'];

        expect(() => store.acceptProposal(
            proposal.id, { provider: 'carol', receiver: 'alice' },
        )).toThrow(/restricted to/);
    });

    test('throws when acceptingAgentId is not in proposedTo', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.proposedTo = ['bob'];

        expect(() => store.acceptProposal(
            proposal.id, { provider: 'carol', receiver: 'alice' },
            { acceptingAgentId: 'carol' },
        )).toThrow(/restricted to/);
    });

    test('succeeds when acceptingAgentId is in proposedTo', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.proposedTo = ['bob'];

        const { commitments } = store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
            { acceptingAgentId: 'bob' },
        );
        expect(commitments.length).toBeGreaterThan(0);
    });

    test('no restriction when proposedTo is empty/unset', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        // proposedTo not set — anyone can accept
        const { commitments } = store.acceptProposal(
            proposal.id, { provider: 'carol', receiver: 'alice' },
        );
        expect(commitments.length).toBeGreaterThan(0);
    });
});

// ─── acceptProposal() — temporal validation ───────────────────────────────────

describe('acceptProposal() — temporal validation', () => {
    let store: PlanStore;
    beforeEach(() => { store = makeStore(); });

    test('throws when proposal is expired (hasEnd in the past)', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.hasEnd = '2020-01-01T00:00:00.000Z';

        expect(() => store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
        )).toThrow(/expired/);
    });

    test('throws when proposal has not yet opened (hasBeginning in the future)', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.hasBeginning = '2099-01-01T00:00:00.000Z';

        expect(() => store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
        )).toThrow(/not yet open/);
    });

    test('succeeds when dates are current', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        store.getProposal(proposal.id)!.hasBeginning = '2020-01-01T00:00:00.000Z';
        store.getProposal(proposal.id)!.hasEnd       = '2099-01-01T00:00:00.000Z';

        const { commitments } = store.acceptProposal(
            proposal.id, { provider: 'bob', receiver: 'alice' },
        );
        expect(commitments.length).toBeGreaterThan(0);
    });
});

// ─── acceptProposal() — availableQuantity & minimumQuantity ───────────────────

describe('acceptProposal() — availableQuantity & minimumQuantity', () => {
    let store: PlanStore;
    beforeEach(() => { store = makeStore(); });

    test('non-recurring intent with availableQuantity stays open until depleted', () => {
        const intent = store.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceConformsTo: 'spec:apple',
            resourceQuantity:    { hasNumericalValue: 3, hasUnit: 'kg' },
            availableQuantity:   { hasNumericalValue: 9, hasUnit: 'kg' },
            finished: false,
        });
        const proposal = store.addProposal({ publishes: [intent.id] });

        // First acceptance: 3 kg committed, 6 kg remain → NOT finished
        store.acceptProposal(proposal.id, { provider: 'alice', receiver: 'bob' });
        expect(store.getIntent(intent.id)!.finished).toBe(false);
        expect(store.getIntent(intent.id)!.availableQuantity!.hasNumericalValue).toBe(6);

        // Second acceptance: 3 kg committed, 3 kg remain
        store.acceptProposal(proposal.id, { provider: 'alice', receiver: 'carol' });
        expect(store.getIntent(intent.id)!.finished).toBe(false);

        // Third acceptance: 0 remaining → finished
        store.acceptProposal(proposal.id, { provider: 'alice', receiver: 'dave' });
        expect(store.getIntent(intent.id)!.finished).toBe(true);
    });

    test('throws when committed quantity exceeds availableQuantity', () => {
        const intent = store.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceConformsTo: 'spec:apple',
            resourceQuantity:  { hasNumericalValue: 10, hasUnit: 'kg' },
            availableQuantity: { hasNumericalValue: 3,  hasUnit: 'kg' },
            finished: false,
        });
        const proposal = store.addProposal({ publishes: [intent.id] });

        expect(() =>
            store.acceptProposal(proposal.id, { provider: 'alice', receiver: 'bob' })
        ).toThrow(/exceeds available/);
    });

    test('throws when committed quantity is below minimumQuantity', () => {
        const intent = store.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceConformsTo: 'spec:apple',
            resourceQuantity:   { hasNumericalValue: 1, hasUnit: 'kg' },
            minimumQuantity:    { hasNumericalValue: 5, hasUnit: 'kg' },
            finished: false,
        });
        const proposal = store.addProposal({ publishes: [intent.id] });

        expect(() =>
            store.acceptProposal(proposal.id, { provider: 'alice', receiver: 'bob' })
        ).toThrow(/below minimum/);
    });
});

// ─── acceptProposal() — unitBased scaling ────────────────────────────────────

describe('acceptProposal() — unitBased scaling', () => {
    let store: PlanStore;
    beforeEach(() => { store = makeStore(); });

    test('unitQuantity scales all commitment quantities', () => {
        const primaryIntent = store.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceConformsTo: 'spec:consulting',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'hours' },
            finished: false,
        });
        const recipIntent = store.addIntent({
            action: 'transfer',
            receiver: 'alice',
            resourceConformsTo: 'spec:usd',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
            finished: false,
        });
        const proposal = store.addProposal({
            publishes: [primaryIntent.id],
            reciprocal: [recipIntent.id],
            unitBased: true,
        });

        const { commitments } = store.acceptProposal(
            proposal.id,
            { provider: 'alice', receiver: 'bob' },
            { unitQuantity: 3 },
        );

        const primary   = commitments.find(c => c.resourceConformsTo === 'spec:consulting')!;
        const reciprocal = commitments.find(c => c.resourceConformsTo === 'spec:usd')!;
        expect(primary.resourceQuantity!.hasNumericalValue).toBe(3);   // 1 × 3
        expect(reciprocal.resourceQuantity!.hasNumericalValue).toBe(300); // 100 × 3
    });

    test('non-unitBased proposal ignores unitQuantity', () => {
        const { proposal } = makeOfferWithReciprocal(store);
        // proposal.unitBased is undefined/falsy

        const { commitments } = store.acceptProposal(
            proposal.id,
            { provider: 'bob', receiver: 'alice' },
            { unitQuantity: 5 },
        );

        // quantities should NOT be scaled
        const primary = commitments[0];
        expect(primary.resourceQuantity!.hasNumericalValue).toBe(5); // original 5 kg, not ×5
    });
});

// ─── Claims lifecycle ─────────────────────────────────────────────────────────

describe('Claims lifecycle', () => {
    let observer: Observer;
    let store: PlanStore;

    beforeEach(() => {
        let counter = 0;
        const registry = new ProcessRegistry(() => `id-${counter++}`);
        observer = new Observer(registry);
        store = new PlanStore(registry, () => `id-${counter++}`);
        observer.seedResource({
            id: 'res-service', conformsTo: 'spec:service',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'hours' },
            onhandQuantity:     { hasNumericalValue: 10, hasUnit: 'hours' },
        });
        observer.seedResource({
            id: 'res-pay', conformsTo: 'spec:usd',
            accountingQuantity: { hasNumericalValue: 1000, hasUnit: 'USD' },
            onhandQuantity:     { hasNumericalValue: 1000, hasUnit: 'USD' },
        });
    });

    test('addClaim stores and retrieves a claim', () => {
        const triggerEvent: EconomicEvent = {
            id: 'ev-trigger', action: 'work', provider: 'alice', receiver: 'bob',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        };
        observer.record(triggerEvent);

        const claim = store.addClaim({
            action: 'transfer',
            provider: 'bob',
            receiver: 'alice',
            triggeredBy: 'ev-trigger',
            resourceQuantity: { hasNumericalValue: 800, hasUnit: 'USD' },
            finished: false,
        });

        expect(store.getClaim(claim.id)).toBeDefined();
        expect(store.getClaim(claim.id)!.triggeredBy).toBe('ev-trigger');
        expect(store.allClaims()).toHaveLength(1);
    });

    test('settles tracking: claim_settled emitted, state updated, finished when fully settled', () => {
        const triggerEvent: EconomicEvent = {
            id: 'ev-work', action: 'work', provider: 'alice', receiver: 'bob',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        };
        observer.record(triggerEvent);

        const claim = store.addClaim({
            action: 'transfer',
            provider: 'bob',
            receiver: 'alice',
            triggeredBy: 'ev-work',
            resourceQuantity: { hasNumericalValue: 800, hasUnit: 'USD' },
            finished: false,
        });
        observer.registerClaim(claim);

        const emitted: string[] = [];
        observer.subscribe((e: ObserverEvent) => {
            if (e.type === 'claim_settled') emitted.push(e.claimId);
        });

        // Partial settlement
        observer.record({
            id: 'ev-pay-1', action: 'transfer', provider: 'bob', receiver: 'alice',
            resourceInventoriedAs: 'res-pay',
            resourceQuantity: { hasNumericalValue: 400, hasUnit: 'USD' },
            settles: claim.id,
        });

        expect(emitted).toContain(claim.id);
        const state1 = observer.getClaimState(claim.id)!;
        expect(state1.totalSettled.hasNumericalValue).toBe(400);
        expect(state1.finished).toBe(false);

        // Full settlement
        observer.record({
            id: 'ev-pay-2', action: 'transfer', provider: 'bob', receiver: 'alice',
            resourceInventoriedAs: 'res-pay',
            resourceQuantity: { hasNumericalValue: 400, hasUnit: 'USD' },
            settles: claim.id,
        });

        const state2 = observer.getClaimState(claim.id)!;
        expect(state2.totalSettled.hasNumericalValue).toBe(800);
        expect(state2.finished).toBe(true);
        expect(state2.settlingEvents).toEqual(['ev-pay-1', 'ev-pay-2']);
    });

    test('settles event can also fulfill a commitment (independent)', () => {
        const claim = store.addClaim({
            action: 'transfer', provider: 'bob', receiver: 'alice',
            triggeredBy: 'some-event',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
            finished: false,
        });
        observer.registerClaim(claim);

        const commitment = store.addCommitment({
            action: 'transfer', provider: 'bob', receiver: 'alice',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
            finished: false,
        });
        observer.registerCommitment(commitment);

        // Same event both fulfills a commitment AND settles a claim
        observer.record({
            id: 'ev-dual', action: 'transfer', provider: 'bob', receiver: 'alice',
            resourceInventoriedAs: 'res-pay',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
            fulfills: commitment.id,
            settles: claim.id,
        });

        expect(observer.getFulfillment(commitment.id)!.finished).toBe(true);
        expect(observer.getClaimState(claim.id)!.finished).toBe(true);
    });
});

// ─── Claim inverse queries ─────────────────────────────────────────────────────

describe('Claim inverse queries (VfQueries)', () => {
    let observer: Observer;
    let store: PlanStore;
    let queries: VfQueries;

    beforeEach(() => {
        let counter = 0;
        const registry = new ProcessRegistry(() => `id-${counter++}`);
        observer = new Observer(registry);
        store = new PlanStore(registry, () => `id-${counter++}`);
        const recipeStore = new RecipeStore(() => `id-${counter++}`);
        queries = new VfQueries(observer, store, recipeStore, registry);

        observer.seedResource({
            id: 'res-p', conformsTo: 'spec:usd',
            accountingQuantity: { hasNumericalValue: 500, hasUnit: 'USD' },
            onhandQuantity:     { hasNumericalValue: 500, hasUnit: 'USD' },
        });
    });

    test('claimsTriggeredBy returns claims for a given event', () => {
        observer.record({ id: 'ev-t1', action: 'work', provider: 'alice', receiver: 'bob',
                          effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' } });
        store.addClaim({ action: 'transfer', provider: 'bob', receiver: 'alice',
                         triggeredBy: 'ev-t1',
                         resourceQuantity: { hasNumericalValue: 200, hasUnit: 'USD' },
                         finished: false });

        const found = queries.claimsTriggeredBy('ev-t1');
        expect(found).toHaveLength(1);
        expect(found[0].triggeredBy).toBe('ev-t1');
    });

    test('claimsAsProvider and claimsAsReceiver filter correctly', () => {
        store.addClaim({ action: 'transfer', provider: 'bob', receiver: 'alice',
                         triggeredBy: 'x', resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
                         finished: false });
        store.addClaim({ action: 'transfer', provider: 'carol', receiver: 'alice',
                         triggeredBy: 'y', resourceQuantity: { hasNumericalValue: 50,  hasUnit: 'USD' },
                         finished: false });

        expect(queries.claimsAsProvider('bob')).toHaveLength(1);
        expect(queries.claimsAsProvider('carol')).toHaveLength(1);
        expect(queries.claimsAsReceiver('alice')).toHaveLength(2);
        expect(queries.claimsAsReceiver('bob')).toHaveLength(0);
    });

    test('settlementEvents returns events that settle a claim', () => {
        const claim = store.addClaim({ action: 'transfer', provider: 'bob', receiver: 'alice',
                                       triggeredBy: 'ev-orig',
                                       resourceQuantity: { hasNumericalValue: 200, hasUnit: 'USD' },
                                       finished: false });
        observer.registerClaim(claim);

        observer.record({ id: 'ev-s1', action: 'transfer', provider: 'bob', receiver: 'alice',
                          resourceInventoriedAs: 'res-p',
                          resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
                          settles: claim.id });
        observer.record({ id: 'ev-s2', action: 'transfer', provider: 'bob', receiver: 'alice',
                          resourceInventoriedAs: 'res-p',
                          resourceQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
                          settles: claim.id });

        const settlements = queries.settlementEvents(claim.id);
        expect(settlements).toHaveLength(2);
        expect(settlements.map(e => e.id).sort()).toEqual(['ev-s1', 'ev-s2']);
    });

    test('claimState returns accurate settlement totals', () => {
        const claim = store.addClaim({ action: 'transfer', provider: 'bob', receiver: 'alice',
                                       triggeredBy: 'ev-orig',
                                       resourceQuantity: { hasNumericalValue: 200, hasUnit: 'USD' },
                                       finished: false });
        observer.registerClaim(claim);
        observer.record({ id: 'ev-partial', action: 'transfer', provider: 'bob', receiver: 'alice',
                          resourceInventoriedAs: 'res-p',
                          resourceQuantity: { hasNumericalValue: 150, hasUnit: 'USD' },
                          settles: claim.id });

        const state = queries.claimState(claim.id)!;
        expect(state.totalClaimed.hasNumericalValue).toBe(200);
        expect(state.totalSettled.hasNumericalValue).toBe(150);
        expect(state.finished).toBe(false);
    });
});

// ─── instantiateRecipe() — multilateral heuristic ─────────────────────────────

describe('instantiateRecipe() — multilateral heuristic', () => {
    let store: PlanStore;
    let recipes: RecipeStore;

    beforeEach(() => {
        let counter = 0;
        const registry = new ProcessRegistry(() => `id-${counter++}`);
        store = new PlanStore(registry, () => `id-${counter++}`);
        recipes = new RecipeStore(() => `rid-${counter++}`);
    });

    function buildExchangeRecipe(flows: Array<{ isPrimary?: boolean }>) {
        const rex = recipes.addRecipeExchange({ name: 'Test Exchange' });
        for (const f of flows) {
            recipes.addRecipeFlow({
                action: 'transfer',
                recipeClauseOf: rex.id,
                resourceConformsTo: `spec:r-${Math.random().toString(36).slice(2)}`,
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                isPrimary: f.isPrimary,
            });
        }
        const rp = recipes.addRecipeProcess({ name: 'Step' });
        recipes.addRecipeFlow({
            action: 'produce', recipeOutputOf: rp.id,
            resourceConformsTo: 'spec:output',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
        });
        return recipes.addRecipe({
            name: 'Exchange Recipe', primaryOutput: 'spec:output',
            recipeProcesses: [rp.id], recipeExchanges: [rex.id],
        });
    }

    test('3 flows with no isPrimary: all go to stipulates, stipulatesReciprocal is undefined', () => {
        const recipe = buildExchangeRecipe([{}, {}, {}]);
        const { agreements } = store.instantiateRecipe(recipes, recipe.id, 1, new Date());
        expect(agreements).toHaveLength(1);
        expect(agreements[0].stipulates).toHaveLength(3);
        expect(agreements[0].stipulatesReciprocal).toBeUndefined();
    });

    test('2 flows with no isPrimary: bilateral heuristic preserved (first=stipulates, second=reciprocal)', () => {
        const recipe = buildExchangeRecipe([{}, {}]);
        const { agreements } = store.instantiateRecipe(recipes, recipe.id, 1, new Date());
        expect(agreements).toHaveLength(1);
        expect(agreements[0].stipulates).toHaveLength(1);
        expect(agreements[0].stipulatesReciprocal).toHaveLength(1);
    });

    test('3 flows with explicit tags: respects isPrimary flags', () => {
        const recipe = buildExchangeRecipe([
            { isPrimary: true }, { isPrimary: false }, { isPrimary: true },
        ]);
        const { agreements } = store.instantiateRecipe(recipes, recipe.id, 1, new Date());
        expect(agreements).toHaveLength(1);
        expect(agreements[0].stipulates).toHaveLength(2);
        expect(agreements[0].stipulatesReciprocal).toHaveLength(1);
    });
});

// ─── reciprocalEvents() — multilateral ───────────────────────────────────────

describe('reciprocalEvents() — multilateral', () => {
    let observer: Observer;
    let queries: VfQueries;

    beforeEach(() => {
        let counter = 0;
        const registry = new ProcessRegistry(() => `id-${counter++}`);
        observer = new Observer(registry);
        const planStore = new PlanStore(registry, () => `id-${counter++}`);
        const recipeStore = new RecipeStore(() => `id-${counter++}`);
        queries = new VfQueries(observer, planStore, recipeStore, registry);

        for (const id of ['r1', 'r2', 'r3']) {
            observer.seedResource({
                id, conformsTo: `spec:${id}`,
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
                onhandQuantity:     { hasNumericalValue: 10, hasUnit: 'each' },
            });
        }
    });

    test('bilateral: reciprocalEvents(e1) = [e2], reciprocalEvents(e2) = [e1]', () => {
        observer.recordExchange({
            agreement: makeAgreement('agr-bil'),
            events: [
                { id: 'e1', action: 'transfer', provider: 'A', receiver: 'B',
                  resourceInventoriedAs: 'r1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'e2', action: 'transfer', provider: 'B', receiver: 'A',
                  resourceInventoriedAs: 'r2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
            ],
        });
        expect(queries.reciprocalEvents('e1').map(e => e.id)).toEqual(['e2']);
        expect(queries.reciprocalEvents('e2').map(e => e.id)).toEqual(['e1']);
    });

    test('3-event cycle: reciprocalEvents(e1) returns [e2, e3]', () => {
        observer.recordExchange({
            agreement: makeAgreement('agr-tri'),
            events: [
                { id: 'e1', action: 'transfer', provider: 'A', receiver: 'B',
                  resourceInventoriedAs: 'r1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'e2', action: 'transfer', provider: 'B', receiver: 'C',
                  resourceInventoriedAs: 'r2', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
                { id: 'e3', action: 'transfer', provider: 'C', receiver: 'A',
                  resourceInventoriedAs: 'r3', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' } },
            ],
        });
        const reciprocals = queries.reciprocalEvents('e1').map(e => e.id).sort();
        expect(reciprocals).toEqual(['e2', 'e3']);
    });
});
