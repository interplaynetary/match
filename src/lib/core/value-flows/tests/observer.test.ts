import { describe, expect, test, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';
import type { EconomicEvent } from '../schemas';

describe('Observer (Stockbook)', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
    });

    test('records events and tracks resources', () => {
        // Produce
        const produced = observer.record({
            id: 'evt-1',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            outputOf: 'proc-1',
        });

        expect(produced.length).toBe(1);
        expect(produced[0].id).toBe('res-1');
        expect(produced[0].accountingQuantity?.hasNumericalValue).toBe(10);
        
        const inventory = observer.inventory();
        expect(inventory.length).toBe(1);
        expect(inventory[0].onhandQty).toBe(10);
        
        // Consume
        const consumed = observer.record({
            id: 'evt-2',
            action: 'consume',
            resourceInventoriedAs: 'res-1',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'unit' },
            inputOf: 'proc-2',
        });
        
        expect(consumed[0].accountingQuantity?.hasNumericalValue).toBe(7); // 10 - 3
    });

    test('rejects event with both fulfills and satisfies', () => {
        expect(() => {
            observer.record({
                id: 'bad-evt',
                action: 'produce',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                fulfills: ['commitment-1'],
                satisfies: ['intent-1'],
            } as any); // using any because TS normally catches this
        }).toThrow(/cannot both fulfill a Commitment and satisfy an Intent/);
    });

    test('tracks fulfillment of commitments', () => {
        observer.registerCommitment({
            id: 'c1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 6, hasUnit: 'kg' },
            fulfills: 'c1',
        });

        let f = observer.getFulfillment('c1');
        expect(f?.totalFulfilled.hasNumericalValue).toBe(6);
        expect(f?.finished).toBe(false);

        observer.record({
            id: 'e2',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'kg' },
            fulfills: 'c1',
        });

        f = observer.getFulfillment('c1');
        expect(f?.totalFulfilled.hasNumericalValue).toBe(10);
        expect(f?.finished).toBe(true);
    });

    test('tracks satisfaction of intents', () => {
        observer.registerIntent({
            id: 'i1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            finished: false,
        });

        observer.record({
            id: 'e1',
            action: 'consume',
            resourceQuantity: { hasNumericalValue: 60, hasUnit: 'kg' },
            satisfies: 'i1',
        });

        const s = observer.getSatisfaction('i1');
        expect(s?.totalSatisfied.hasNumericalValue).toBe(60);
        expect(s?.finished).toBe(false);
    });

    test('applyCorrection unrolls previous event effect', () => {
        // Initial event
        observer.record({
            id: 'e1',
            action: 'produce',
            resourceInventoriedAs: 'res-shared',
            resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
        });

        let res = observer.getResource('res-shared');
        expect(res?.accountingQuantity?.hasNumericalValue).toBe(10);

        // Event that corrects e1 (e.g. oops it was actually 8)
        observer.record({
            id: 'e2',
            action: 'produce',
            resourceInventoriedAs: 'res-shared',
            resourceQuantity: { hasNumericalValue: 8, hasUnit: 'ea' },
            corrects: 'e1', // e2 corrects e1
        });

        // The overall result should be 8, not 18, and not 10.
        // It should negate the +10 from e1, and apply the +8 from e2.
        res = observer.getResource('res-shared');
        expect(res?.accountingQuantity?.hasNumericalValue).toBe(8);
        
        // Assert e1 is marked as retracted/overridden
        const events = observer.eventsForResource('res-shared');
        const activeEvents = events.filter(e => !events.some(x => x.corrects === e.id));
        expect(activeEvents.length).toBe(1);
        expect(activeEvents[0].id).toBe('e2');
    });

    test('handles transfer correctly', () => {
        observer.seedResource({
            id: 'res-a',
            conformsTo: 'spec:gold',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'oz' },
        });

        observer.record({
            id: 'trans',
            action: 'transfer',
            resourceInventoriedAs: 'res-a',         // From
            toResourceInventoriedAs: 'res-b',       // To
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'oz' },
        });

        const a = observer.getResource('res-a')!;
        const b = observer.getResource('res-b')!;

        expect(a.accountingQuantity?.hasNumericalValue).toBe(6);
        expect(b.accountingQuantity?.hasNumericalValue).toBe(4);
    });

    test('tracks previousEvent breadcrumbs', () => {
        observer.seedResource({
            id: 'r1',
            conformsTo: 'spec:x',
            accountingQuantity: { hasNumericalValue: 0, hasUnit: 'u' },
        });

        observer.record({ id: 'e1', action: 'raise', resourceInventoriedAs: 'r1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'u' }});
        observer.record({ id: 'e2', action: 'raise', resourceInventoriedAs: 'r1', resourceQuantity: { hasNumericalValue: 1, hasUnit: 'u' }});
        
        const r1 = observer.getResource('r1')!;
        expect(r1.previousEvent).toBe('e2');
        
        const e2 = observer.getEvent('e2')!;
        expect(e2.previousEvent).toBe('e1');
    });
});
