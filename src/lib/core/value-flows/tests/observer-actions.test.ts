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

        test('does not change accounting quantity; decrements onhand of ingredient', () => {
            observer.seedResource({
                id: 'flour',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
                onhandQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });
            observer.seedResource({
                id: 'bowl',
                conformsTo: 'spec:bowl',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'combine',
                resourceInventoriedAs: 'flour',
                toResourceInventoriedAs: 'bowl',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
            });

            // accounting unchanged
            expect(observer.getResource('flour')!.accountingQuantity?.hasNumericalValue).toBe(500);
            expect(observer.getResource('bowl')!.accountingQuantity?.hasNumericalValue).toBe(1);
            // onhand of ingredient decrements (it physically entered the container)
            expect(observer.getResource('flour')!.onhandQuantity?.hasNumericalValue).toBe(0);
            // container onhand unchanged
            expect(observer.getResource('bowl')!.onhandQuantity?.hasNumericalValue).toBe(1);
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
                onhandQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            observer.seedResource({
                id: 'bowl',
                conformsTo: 'spec:bowl',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            observer.record({
                id: 'e-combine',
                action: 'combine',
                resourceInventoriedAs: 'sugar',
                toResourceInventoriedAs: 'bowl',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            expect(observer.getResource('sugar')!.containedIn).toBe('bowl');
            // onhand decrements on combine
            expect(observer.getResource('sugar')!.onhandQuantity?.hasNumericalValue).toBe(0);

            observer.record({
                id: 'e-separate',
                action: 'separate',
                resourceInventoriedAs: 'sugar',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
            });
            expect(observer.getResource('sugar')!.containedIn).toBeUndefined();
            // onhand increments on separate (back to original)
            expect(observer.getResource('sugar')!.onhandQuantity?.hasNumericalValue).toBe(200);

            // Accounting qty never moved
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

        test('copy gets primaryAccountable = receiver via accountableEffect new (to-resource)', () => {
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

    // ─── accept ───────────────────────────────────────────────────────────────

    describe('accept', () => {
        test('decrements onhand when resource enters repair process (accounting unchanged)', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                accountingQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'accept',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            });

            const device = observer.getResource('device')!;
            expect(device.accountingQuantity?.hasNumericalValue).toBe(5); // unchanged
            expect(device.onhandQuantity?.hasNumericalValue).toBe(3);     // 5 - 2
        });

        test('updates currentLocation to event.toLocation', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:floor',
            });

            observer.record({
                id: 'e1',
                action: 'accept',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                toLocation: 'loc:repair-shop',
            });

            expect(observer.getResource('device')!.currentLocation).toBe('loc:repair-shop');
        });

        test('updates state when event.state is provided', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'working',
            });

            observer.record({
                id: 'e1',
                action: 'accept',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'in-repair',
            });

            expect(observer.getResource('device')!.state).toBe('in-repair');
        });
    });

    // ─── modify ───────────────────────────────────────────────────────────────

    describe('modify', () => {
        test('increments onhand when resource exits repair process (accounting unchanged)', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                accountingQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
            });

            observer.record({
                id: 'e1',
                action: 'modify',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            });

            const device = observer.getResource('device')!;
            expect(device.accountingQuantity?.hasNumericalValue).toBe(5); // unchanged
            expect(device.onhandQuantity?.hasNumericalValue).toBe(5);     // 3 + 2
        });

        test('updates currentLocation to event.toLocation', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:repair-shop',
            });

            observer.record({
                id: 'e1',
                action: 'modify',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                toLocation: 'loc:floor',
            });

            expect(observer.getResource('device')!.currentLocation).toBe('loc:floor');
        });

        test('updates stage from process.basedOn when event.outputOf is set', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });
            observer.registerProcess({
                id: 'proc:repair',
                name: 'Repair Process',
                basedOn: 'spec:repaired',
            });

            observer.record({
                id: 'e1',
                action: 'modify',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                outputOf: 'proc:repair',
            });

            expect(observer.getResource('device')!.stage).toBe('spec:repaired');
        });

        test('updates state when event.state is provided', () => {
            observer.seedResource({
                id: 'device',
                conformsTo: 'spec:device',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'in-repair',
            });

            observer.record({
                id: 'e1',
                action: 'modify',
                resourceInventoriedAs: 'device',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'repaired',
            });

            expect(observer.getResource('device')!.state).toBe('repaired');
        });
    });

    // ─── pickup ───────────────────────────────────────────────────────────────

    describe('pickup', () => {
        test('decrements onhand when transport begins (accounting unchanged)', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
            });

            observer.record({
                id: 'e1',
                action: 'pickup',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 4, hasUnit: 'unit' },
            });

            const pallet = observer.getResource('pallet')!;
            expect(pallet.accountingQuantity?.hasNumericalValue).toBe(10); // unchanged
            expect(pallet.onhandQuantity?.hasNumericalValue).toBe(6);      // 10 - 4
        });

        test('updates currentLocation to event.toLocation', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                currentLocation: 'loc:warehouse',
            });

            observer.record({
                id: 'e1',
                action: 'pickup',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                toLocation: 'loc:truck',
            });

            expect(observer.getResource('pallet')!.currentLocation).toBe('loc:truck');
        });

        test('updates state when event.state is provided', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                state: 'at-warehouse',
            });

            observer.record({
                id: 'e1',
                action: 'pickup',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                state: 'in-transit',
            });

            expect(observer.getResource('pallet')!.state).toBe('in-transit');
        });
    });

    // ─── dropoff ──────────────────────────────────────────────────────────────

    describe('dropoff', () => {
        test('increments onhand when transport ends (accounting unchanged)', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                onhandQuantity: { hasNumericalValue: 6, hasUnit: 'unit' },
            });

            observer.record({
                id: 'e1',
                action: 'dropoff',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 4, hasUnit: 'unit' },
            });

            const pallet = observer.getResource('pallet')!;
            expect(pallet.accountingQuantity?.hasNumericalValue).toBe(10); // unchanged
            expect(pallet.onhandQuantity?.hasNumericalValue).toBe(10);     // 6 + 4
        });

        test('updates currentLocation to event.toLocation', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                currentLocation: 'loc:truck',
            });

            observer.record({
                id: 'e1',
                action: 'dropoff',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                toLocation: 'loc:store',
            });

            expect(observer.getResource('pallet')!.currentLocation).toBe('loc:store');
        });

        test('updates stage from process.basedOn when event.outputOf is set', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
            });
            observer.registerProcess({
                id: 'proc:delivery',
                name: 'Delivery Process',
                basedOn: 'spec:delivered',
            });

            observer.record({
                id: 'e1',
                action: 'dropoff',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                outputOf: 'proc:delivery',
            });

            expect(observer.getResource('pallet')!.stage).toBe('spec:delivered');
        });

        test('updates state when event.state is provided', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                state: 'in-transit',
            });

            observer.record({
                id: 'e1',
                action: 'dropoff',
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
                state: 'delivered',
            });

            expect(observer.getResource('pallet')!.state).toBe('delivered');
        });
    });

    // ─── consume (state) ──────────────────────────────────────────────────────

    describe('consume (state effect)', () => {
        test('updates state on consumed resource when event.state is provided', () => {
            observer.seedResource({
                id: 'ingredient',
                conformsTo: 'spec:flour',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
                onhandQuantity: { hasNumericalValue: 500, hasUnit: 'g' },
                state: 'stored',
            });

            observer.record({
                id: 'e1',
                action: 'consume',
                resourceInventoriedAs: 'ingredient',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'g' },
                state: 'used',
            });

            expect(observer.getResource('ingredient')!.state).toBe('used');
        });
    });

    // ─── separate (state & stage) ─────────────────────────────────────────────

    describe('separate (state & stage effects)', () => {
        test('increments onhand when resource is separated (accounting unchanged)', () => {
            observer.seedResource({
                id: 'component',
                conformsTo: 'spec:part',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
                onhandQuantity: { hasNumericalValue: 8, hasUnit: 'each' },
                containedIn: 'assembly',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'component',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
            });

            const component = observer.getResource('component')!;
            expect(component.accountingQuantity?.hasNumericalValue).toBe(10); // unchanged
            expect(component.onhandQuantity?.hasNumericalValue).toBe(10);     // 8 + 2
        });

        test('updates stage from process.basedOn when event.outputOf is set', () => {
            observer.seedResource({
                id: 'component',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'assembly',
            });
            observer.registerProcess({
                id: 'proc:disassembly',
                name: 'Disassembly',
                basedOn: 'spec:disassembled',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'component',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                outputOf: 'proc:disassembly',
            });

            expect(observer.getResource('component')!.stage).toBe('spec:disassembled');
        });

        test('updates state when event.state is provided', () => {
            observer.seedResource({
                id: 'component',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'assembly',
                state: 'assembled',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'component',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                state: 'separated',
            });

            expect(observer.getResource('component')!.state).toBe('separated');
        });
    });

    // ─── transfer (state) ─────────────────────────────────────────────────────

    describe('transfer (state effect)', () => {
        test('sets state on to-resource when event.state is provided', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:goods',
                accountingQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'transfer',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
                receiver: 'agent:bob',
                state: 'transferred',
            });

            expect(observer.getResource('to')!.state).toBe('transferred');
        });
    });

    // ─── transferAllRights (state) ────────────────────────────────────────────

    describe('transferAllRights (state effect)', () => {
        test('sets state on to-resource when event.state is provided', () => {
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
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                receiver: 'agent:buyer',
                state: 'sold',
            });

            expect(observer.getResource('to')!.state).toBe('sold');
        });
    });

    // ─── transferCustody (state) ──────────────────────────────────────────────

    describe('transferCustody (state effect)', () => {
        test('sets state on to-resource when event.state is provided', () => {
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
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'unit' },
                toLocation: 'loc:depot',
                state: 'in-custody',
            });

            expect(observer.getResource('to')!.state).toBe('in-custody');
        });
    });

    // ─── move (state) ─────────────────────────────────────────────────────────

    describe('move (state effect)', () => {
        test('sets state on to-resource when event.state is provided', () => {
            observer.seedResource({
                id: 'from',
                conformsTo: 'spec:grain',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            });

            observer.record({
                id: 'e1',
                action: 'move',
                resourceInventoriedAs: 'from',
                toResourceInventoriedAs: 'to',
                resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
                toLocation: 'loc:silo-3',
                state: 'relocated',
            });

            expect(observer.getResource('to')!.state).toBe('relocated');
        });
    });

    // ─── raise ────────────────────────────────────────────────────────────────

    describe('raise (accountable & state on new resource)', () => {
        test('sets primaryAccountable = event.receiver on newly created resource', () => {
            // resource does not exist yet → raise creates it
            observer.record({
                id: 'e1',
                action: 'raise',
                resourceInventoriedAs: 'stock-new',
                resourceConformsTo: 'spec:apples',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                receiver: 'agent:alice',
            });

            expect(observer.getResource('stock-new')!.primaryAccountable).toBe('agent:alice');
        });

        test('updates state on the resource when event.state is provided', () => {
            observer.seedResource({
                id: 'stock',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                state: 'raw',
            });

            observer.record({
                id: 'e1',
                action: 'raise',
                resourceInventoriedAs: 'stock',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
                state: 'counted',
            });

            expect(observer.getResource('stock')!.state).toBe('counted');
        });
    });

    // ─── lower ────────────────────────────────────────────────────────────────

    describe('lower (createResource optional, accountable & state)', () => {
        test('creates the resource when it does not exist', () => {
            observer.record({
                id: 'e1',
                action: 'lower',
                resourceInventoriedAs: 'stock-shrinkage',
                resourceConformsTo: 'spec:apples',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
                receiver: 'agent:alice',
            });

            expect(observer.getResource('stock-shrinkage')).toBeDefined();
        });

        test('sets primaryAccountable = event.receiver on newly created resource', () => {
            observer.record({
                id: 'e1',
                action: 'lower',
                resourceInventoriedAs: 'stock-shrinkage',
                resourceConformsTo: 'spec:apples',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
                receiver: 'agent:alice',
            });

            expect(observer.getResource('stock-shrinkage')!.primaryAccountable).toBe('agent:alice');
        });

        test('updates state on the resource when event.state is provided', () => {
            observer.seedResource({
                id: 'stock',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
                state: 'raw',
            });

            observer.record({
                id: 'e1',
                action: 'lower',
                resourceInventoriedAs: 'stock',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
                state: 'written-off',
            });

            expect(observer.getResource('stock')!.state).toBe('written-off');
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

    // ─── pickup (split-custody — implied custody transfer) ────────────────────

    describe('pickup (split-custody — implied custody transfer)', () => {
        // Helper: seed Alice's stock and fire a split-custody pickup
        function setupSplitPickup(obs: Observer) {
            obs.seedResource({
                id: 'alice-apples',
                conformsTo: 'spec:apple',
                accountingQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                currentLocation: 'loc:warehouse',
                primaryAccountable: 'agent:alice',
            });
            obs.record({
                id: 'e1',
                action: 'pickup',
                provider: 'agent:alice',
                receiver: 'agent:trucker',
                resourceInventoriedAs: 'alice-apples',
                toResourceInventoriedAs: 'bill-of-lading',
                resourceConformsTo: 'spec:apple',
                resourceQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                toLocation: 'loc:truck',
            });
        }

        test('auto-creates to-resource (bill of lading) when provider ≠ receiver', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('bill-of-lading')).toBeDefined();
        });

        test('to-resource onhand incremented (trucker has physical custody)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('bill-of-lading')!.onhandQuantity?.hasNumericalValue).toBe(8);
        });

        test('from-resource onhand decremented (goods left Alice)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('alice-apples')!.onhandQuantity?.hasNumericalValue).toBe(0);
        });

        test('from-resource location NOT updated (stock stays at origin)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('alice-apples')!.currentLocation).toBe('loc:warehouse');
        });

        test('to-resource location set to toLocation (goods are on truck)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('bill-of-lading')!.currentLocation).toBe('loc:truck');
        });

        test('accounting quantities unchanged for both resources (custody only, no ownership transfer)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('alice-apples')!.accountingQuantity?.hasNumericalValue).toBe(8);
            expect(observer.getResource('bill-of-lading')!.accountingQuantity?.hasNumericalValue).toBe(0);
        });

        test('to-resource primaryAccountable set to receiver (trucker holds the bill of lading)', () => {
            setupSplitPickup(observer);
            expect(observer.getResource('bill-of-lading')!.primaryAccountable).toBe('agent:trucker');
        });

        test('single-resource pickup unchanged — backward compat (same provider/receiver)', () => {
            observer.seedResource({
                id: 'pallet',
                conformsTo: 'spec:pallet',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'unit' },
                currentLocation: 'loc:dock',
            });
            observer.record({
                id: 'e1',
                action: 'pickup',
                provider: 'agent:alice',
                receiver: 'agent:alice',  // same — no split
                resourceInventoriedAs: 'pallet',
                resourceQuantity: { hasNumericalValue: 4, hasUnit: 'unit' },
                toLocation: 'loc:truck',
            });
            // Normal pickup: onhand decrements, location updates
            expect(observer.getResource('pallet')!.onhandQuantity?.hasNumericalValue).toBe(6);
            expect(observer.getResource('pallet')!.currentLocation).toBe('loc:truck');
        });
    });

    // ─── dropoff (split-custody — implied custody transfer) ───────────────────

    describe('dropoff (split-custody — implied custody transfer)', () => {
        function setupSplitDropoff(obs: Observer) {
            obs.seedResource({
                id: 'bill-of-lading',
                conformsTo: 'spec:apple',
                accountingQuantity: { hasNumericalValue: 0, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                currentLocation: 'loc:truck',
                primaryAccountable: 'agent:trucker',
            });
            obs.record({
                id: 'e2',
                action: 'dropoff',
                provider: 'agent:trucker',
                receiver: 'agent:bob',
                resourceInventoriedAs: 'bill-of-lading',
                toResourceInventoriedAs: 'bob-stock',
                resourceConformsTo: 'spec:apple',
                resourceQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                toLocation: 'loc:shop',
            });
        }

        test('auto-creates to-resource (receiver stock) when provider ≠ receiver', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bob-stock')).toBeDefined();
        });

        test('from-resource (bill of lading) onhand decremented (trucker releases custody)', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bill-of-lading')!.onhandQuantity?.hasNumericalValue).toBe(0);
        });

        test('to-resource (receiver stock) onhand incremented (Bob has goods)', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bob-stock')!.onhandQuantity?.hasNumericalValue).toBe(8);
        });

        test('to-resource location set to toLocation (goods at delivery point)', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bob-stock')!.currentLocation).toBe('loc:shop');
        });

        test('to-resource primaryAccountable set to receiver', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bob-stock')!.primaryAccountable).toBe('agent:bob');
        });

        test('accounting quantities unchanged (custody transfer only)', () => {
            setupSplitDropoff(observer);
            expect(observer.getResource('bill-of-lading')!.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(observer.getResource('bob-stock')!.accountingQuantity?.hasNumericalValue).toBe(0);
        });
    });

    // ─── separate (location inheritance) ──────────────────────────────────────

    describe('separate (location inheritance from container)', () => {
        test('separated resource inherits container currentLocation when no explicit toLocation', () => {
            observer.seedResource({
                id: 'crate',
                conformsTo: 'spec:crate',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:factory',
            });
            observer.seedResource({
                id: 'part',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'crate',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'part',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            expect(observer.getResource('part')!.currentLocation).toBe('loc:factory');
        });

        test('explicit toLocation overrides container location', () => {
            observer.seedResource({
                id: 'crate',
                conformsTo: 'spec:crate',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:factory',
            });
            observer.seedResource({
                id: 'part',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'crate',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'part',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                toLocation: 'loc:shelf',
            });

            expect(observer.getResource('part')!.currentLocation).toBe('loc:shelf');
        });

        test('no container location → part location stays undefined', () => {
            observer.seedResource({
                id: 'crate',
                conformsTo: 'spec:crate',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                // no currentLocation
            });
            observer.seedResource({
                id: 'part',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'crate',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'part',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            expect(observer.getResource('part')!.currentLocation).toBeUndefined();
        });

        test('containedIn cleared after separate', () => {
            observer.seedResource({
                id: 'crate',
                conformsTo: 'spec:crate',
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                currentLocation: 'loc:factory',
            });
            observer.seedResource({
                id: 'part',
                conformsTo: 'spec:part',
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'each' },
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
                containedIn: 'crate',
            });

            observer.record({
                id: 'e1',
                action: 'separate',
                resourceInventoriedAs: 'part',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'each' },
            });

            expect(observer.getResource('part')!.containedIn).toBeUndefined();
        });
    });

    // ─── Transport end-to-end (Pattern 1 — implied custody transfer) ──────────

    describe('transport end-to-end: pickup → dropoff with split inventory', () => {
        test('three-party transport correctly tracks onhand across all resources', () => {
            // Alice has 8 kg apples at warehouse
            observer.seedResource({
                id: 'alice-apples',
                conformsTo: 'spec:apple',
                accountingQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                currentLocation: 'loc:warehouse',
                primaryAccountable: 'agent:alice',
            });

            // Step 1 — Trucker picks up 8 kg (split-custody: provider=Alice, receiver=Trucker)
            observer.record({
                id: 'e1',
                action: 'pickup',
                provider: 'agent:alice',
                receiver: 'agent:trucker',
                resourceInventoriedAs: 'alice-apples',
                toResourceInventoriedAs: 'bill-of-lading',
                resourceConformsTo: 'spec:apple',
                resourceQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                toLocation: 'loc:truck',
            });

            // Alice's stock: onhand gone, location unchanged, accounting intact (she still owns them)
            expect(observer.getResource('alice-apples')!.onhandQuantity?.hasNumericalValue).toBe(0);
            expect(observer.getResource('alice-apples')!.accountingQuantity?.hasNumericalValue).toBe(8);
            expect(observer.getResource('alice-apples')!.currentLocation).toBe('loc:warehouse');

            // Bill of lading: Trucker has custody (onhand=8, at truck)
            expect(observer.getResource('bill-of-lading')!.onhandQuantity?.hasNumericalValue).toBe(8);
            expect(observer.getResource('bill-of-lading')!.currentLocation).toBe('loc:truck');
            expect(observer.getResource('bill-of-lading')!.primaryAccountable).toBe('agent:trucker');

            // Step 2 — Trucker drops off at Bob's shop (split-custody: provider=Trucker, receiver=Bob)
            observer.record({
                id: 'e2',
                action: 'dropoff',
                provider: 'agent:trucker',
                receiver: 'agent:bob',
                resourceInventoriedAs: 'bill-of-lading',
                toResourceInventoriedAs: 'bob-stock',
                resourceConformsTo: 'spec:apple',
                resourceQuantity: { hasNumericalValue: 8, hasUnit: 'kg' },
                toLocation: 'loc:shop',
            });

            // Bill of lading: trucker released custody (onhand=0)
            expect(observer.getResource('bill-of-lading')!.onhandQuantity?.hasNumericalValue).toBe(0);

            // Bob's stock: goods arrived (onhand=8, at shop)
            expect(observer.getResource('bob-stock')!.onhandQuantity?.hasNumericalValue).toBe(8);
            expect(observer.getResource('bob-stock')!.currentLocation).toBe('loc:shop');
            expect(observer.getResource('bob-stock')!.primaryAccountable).toBe('agent:bob');

            // Alice's stock: still accountable (ownership unchanged by transport)
            expect(observer.getResource('alice-apples')!.accountingQuantity?.hasNumericalValue).toBe(8);
            expect(observer.getResource('alice-apples')!.onhandQuantity?.hasNumericalValue).toBe(0);
        });
    });
});
