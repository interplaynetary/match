/**
 * Observer: VF Action Effect Tests
 *
 * Verifies that each VF action applies the correct resource effects as defined
 * by the ACTION_DEFINITIONS in schemas.ts.
 *
 * Covered actions: use, cite, combine, separate, copy, transferAllRights,
 * transferCustody, raise, lower, move.
 *
 * Actions that interact with implied-transfer logic (produce, consume, pickup,
 * dropoff, accept, modify, deliverService) are tested in observer.test.ts.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';

describe('Observer: action effects', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
    });

    // ─── use ──────────────────────────────────────────────────────────────────

    describe('use', () => {
        test('does not change accounting or onhand quantity (existence gate only)', () => {
            observer.seedResource({
                id: 'tool',
                conformsTo: 'spec:hammer',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'use',
                resourceInventoriedAs: 'tool',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            const tool = observer.getResource('tool')!;
            expect(tool.accountingQuantity?.hasNumericalValue).toBe(1); // unchanged
            expect(tool.onhandQuantity?.hasNumericalValue).toBe(1);     // unchanged
        });

        test('updates resource state when event.state is provided', () => {
            observer.seedResource({
                id: 'tool',
                conformsTo: 'spec:drill',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'ready',
            });

            observer.record({
                id: 'e1',
                action: 'use',
                resourceInventoriedAs: 'tool',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'in-use',
            });

            expect(observer.getResource('tool')!.state).toBe('in-use');
        });

        test('leaves resource state unchanged when event.state is absent', () => {
            observer.seedResource({
                id: 'tool',
                conformsTo: 'spec:drill',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'ready',
            });

            observer.record({
                id: 'e1',
                action: 'use',
                resourceInventoriedAs: 'tool',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                // no state field
            });

            expect(observer.getResource('tool')!.state).toBe('ready'); // unchanged
        });
    });

    // ─── cite ─────────────────────────────────────────────────────────────────

    describe('cite', () => {
        test('does not change quantity (reference-only, like use)', () => {
            observer.seedResource({
                id: 'doc',
                conformsTo: 'spec:manual',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'cite',
                resourceInventoriedAs: 'doc',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            expect(observer.getResource('doc')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('updates state on the cited resource when event.state is given', () => {
            observer.seedResource({
                id: 'doc',
                conformsTo: 'spec:manual',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'draft',
            });

            observer.record({
                id: 'e1',
                action: 'cite',
                resourceInventoriedAs: 'doc',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'published',
            });

            expect(observer.getResource('doc')!.state).toBe('published');
        });
    });

    // ─── combine ──────────────────────────────────────────────────────────────

    describe('combine', () => {
        test('sets containedIn on the ingredient (from-resource)', () => {
            observer.seedResource({
                id: 'flour',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });
            observer.seedResource({
                id: 'bowl',
                conformsTo: 'spec:bowl',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'combine',
                resourceInventoriedAs: 'flour',         // ingredient → from
                toResourceInventoriedAs: 'bowl',        // container → to
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });

            const flour = observer.getResource('flour')!;
            expect(flour.containedIn).toBe('bowl');
        });

        test('does not change quantity on either resource', () => {
            observer.seedResource({
                id: 'flour',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });
            observer.seedResource({
                id: 'bowl',
                conformsTo: 'spec:bowl',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'combine',
                resourceInventoriedAs: 'flour',
                toResourceInventoriedAs: 'bowl',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });

            expect(observer.getResource('flour')!.accountingQuantity?.hasNumericalValue).toBe(500);
            expect(observer.getResource('bowl')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });
    });

    // ─── separate ─────────────────────────────────────────────────────────────

    describe('separate', () => {
        test('clears containedIn on the separated resource', () => {
            observer.seedResource({
                id: 'flour',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
                containedIn: 'bowl',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'flour',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });

            expect(observer.getResource('flour')!.containedIn).toBeUndefined();
        });

        test('does not change quantity', () => {
            observer.seedResource({
                id: 'flour',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
                containedIn: 'bowl',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'flour',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });

            expect(observer.getResource('flour')!.accountingQuantity?.hasNumericalValue).toBe(500);
        });
    });

    // ─── combine / separate round-trip ────────────────────────────────────────

    describe('combine → separate round-trip', () => {
        test('restores a resource to standalone after combine then separate', () => {
            observer.seedResource({
                id: 'sugar',
                conformsTo: 'spec:sugar',
                accountingQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            observer.seedResource({
                id: 'bowl',
                conformsTo: 'spec:bowl',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e-combine',
                action: 'combine',
                resourceInventoriedAs: 'sugar',
                toResourceInventoriedAs: 'bowl',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            expect(observer.getResource('sugar')!.containedIn).toBe('bowl');

            observer.record({
                id: 'e-separate',
                action: 'separate',
                resourceInventoriedAs: 'sugar',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            expect(observer.getResource('sugar')!.containedIn).toBeUndefined();

            // Qty never moved
            expect(observer.getResource('sugar')!.accountingQuantity?.hasNumericalValue).toBe(200);
        });
    });

    // ─── copy ─────────────────────────────────────────────────────────────────

    describe('copy', () => {
        test('increments to-resource quantity (creates a copy)', () => {
            observer.seedResource({
                id: 'original',
                conformsTo: 'spec:drawing',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'copy',
                resourceInventoriedAs: 'original',
                toResourceInventoriedAs: 'copy-1',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                receiver: 'agent:bob',
            });

            const copy = observer.getResource('copy-1')!;
            expect(copy).toBeDefined();
            expect(copy.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('original quantity is unchanged after copy', () => {
            observer.seedResource({
                id: 'original',
                conformsTo: 'spec:drawing',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'copy',
                resourceInventoriedAs: 'original',
                toResourceInventoriedAs: 'copy-1',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            // incrementTo only applies to to-resource; from-resource is untouched
            expect(observer.getResource('original')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('copy gets location from event.toLocation, original location unchanged', () => {
            observer.seedResource({
                id: 'original',
                conformsTo: 'spec:drawing',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:london',
            });

            observer.record({
                id: 'e1',
                action: 'copy',
                resourceInventoriedAs: 'original',
                toResourceInventoriedAs: 'copy-1',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                toLocation: 'loc:berlin',
            });

            expect(observer.getResource('copy-1')!.currentLocation).toBe('loc:berlin');
            expect(observer.getResource('original')!.currentLocation).toBe('loc:london'); // unchanged
        });

        test('copy gets primaryAccountable = receiver via accountableEffect updateTo', () => {
            observer.seedResource({
                id: 'original',
                conformsTo: 'spec:drawing',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                primaryAccountable: 'agent:alice',
            });

            observer.record({
                id: 'e1',
                action: 'copy',
                resourceInventoriedAs: 'original',
                toResourceInventoriedAs: 'copy-1',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                receiver: 'agent:bob',
            });

            expect(observer.getResource('copy-1')!.primaryAccountable).toBe('agent:bob');
            // Original's accountable is unchanged
            expect(observer.getResource('original')!.primaryAccountable).toBe('agent:alice');
        });
    });

    // ─── transferAllRights ────────────────────────────────────────────────────

    describe('transferAllRights', () => {
        test('decrements from-resource and increments to-resource (accounting only)', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:wheat',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'transferAllRights',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
                receiver: 'agent:buyer',
            });

            const from = observer.getResource('from')!;
            const to   = observer.getResource('to')!;

            expect(from.accountingQuantity?.hasNumericalValue).toBe(60);
            expect(to.accountingQuantity?.hasNumericalValue).toBe(40);
        });

        test('does NOT change onhand quantity (rights transfer, not physical move)', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:wheat',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'transferAllRights',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
                receiver: 'agent:buyer',
            });

            // onhand unchanged — no physical movement
            expect(observer.getResource('from')!.onhandQuantity?.hasNumericalValue).toBe(100);
        });

        test('to-resource gets primaryAccountable = receiver', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:wheat',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                primaryAccountable: 'agent:seller',
            });

            observer.record({
                id: 'e1',
                action: 'transferAllRights',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
                receiver: 'agent:buyer',
            });

            expect(observer.getResource('to')!.primaryAccountable).toBe('agent:buyer');
        });
    });

    // ─── transferCustody ─────────────────────────────────────────────────────

    describe('transferCustody', () => {
        test('moves onhand quantity from→to, accounting unchanged', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:pallet',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            });

            observer.record({
                id: 'e1',
                action: 'transferCustody',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 6, hasUnit: 'unit' },
                toLocation: 'loc:warehouse-b',
            });

            const from = observer.getResource('from')!;
            const to   = observer.getResource('to')!;

            expect(from.onhandQuantity?.hasNumericalValue).toBe(4);   // 10 - 6
            expect(to.onhandQuantity?.hasNumericalValue).toBe(6);     // + 6

            // Accounting unchanged for both
            expect(from.accountingQuantity?.hasNumericalValue).toBe(10);
        });

        test('to-resource gets the toLocation', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                currentLocation: 'loc:warehouse-a',
            });

            observer.record({
                id: 'e1',
                action: 'transferCustody',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                toLocation: 'loc:warehouse-b',
            });

            expect(observer.getResource('to')!.currentLocation).toBe('loc:warehouse-b');
            // from-resource location unchanged (locationEffect: updateTo → only to-resource)
            expect(observer.getResource('from')!.currentLocation).toBe('loc:warehouse-a');
        });
    });

    // ─── raise / lower ────────────────────────────────────────────────────────

    describe('raise and lower (inventory adjustments)', () => {
        test('raise increments both accounting and onhand', () => {
            observer.seedResource({
                id: 'stock',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'raise',
                resourceInventoriedAs: 'stock',
                resourceQuantity: { hasNumericalValue: 25, hasUnit: 'kg' },
            });

            const stock = observer.getResource('stock')!;
            expect(stock.accountingQuantity?.hasNumericalValue).toBe(125);
            expect(stock.onhandQuantity?.hasNumericalValue).toBe(125);
        });

        test('lower decrements both accounting and onhand', () => {
            observer.seedResource({
                id: 'stock',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'lower',
                resourceInventoriedAs: 'stock',
                resourceQuantity: { hasNumericalValue: 15, hasUnit: 'kg' },
            });

            const stock = observer.getResource('stock')!;
            expect(stock.accountingQuantity?.hasNumericalValue).toBe(85);
            expect(stock.onhandQuantity?.hasNumericalValue).toBe(85);
        });
    });

    // ─── move ─────────────────────────────────────────────────────────────────

    describe('move', () => {
        test('decrements from and increments to for both accounting and onhand', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:grain',
                accountingQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'move',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
                toLocation: 'loc:silo-2',
            });

            const from = observer.getResource('from')!;
            const to   = observer.getResource('to')!;

            expect(from.accountingQuantity?.hasNumericalValue).toBe(120);
            expect(from.onhandQuantity?.hasNumericalValue).toBe(120);
            expect(to.accountingQuantity?.hasNumericalValue).toBe(80);
            expect(to.onhandQuantity?.hasNumericalValue).toBe(80);
        });

        test('to-resource gets the toLocation, from-resource unchanged', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:grain',
                accountingQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                currentLocation: 'loc:silo-1',
            });

            observer.record({
                id: 'e1',
                action: 'move',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
                toLocation: 'loc:silo-2',
            });

            expect(observer.getResource('to')!.currentLocation).toBe('loc:silo-2');
            expect(observer.getResource('from')!.currentLocation).toBe('loc:silo-1');
        });

        test('does not change pre-existing accountable on to-resource (unlike transferAllRights)', () => {
            // When the to-resource already exists and is owned by 'agent:carol',
            // move should leave that ownership intact.
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:grain',
                accountingQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
            });
            observer.seedResource({
                id: 'to',
                conformsTo: 'spec:grain',
                accountingQuantity: { hasNumericalValue: 0, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'kg' },
                primaryAccountable: 'agent:carol', // pre-existing owner
            });

            observer.record({
                id: 'e1',
                action: 'move',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 80, hasUnit: 'kg' },
                receiver: 'agent:bob',
            });

            // move has accountableEffect: noEffect → existing accountable is unchanged
            expect(observer.getResource('to')!.primaryAccountable).toBe('agent:carol');
        });
    });
});
