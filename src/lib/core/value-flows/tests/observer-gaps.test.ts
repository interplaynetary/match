/**
 * Observer Gap Tests
 *
 * Covers 14 behavioral + missing-feature gaps identified in the VF gap audit.
 * Each describe block corresponds to one gap code.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';
import type { ObserverEvent } from '../observation/observer';

// =============================================================================
// HELPERS
// =============================================================================

function collectEvents(observer: Observer): ObserverEvent[] {
    const events: ObserverEvent[] = [];
    observer.subscribe(e => { events.push(e); });
    return events;
}

// =============================================================================
// I3 — satisfyingCommitments populated when registerCommitment called with satisfies
// =============================================================================

describe('I3 — satisfyingCommitments populated', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('registerCommitment with satisfies links to intent', () => {
        observer.registerIntent({
            id: 'i1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            finished: false,
        });
        observer.registerCommitment({
            id: 'c1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 60, hasUnit: 'kg' },
            satisfies: 'i1',
            finished: false,
        });

        const sat = observer.getSatisfaction('i1');
        expect(sat?.satisfyingCommitments).toEqual(['c1']);
    });

    test('multiple commitments for same intent all appear', () => {
        observer.registerIntent({
            id: 'i1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            finished: false,
        });
        observer.registerCommitment({
            id: 'c1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
            satisfies: 'i1',
            finished: false,
        });
        observer.registerCommitment({
            id: 'c2',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 60, hasUnit: 'kg' },
            satisfies: 'i1',
            finished: false,
        });

        const sat = observer.getSatisfaction('i1');
        expect(sat?.satisfyingCommitments).toContain('c1');
        expect(sat?.satisfyingCommitments).toContain('c2');
        expect(sat?.satisfyingCommitments).toHaveLength(2);
    });

    test('commitment without satisfies does not affect any intent', () => {
        observer.registerIntent({
            id: 'i1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            finished: false,
        });
        observer.registerCommitment({
            id: 'c1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            finished: false,
            // no satisfies
        });

        const sat = observer.getSatisfaction('i1');
        expect(sat?.satisfyingCommitments).toEqual([]);
    });
});

// =============================================================================
// I1 — Over-fulfillment detection
// =============================================================================

describe('I1 — over-fulfillment detection', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('over-fulfillment sets overFulfilled flag and emits event', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 12, hasUnit: 'unit' },
            fulfills: 'c1',
        });

        const state = observer.getFulfillment('c1');
        expect(state?.overFulfilled).toBe(true);
        expect(state?.totalFulfilled.hasNumericalValue).toBe(12);

        const overEvent = emitted.find(e => e.type === 'over_fulfilled');
        expect(overEvent).toBeDefined();
        if (overEvent?.type === 'over_fulfilled') {
            expect(overEvent.commitmentId).toBe('c1');
            expect(overEvent.overage).toBe(2);
        }
    });

    test('exact fulfillment does not set overFulfilled', () => {
        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            fulfills: 'c1',
        });

        const state = observer.getFulfillment('c1');
        expect(state?.overFulfilled).toBe(false);
        expect(state?.finished).toBe(true);
    });
});

// =============================================================================
// H1 — Correction of non-existent event emits error
// =============================================================================

describe('H1 — correction of non-existent event emits error', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('emits error when correction target not found', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        observer.record({
            id: 'e2',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
            corrects: 'nonexistent-event-id',
        });

        const errorEvent = emitted.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        if (errorEvent?.type === 'error') {
            expect(errorEvent.error).toMatch(/correction target.*not found/i);
            expect(errorEvent.eventId).toBe('e2');
        }
    });
});

// =============================================================================
// H3 — activeEventsForResource excludes corrected events
// =============================================================================

describe('H3 — activeEventsForResource excludes corrected events', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('eventsForResource includes both original and correction', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:x',
            accountingQuantity: { hasNumericalValue: 0, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'r1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e2',
            action: 'produce',
            resourceInventoriedAs: 'r1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 8, hasUnit: 'ea' },
            corrects: 'e1',
        });

        expect(observer.eventsForResource('r1')).toHaveLength(2);
    });

    test('activeEventsForResource excludes the corrected original', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:x',
            accountingQuantity: { hasNumericalValue: 0, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'r1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e2',
            action: 'produce',
            resourceInventoriedAs: 'r1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 8, hasUnit: 'ea' },
            corrects: 'e1',
        });

        const active = observer.activeEventsForResource('r1');
        expect(active).toHaveLength(1);
        expect(active[0].id).toBe('e2');
    });
});

// =============================================================================
// J3 — Auto-created resource without conformsTo emits warning
// =============================================================================

describe('J3 — auto-created resource without conformsTo emits warning', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('emits error when event has no resourceConformsTo', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'new-res',
            // no resourceConformsTo
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
        });

        const errorEvent = emitted.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        if (errorEvent?.type === 'error') {
            expect(errorEvent.error).toMatch(/no conformsTo/i);
        }
    });

    test('does not warn when resourceConformsTo is provided', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'new-res',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
        });

        const errorEvent = emitted.find(e => e.type === 'error');
        expect(errorEvent).toBeUndefined();
    });
});

// =============================================================================
// J2 — Same source/destination resource ID validation
// =============================================================================

describe('J2 — same resource ID validation', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('emits error when from and to resource are the same', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        observer.seedResource({
            id: 'res-a',
            conformsTo: 'spec:gold',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'oz' },
        });

        observer.record({
            id: 'bad-transfer',
            action: 'transfer',
            resourceInventoriedAs: 'res-a',
            toResourceInventoriedAs: 'res-a', // same!
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'oz' },
        });

        const errorEvent = emitted.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        if (errorEvent?.type === 'error') {
            expect(errorEvent.error).toMatch(/cannot be the same resource/i);
        }
    });

    test('no resource state change occurs when same ID used', () => {
        observer.seedResource({
            id: 'res-a',
            conformsTo: 'spec:gold',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'oz' },
        });

        observer.record({
            id: 'bad-transfer',
            action: 'transfer',
            resourceInventoriedAs: 'res-a',
            toResourceInventoriedAs: 'res-a',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'oz' },
        });

        // Quantity should be unchanged (effects were aborted)
        const r = observer.getResource('res-a')!;
        expect(r.accountingQuantity?.hasNumericalValue).toBe(10);
    });
});

// =============================================================================
// L1 — inventory() hides depleted resources by default
// =============================================================================

describe('L1 — inventory hides depleted resources by default', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('inventory() excludes resources with qty=0', () => {
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e2',
            action: 'consume',
            resourceInventoriedAs: 'res-1',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            inputOf: 'proc-1',
        });

        expect(observer.inventory()).toHaveLength(0);
    });

    test('inventory({ includeEmpty: true }) includes depleted resources', () => {
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });
        observer.record({
            id: 'e2',
            action: 'consume',
            resourceInventoriedAs: 'res-1',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            inputOf: 'proc-1',
        });

        const full = observer.inventory({ includeEmpty: true });
        expect(full).toHaveLength(1);
        expect(full[0].accountingQty).toBe(0);
    });

    test('inventory() still shows resources with positive qty', () => {
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            resourceConformsTo: 'spec:x',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });

        expect(observer.inventory()).toHaveLength(1);
        expect(observer.inventory()[0].accountingQty).toBe(10);
    });
});

// =============================================================================
// K2 — process_completed event emitted
// =============================================================================

describe('K2 — process_completed event emitted', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('emits process_completed when all tracked output commitments are fulfilled', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        const proc = observer.registerProcess({ name: 'Bake' });
        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'loaf' },
            outputOf: proc.id,
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-bread',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'loaf' },
            outputOf: proc.id,
            fulfills: 'c1',
        });

        const completedEvent = emitted.find(e => e.type === 'process_completed');
        expect(completedEvent).toBeDefined();
        if (completedEvent?.type === 'process_completed') {
            expect(completedEvent.processId).toBe(proc.id);
        }

        expect(observer.getProcess(proc.id)?.finished).toBe(true);
    });

    test('does not emit process_completed when commitment only partially fulfilled', () => {
        const emitted: ObserverEvent[] = [];
        observer.subscribe(e => emitted.push(e));

        const proc = observer.registerProcess({ name: 'Bake' });
        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'loaf' },
            outputOf: proc.id,
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-bread',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'loaf' },
            outputOf: proc.id,
            fulfills: 'c1',
        });

        const completedEvent = emitted.find(e => e.type === 'process_completed');
        expect(completedEvent).toBeUndefined();
        expect(observer.getProcess(proc.id)?.finished).not.toBe(true);
    });
});

// =============================================================================
// C1 — Claim storage and query
// =============================================================================

describe('C1 — claim storage and query', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('allClaims returns registered claims', () => {
        observer.registerClaim({
            id: 'cl1',
            action: 'transfer',
            provider: 'agent:alice',
            receiver: 'agent:bob',
            triggeredBy: 'evt-work',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
            finished: false,
        });

        expect(observer.allClaims()).toHaveLength(1);
        expect(observer.allClaims()[0].id).toBe('cl1');
    });

    test('claimsTriggeredBy filters by triggering event', () => {
        observer.registerClaim({
            id: 'cl1',
            action: 'transfer',
            provider: 'agent:alice',
            receiver: 'agent:bob',
            triggeredBy: 'evt-work',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
            finished: false,
        });
        observer.registerClaim({
            id: 'cl2',
            action: 'transfer',
            provider: 'agent:alice',
            receiver: 'agent:bob',
            triggeredBy: 'evt-other',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'USD' },
            finished: false,
        });

        const fromWork = observer.claimsTriggeredBy('evt-work');
        expect(fromWork).toHaveLength(1);
        expect(fromWork[0].id).toBe('cl1');

        const fromOther = observer.claimsTriggeredBy('evt-other');
        expect(fromOther).toHaveLength(1);
        expect(fromOther[0].id).toBe('cl2');

        expect(observer.claimsTriggeredBy('nonexistent')).toHaveLength(0);
    });
});

// =============================================================================
// M1 — resourcesContainedIn
// =============================================================================

describe('M1 — resourcesContainedIn', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('returns resources with matching containedIn', () => {
        observer.seedResource({
            id: 'container',
            conformsTo: 'spec:box',
            accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
        });
        observer.seedResource({
            id: 'item-a',
            conformsTo: 'spec:apple',
            accountingQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
            containedIn: 'container',
        });
        observer.seedResource({
            id: 'item-b',
            conformsTo: 'spec:apple',
            accountingQuantity: { hasNumericalValue: 3, hasUnit: 'ea' },
            containedIn: 'container',
        });
        observer.seedResource({
            id: 'elsewhere',
            conformsTo: 'spec:pear',
            accountingQuantity: { hasNumericalValue: 2, hasUnit: 'ea' },
            containedIn: 'other-container',
        });

        const contents = observer.resourcesContainedIn('container');
        expect(contents).toHaveLength(2);
        expect(contents.map(r => r.id)).toContain('item-a');
        expect(contents.map(r => r.id)).toContain('item-b');
    });

    test('returns empty array for unknown container', () => {
        expect(observer.resourcesContainedIn('unknown')).toHaveLength(0);
    });
});

// =============================================================================
// M2 — resourcesByState
// =============================================================================

describe('M2 — resourcesByState', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('returns only resources with the given state', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:grape',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            state: 'ripe',
        });
        observer.seedResource({
            id: 'r2',
            conformsTo: 'spec:grape',
            accountingQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            state: 'unripe',
        });
        observer.seedResource({
            id: 'r3',
            conformsTo: 'spec:grape',
            accountingQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
            state: 'ripe',
        });

        const ripe = observer.resourcesByState('ripe');
        expect(ripe).toHaveLength(2);
        expect(ripe.map(r => r.id)).toContain('r1');
        expect(ripe.map(r => r.id)).toContain('r3');

        const unripe = observer.resourcesByState('unripe');
        expect(unripe).toHaveLength(1);
        expect(unripe[0].id).toBe('r2');
    });
});

// =============================================================================
// M3 — eventsForAgreement
// =============================================================================

describe('M3 — eventsForAgreement', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('eventsForAgreement returns all events realizing an agreement', () => {
        observer.seedResource({
            id: 'res-a',
            conformsTo: 'spec:USD',
            accountingQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
        });

        const results = observer.recordExchange({
            agreement: { id: 'ag1', name: 'Trade deal' },
            events: [
                {
                    id: 'e1',
                    action: 'transfer',
                    provider: 'agent:alice',
                    receiver: 'agent:bob',
                    resourceInventoriedAs: 'res-a',
                    toResourceInventoriedAs: 'res-b',
                    resourceConformsTo: 'spec:USD',
                    resourceQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
                },
            ],
        });

        expect(results).toHaveLength(1);

        const agreementEvents = observer.eventsForAgreement('ag1');
        expect(agreementEvents).toHaveLength(1);
        expect(agreementEvents[0].id).toBe('e1');
        expect(agreementEvents[0].realizationOf).toBe('ag1');
    });

    test('getAgreement returns the registered agreement', () => {
        observer.recordExchange({
            agreement: { id: 'ag1', name: 'Service contract' },
            events: [],
        });

        const ag = observer.getAgreement('ag1');
        expect(ag).toBeDefined();
        expect(ag?.name).toBe('Service contract');
    });

    test('eventsForAgreement returns empty for unknown agreement', () => {
        expect(observer.eventsForAgreement('ag-nonexistent')).toHaveLength(0);
    });
});

// =============================================================================
// M4 — traceResource walks previousEvent chain
// =============================================================================

describe('M4 — traceResource walks previousEvent chain', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('returns events in chronological order', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:x',
            accountingQuantity: { hasNumericalValue: 0, hasUnit: 'u' },
        });

        observer.record({ id: 'e1', action: 'raise', resourceInventoriedAs: 'r1',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'u' } });
        observer.record({ id: 'e2', action: 'raise', resourceInventoriedAs: 'r1',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'u' } });
        observer.record({ id: 'e3', action: 'raise', resourceInventoriedAs: 'r1',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'u' } });

        const trace = observer.traceResource('r1');
        expect(trace).toHaveLength(3);
        expect(trace[0].id).toBe('e1');
        expect(trace[1].id).toBe('e2');
        expect(trace[2].id).toBe('e3');
    });

    test('returns empty array for resource with no events', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:x',
            accountingQuantity: { hasNumericalValue: 5, hasUnit: 'u' },
        });
        expect(observer.traceResource('r1')).toHaveLength(0);
    });

    test('returns empty array for unknown resource', () => {
        expect(observer.traceResource('nonexistent')).toHaveLength(0);
    });
});

// =============================================================================
// G3 — registerAgreement and getAgreement
// =============================================================================

describe('G3 — registerAgreement and getAgreement', () => {
    let observer: Observer;
    beforeEach(() => { observer = new Observer(); });

    test('registerAgreement stores and getAgreement retrieves it', () => {
        observer.registerAgreement({ id: 'ag1', name: 'Supply contract', note: 'Annual deal' });

        const ag = observer.getAgreement('ag1');
        expect(ag).toBeDefined();
        expect(ag?.id).toBe('ag1');
        expect(ag?.name).toBe('Supply contract');
    });

    test('getAgreement returns undefined for unknown id', () => {
        expect(observer.getAgreement('nonexistent')).toBeUndefined();
    });

    test('commitment clauseOf links to agreement', () => {
        observer.registerAgreement({ id: 'ag1' });
        observer.registerIntent({
            id: 'i1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            finished: false,
        });
        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            clauseOf: 'ag1',
            satisfies: 'i1',
            finished: false,
        });

        // Commitment should appear in satisfyingCommitments
        const sat = observer.getSatisfaction('i1');
        expect(sat?.satisfyingCommitments).toContain('c1');

        // Agreement object should be retrievable
        expect(observer.getAgreement('ag1')).toBeDefined();
    });
});
