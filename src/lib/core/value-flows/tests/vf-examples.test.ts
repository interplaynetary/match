/**
 * VF Documentation Examples — Integration Tests
 *
 * Each describe block corresponds to an example diagram from:
 *   src/docs/valueflows/mkdocs/docs/assets/examples/
 *
 * Tests verify that the Observer correctly handles the VF patterns shown in
 * the official documentation examples. Covered examples:
 *
 *   xfer-crypto      — simple transfer of a digital asset
 *   move-crypto      — move asset within the same agent
 *   proc-mfg         — manufacturing process (cite + use + consume → produce)
 *   correction       — correcting wrong event entries
 *   exch-pos         — point-of-sale exchange (two-legged transfer)
 *   transport-transfer Pattern 1 — explicit transferCustody multi-hop
 *   transport-transfer Pattern 2 — pickup/dropoff split-custody
 *   pack-unpack      — combine/separate with custody transfer
 *   stage-state      — stage/state transitions via accept+modify
 *   proc-workflow    — service workflow (accept+modify)
 *   proc-svc         — deliverService to multiple receivers
 *   claim            — work → claim → transfer settlement
 *   book             — transfer with return-claim fulfillment
 *   ful-sat          — fulfillment and satisfaction tracking
 *   exch-commit      — exchange commitments
 *   simple-plan      — multi-process printing chain
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { Observer } from '../observation/observer';

describe('VF Documentation Examples', () => {
    let observer: Observer;

    beforeEach(() => {
        observer = new Observer();
    });

    // ── xfer-crypto ────────────────────────────────────────────────────────────
    // Diagram: Alice's wallet → transfer 100 FairCoin → Bob's wallet

    describe('xfer-crypto: transfer digital asset', () => {
        test('transfer 100 FairCoin from Alice to Bob: Alice decrements, Bob increments', () => {
            observer.seedResource({
                id: 'wallet:alice',
                conformsTo: 'spec:faircoin',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'FC' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'FC' },
                primaryAccountable: 'agent:alice',
            });

            observer.record({
                id: 'evt:xfer-faircoin',
                action: 'transfer',
                resourceInventoriedAs: 'wallet:alice',
                toResourceInventoriedAs: 'wallet:bob',
                resourceQuantity: { hasNumericalValue: 100, hasUnit: 'FC' },
                provider: 'agent:alice',
                receiver: 'agent:bob',
            });

            const alice = observer.getResource('wallet:alice')!;
            const bob   = observer.getResource('wallet:bob')!;

            expect(alice.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(alice.onhandQuantity?.hasNumericalValue).toBe(0);
            expect(bob.accountingQuantity?.hasNumericalValue).toBe(100);
            expect(bob.onhandQuantity?.hasNumericalValue).toBe(100);
        });

        test('receiver resource is auto-created on transfer', () => {
            observer.seedResource({
                id: 'wallet:alice',
                conformsTo: 'spec:faircoin',
                accountingQuantity: { hasNumericalValue: 50, hasUnit: 'FC' },
                onhandQuantity: { hasNumericalValue: 50, hasUnit: 'FC' },
            });

            observer.record({
                id: 'evt:xfer2',
                action: 'transfer',
                resourceInventoriedAs: 'wallet:alice',
                toResourceInventoriedAs: 'wallet:carol',
                resourceQuantity: { hasNumericalValue: 20, hasUnit: 'FC' },
                provider: 'agent:alice',
                receiver: 'agent:carol',
            });

            expect(observer.getResource('wallet:carol')).not.toBeNull();
            expect(observer.getResource('wallet:carol')!.accountingQuantity?.hasNumericalValue).toBe(20);
        });
    });

    // ── move-crypto ────────────────────────────────────────────────────────────
    // Diagram: hot wallet → move 50 FairCoin → cold wallet (same agent)

    describe('move-crypto: move asset within same agent', () => {
        test('move 50 FairCoin from hot to cold wallet: both accounting AND onhand change', () => {
            observer.seedResource({
                id: 'wallet:hot',
                conformsTo: 'spec:faircoin',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'FC' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'FC' },
            });

            observer.record({
                id: 'evt:move-crypto',
                action: 'move',
                resourceInventoriedAs: 'wallet:hot',
                toResourceInventoriedAs: 'wallet:cold',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'FC' },
            });

            const hot  = observer.getResource('wallet:hot')!;
            const cold = observer.getResource('wallet:cold')!;

            // move: decrementIncrement on both accounting and onhand
            expect(hot.accountingQuantity?.hasNumericalValue).toBe(50);
            expect(hot.onhandQuantity?.hasNumericalValue).toBe(50);
            expect(cold.accountingQuantity?.hasNumericalValue).toBe(50);
            expect(cold.onhandQuantity?.hasNumericalValue).toBe(50);
        });
    });

    // ── proc-mfg ──────────────────────────────────────────────────────────────
    // Diagram: work 7h + cite design + use CNC 3.5h + consume 3 plywood → produce 1 lean desk

    describe('proc-mfg: manufacturing lean desk', () => {
        test('cite desk design does not change resource quantity', () => {
            observer.seedResource({
                id: 'res:design',
                conformsTo: 'spec:desk-design',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:cite-design',
                action: 'cite',
                resourceInventoriedAs: 'res:design',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:make-desk',
            });

            const design = observer.getResource('res:design')!;
            expect(design.accountingQuantity?.hasNumericalValue).toBe(1);
            expect(design.onhandQuantity?.hasNumericalValue).toBe(1);
        });

        test('use CNC machine does not change machine quantity', () => {
            observer.seedResource({
                id: 'res:cnc',
                conformsTo: 'spec:cnc-machine',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:use-cnc',
                action: 'use',
                resourceInventoriedAs: 'res:cnc',
                effortQuantity: { hasNumericalValue: 3.5, hasUnit: 'hour' },
                inputOf: 'proc:make-desk',
            });

            const cnc = observer.getResource('res:cnc')!;
            expect(cnc.accountingQuantity?.hasNumericalValue).toBe(1);
            expect(cnc.onhandQuantity?.hasNumericalValue).toBe(1);
        });

        test('work event does not affect inventory (labor is effort-only)', () => {
            // work: eventQuantity = effortQuantity, all effects = noEffect
            observer.record({
                id: 'evt:work-7h',
                action: 'work',
                effortQuantity: { hasNumericalValue: 7, hasUnit: 'hour' },
                inputOf: 'proc:make-desk',
            });

            // No resource referenced — no side-effects, event is recorded
            const allEvents = observer.eventsForResource('res:nonexistent');
            expect(allEvents.length).toBe(0); // worker resource not referenced
        });

        test('consume 3 plywood sheets decrements quantity', () => {
            observer.seedResource({
                id: 'res:plywood',
                conformsTo: 'spec:plywood',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:consume-plywood',
                action: 'consume',
                resourceInventoriedAs: 'res:plywood',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'ea' },
                inputOf: 'proc:make-desk',
            });

            const plywood = observer.getResource('res:plywood')!;
            expect(plywood.accountingQuantity?.hasNumericalValue).toBe(7);
            expect(plywood.onhandQuantity?.hasNumericalValue).toBe(7);
        });

        test('produce 1 lean desk creates and increments output resource', () => {
            observer.record({
                id: 'evt:produce-desk',
                action: 'produce',
                resourceInventoriedAs: 'res:lean-desk',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:make-desk',
            });

            const desk = observer.getResource('res:lean-desk')!;
            expect(desk).not.toBeNull();
            expect(desk.accountingQuantity?.hasNumericalValue).toBe(1);
            expect(desk.onhandQuantity?.hasNumericalValue).toBe(1);
        });

        test('full manufacturing process: net resource effects', () => {
            observer.seedResource({
                id: 'res:design',
                conformsTo: 'spec:desk-design',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });
            observer.seedResource({
                id: 'res:cnc',
                conformsTo: 'spec:cnc-machine',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });
            observer.seedResource({
                id: 'res:plywood',
                conformsTo: 'spec:plywood',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            });

            observer.record({ id: 'e1', action: 'work',
                effortQuantity: { hasNumericalValue: 7, hasUnit: 'hour' },
                inputOf: 'proc:make-desk' });
            observer.record({ id: 'e2', action: 'cite',
                resourceInventoriedAs: 'res:design',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:make-desk' });
            observer.record({ id: 'e3', action: 'use',
                resourceInventoriedAs: 'res:cnc',
                effortQuantity: { hasNumericalValue: 3.5, hasUnit: 'hour' },
                inputOf: 'proc:make-desk' });
            observer.record({ id: 'e4', action: 'consume',
                resourceInventoriedAs: 'res:plywood',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'ea' },
                inputOf: 'proc:make-desk' });
            observer.record({ id: 'e5', action: 'produce',
                resourceInventoriedAs: 'res:lean-desk',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:make-desk' });

            expect(observer.getResource('res:design')!.accountingQuantity?.hasNumericalValue).toBe(1);  // cite: no effect
            expect(observer.getResource('res:cnc')!.accountingQuantity?.hasNumericalValue).toBe(1);     // use: no effect
            expect(observer.getResource('res:plywood')!.accountingQuantity?.hasNumericalValue).toBe(7); // 10 - 3
            expect(observer.getResource('res:lean-desk')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });
    });

    // ── correction ─────────────────────────────────────────────────────────────
    // Diagram: work 7h corrected by work -1h; consume 3 corrected then replaced by consume 5

    describe('correction: fixing wrong event entries', () => {
        test('correction replaces original event: negate original + apply new', () => {
            // Based on observer.test.ts: "oops it was actually 8" → produce 8 corrects produce 10 → net = 8
            observer.record({
                id: 'e-orig',
                action: 'produce',
                resourceInventoriedAs: 'res:output',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
                outputOf: 'proc:make-desk',
            });

            expect(observer.getResource('res:output')!.accountingQuantity?.hasNumericalValue).toBe(10);

            observer.record({
                id: 'e-corr',
                action: 'produce',
                resourceInventoriedAs: 'res:output',
                resourceQuantity: { hasNumericalValue: 8, hasUnit: 'ea' },
                corrects: 'e-orig',
                outputOf: 'proc:make-desk',
            });

            // negate +10, apply +8 → net = 8
            expect(observer.getResource('res:output')!.accountingQuantity?.hasNumericalValue).toBe(8);
        });

        test('consume correction: original 3 corrected to 5 (like correction.xml consume sequence)', () => {
            observer.seedResource({
                id: 'res:plywood',
                conformsTo: 'spec:plywood',
                accountingQuantity: { hasNumericalValue: 20, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 20, hasUnit: 'ea' },
            });

            // Original consume 3
            observer.record({
                id: 'e-consume-orig',
                action: 'consume',
                resourceInventoriedAs: 'res:plywood',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'ea' },
                inputOf: 'proc:make-desk',
            });
            expect(observer.getResource('res:plywood')!.accountingQuantity?.hasNumericalValue).toBe(17);

            // Correction: the actual quantity was 5 (not 3) — replaces the original
            observer.record({
                id: 'e-consume-corr',
                action: 'consume',
                resourceInventoriedAs: 'res:plywood',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
                corrects: 'e-consume-orig',
                inputOf: 'proc:make-desk',
            });

            // negate consume 3 (→ +3 → 20), apply consume 5 (→ -5 → 15)
            expect(observer.getResource('res:plywood')!.accountingQuantity?.hasNumericalValue).toBe(15);
        });

        test('corrected event is superseded: only one active event remains', () => {
            observer.record({
                id: 'e-w1',
                action: 'produce',
                resourceInventoriedAs: 'res:output',
                resourceQuantity: { hasNumericalValue: 7, hasUnit: 'ea' },
            });
            observer.record({
                id: 'e-w2',
                action: 'produce',
                resourceInventoriedAs: 'res:output',
                resourceQuantity: { hasNumericalValue: 6, hasUnit: 'ea' },
                corrects: 'e-w1',
            });

            const events = observer.eventsForResource('res:output');
            const active = events.filter(e => !events.some(x => x.corrects === e.id));
            expect(active.length).toBe(1);
            expect(active[0].id).toBe('e-w2');
        });
    });

    // ── exch-pos ───────────────────────────────────────────────────────────────
    // Diagram: Carol's bank account → transfer $5 → Store; Store → transfer 1 bucket → Carol
    // Both events are part of the same Agreement

    describe('exch-pos: point-of-sale exchange', () => {
        test('two-legged exchange: Carol pays $5, Store delivers 1 bucket', () => {
            observer.seedResource({
                id: 'res:carol-cash',
                conformsTo: 'spec:usd',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'USD' },
                primaryAccountable: 'agent:carol',
            });
            observer.seedResource({
                id: 'res:store-buckets',
                conformsTo: 'spec:bucket',
                accountingQuantity: { hasNumericalValue: 50, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 50, hasUnit: 'ea' },
                primaryAccountable: 'agent:store',
            });

            // Leg 1: Carol transfers $5 to Store
            observer.record({
                id: 'evt:pay',
                action: 'transfer',
                resourceInventoriedAs: 'res:carol-cash',
                toResourceInventoriedAs: 'res:store-cash',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'USD' },
                provider: 'agent:carol',
                receiver: 'agent:store',
            });

            // Leg 2: Store transfers 1 bucket to Carol
            observer.record({
                id: 'evt:deliver',
                action: 'transfer',
                resourceInventoriedAs: 'res:store-buckets',
                toResourceInventoriedAs: 'res:carol-bucket',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                provider: 'agent:store',
                receiver: 'agent:carol',
            });

            expect(observer.getResource('res:carol-cash')!.accountingQuantity?.hasNumericalValue).toBe(95);
            expect(observer.getResource('res:store-cash')!.accountingQuantity?.hasNumericalValue).toBe(5);
            expect(observer.getResource('res:store-buckets')!.accountingQuantity?.hasNumericalValue).toBe(49);
            expect(observer.getResource('res:carol-bucket')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('exchange commitments tracked via registerCommitment + fulfillment', () => {
            observer.registerCommitment({
                id: 'commit:pay',
                action: 'transfer',
                resourceConformsTo: 'spec:usd',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'USD' },
                finished: false,
            });
            observer.registerCommitment({
                id: 'commit:deliver',
                action: 'transfer',
                resourceConformsTo: 'spec:bucket',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                finished: false,
            });

            observer.record({
                id: 'evt:pay',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'USD' },
                fulfills: 'commit:pay',
            });
            observer.record({
                id: 'evt:deliver',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                fulfills: 'commit:deliver',
            });

            expect(observer.getFulfillment('commit:pay')?.finished).toBe(true);
            expect(observer.getFulfillment('commit:deliver')?.finished).toBe(true);
        });
    });

    // ── transport-transfer Pattern 1: explicit transferCustody multi-hop ────────
    // Diagram: Alice's apples → transferCustody Alice→Claudia →
    //          transferCustody Claudia→Bob → transfer Alice→Bob (ownership)
    //          + transfer $10 Alice→Claudia (freight)

    describe('transport-transfer Pattern 1: explicit transferCustody', () => {
        test('transferCustody changes onhand but NOT accounting', () => {
            observer.seedResource({
                id: 'res:apples-alice',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
            });

            // Hop 1: Alice hands custody to Claudia (first leg of transport)
            observer.record({
                id: 'evt:custody-alice-claudia',
                action: 'transferCustody',
                resourceInventoriedAs: 'res:apples-alice',
                toResourceInventoriedAs: 'res:apples-claudia',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:claudia',
            });

            const aliceApples = observer.getResource('res:apples-alice')!;
            const claudiaApples = observer.getResource('res:apples-claudia')!;

            // Accounting stays with Alice (title hasn't transferred)
            expect(aliceApples.accountingQuantity?.hasNumericalValue).toBe(30);
            expect(aliceApples.onhandQuantity?.hasNumericalValue).toBe(0);    // physically gone

            // Claudia has custody but NOT accounting title
            expect(claudiaApples.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(claudiaApples.onhandQuantity?.hasNumericalValue).toBe(30);
        });

        test('full transport chain: custody hops + final title transfer', () => {
            observer.seedResource({
                id: 'res:apples-alice',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
            });

            // Alice → Claudia (custody)
            observer.record({
                id: 'e1',
                action: 'transferCustody',
                resourceInventoriedAs: 'res:apples-alice',
                toResourceInventoriedAs: 'res:apples-claudia',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:claudia',
            });

            // Claudia → Bob (custody)
            observer.record({
                id: 'e2',
                action: 'transferCustody',
                resourceInventoriedAs: 'res:apples-claudia',
                toResourceInventoriedAs: 'res:apples-bob',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:claudia',
                receiver: 'agent:bob',
            });

            // Alice → Bob (title / accounting transfer)
            observer.record({
                id: 'e3',
                action: 'transferAllRights',
                resourceInventoriedAs: 'res:apples-alice',
                toResourceInventoriedAs: 'res:apples-bob',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:bob',
            });

            const alice   = observer.getResource('res:apples-alice')!;
            const claudia = observer.getResource('res:apples-claudia')!;
            const bob     = observer.getResource('res:apples-bob')!;

            expect(alice.accountingQuantity?.hasNumericalValue).toBe(0);    // title gone
            expect(alice.onhandQuantity?.hasNumericalValue).toBe(0);        // custody gone
            expect(claudia.accountingQuantity?.hasNumericalValue).toBe(0);  // never had title
            expect(claudia.onhandQuantity?.hasNumericalValue).toBe(0);      // custody handed to Bob
            expect(bob.accountingQuantity?.hasNumericalValue).toBe(30);     // has title
            expect(bob.onhandQuantity?.hasNumericalValue).toBe(30);         // has custody
        });

        test('freight payment: transfer $10 from Alice to Claudia', () => {
            observer.seedResource({
                id: 'res:alice-usd',
                conformsTo: 'spec:usd',
                accountingQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
                onhandQuantity: { hasNumericalValue: 50, hasUnit: 'USD' },
            });

            observer.record({
                id: 'evt:freight',
                action: 'transfer',
                resourceInventoriedAs: 'res:alice-usd',
                toResourceInventoriedAs: 'res:claudia-usd',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'USD' },
                provider: 'agent:alice',
                receiver: 'agent:claudia',
            });

            expect(observer.getResource('res:alice-usd')!.accountingQuantity?.hasNumericalValue).toBe(40);
            expect(observer.getResource('res:claudia-usd')!.accountingQuantity?.hasNumericalValue).toBe(10);
        });
    });

    // ── transport-transfer Pattern 2: pickup / dropoff split-custody ──────────
    // Diagram: Alice's apples → pickup (bill-of-lading created) → transport →
    //          dropoff (bill-of-lading settled, Bob receives)

    describe('transport-transfer Pattern 2: pickup/dropoff split-custody', () => {
        test('pickup: provider onhand decrements, trucker bill-of-lading auto-created', () => {
            observer.seedResource({
                id: 'res:apples-alice',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
                currentLocation: 'loc:origin',
            });

            observer.record({
                id: 'evt:pickup',
                action: 'pickup',
                resourceInventoriedAs: 'res:apples-alice',
                toResourceInventoriedAs: 'res:apples-truck',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:trucker',
                toLocation: 'loc:truck',
            });

            const aliceApples = observer.getResource('res:apples-alice')!;
            const truckApples = observer.getResource('res:apples-truck')!;

            // Alice's onhand decrements (physically picked up)
            expect(aliceApples.onhandQuantity?.hasNumericalValue).toBe(0);
            // Alice's accounting unchanged (she still owns them)
            expect(aliceApples.accountingQuantity?.hasNumericalValue).toBe(30);

            // Trucker's bill-of-lading auto-created with onhand quantity
            expect(truckApples).not.toBeNull();
            expect(truckApples.onhandQuantity?.hasNumericalValue).toBe(30);
            // Accounting is 0 on bill-of-lading (trucker doesn't own them)
            expect(truckApples.accountingQuantity?.hasNumericalValue).toBe(0);
        });

        test('dropoff: trucker bill-of-lading decrements, Bob receives onhand', () => {
            // Setup: bill-of-lading already in trucker's custody after pickup
            observer.seedResource({
                id: 'res:apples-truck',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 0, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
                currentLocation: 'loc:truck',
            });

            observer.record({
                id: 'evt:dropoff',
                action: 'dropoff',
                resourceInventoriedAs: 'res:apples-truck',
                toResourceInventoriedAs: 'res:apples-bob',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:trucker',
                receiver: 'agent:bob',
                toLocation: 'loc:destination',
            });

            const truck = observer.getResource('res:apples-truck')!;
            const bob   = observer.getResource('res:apples-bob')!;

            // Trucker's bill-of-lading settles to 0
            expect(truck.onhandQuantity?.hasNumericalValue).toBe(0);

            // Bob's resource auto-created with onhand quantity
            expect(bob).not.toBeNull();
            expect(bob.onhandQuantity?.hasNumericalValue).toBe(30);
            expect(bob.currentLocation).toBe('loc:destination');
        });

        test('complete pickup → dropoff transport cycle', () => {
            observer.seedResource({
                id: 'res:apples-alice',
                conformsTo: 'spec:apples',
                accountingQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                onhandQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                primaryAccountable: 'agent:alice',
                currentLocation: 'loc:farm',
            });

            // Pickup: Alice → Trucker (split-custody)
            observer.record({
                id: 'evt:pickup',
                action: 'pickup',
                resourceInventoriedAs: 'res:apples-alice',
                toResourceInventoriedAs: 'res:apples-truck',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:trucker',
                toLocation: 'loc:truck',
            });

            // Dropoff: Trucker → Bob (split-custody)
            observer.record({
                id: 'evt:dropoff',
                action: 'dropoff',
                resourceInventoriedAs: 'res:apples-truck',
                toResourceInventoriedAs: 'res:apples-bob',
                resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
                provider: 'agent:trucker',
                receiver: 'agent:bob',
                toLocation: 'loc:market',
            });

            // Alice keeps accounting title until separate ownership transfer
            expect(observer.getResource('res:apples-alice')!.accountingQuantity?.hasNumericalValue).toBe(30);
            expect(observer.getResource('res:apples-alice')!.onhandQuantity?.hasNumericalValue).toBe(0);

            // Truck bill-of-lading is settled
            expect(observer.getResource('res:apples-truck')!.onhandQuantity?.hasNumericalValue).toBe(0);

            // Bob has physical custody
            expect(observer.getResource('res:apples-bob')!.onhandQuantity?.hasNumericalValue).toBe(30);
            expect(observer.getResource('res:apples-bob')!.currentLocation).toBe('loc:market');
        });
    });

    // ── pack-unpack ────────────────────────────────────────────────────────────
    // Diagram: 3 medical gowns combined into container1 (accept→modify) →
    //          transferCustody container → unpack gowns (accept→modify→separate)

    describe('pack-unpack: combine/separate workflow', () => {
        test('combine (pack) sets containedIn on each gown', () => {
            observer.seedResource({
                id: 'res:gown-1', conformsTo: 'spec:gown',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:pack-gown-1',
                action: 'combine',
                resourceInventoriedAs: 'res:gown-1',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                toResourceInventoriedAs: 'res:container-1',
                inputOf: 'proc:pack',
            });

            const gown = observer.getResource('res:gown-1')!;
            // combine: decrement onhand (resource is now inside container)
            expect(gown.onhandQuantity?.hasNumericalValue).toBe(0);
            // containedIn set to the container
            expect(gown.containedIn).toBe('res:container-1');
        });

        test('separate (unpack) clears containedIn and increments onhand', () => {
            observer.seedResource({
                id: 'res:gown-2',
                conformsTo: 'spec:gown',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'ea' }, // packed
                containedIn: 'res:container-1',
            });

            observer.record({
                id: 'evt:unpack-gown-2',
                action: 'separate',
                resourceInventoriedAs: 'res:gown-2',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:unpack',
            });

            const gown = observer.getResource('res:gown-2')!;
            // separate: increment onhand, clear containedIn
            expect(gown.onhandQuantity?.hasNumericalValue).toBe(1);
            expect(gown.containedIn).toBeUndefined();
        });

        test('separate inherits container location', () => {
            observer.seedResource({
                id: 'res:container-1',
                conformsTo: 'spec:container',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                currentLocation: 'loc:hospital',
            });
            observer.seedResource({
                id: 'res:gown-3',
                conformsTo: 'spec:gown',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'ea' },
                containedIn: 'res:container-1',
            });

            observer.record({
                id: 'evt:unpack-gown-3',
                action: 'separate',
                resourceInventoriedAs: 'res:gown-3',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:unpack',
            });

            const gown = observer.getResource('res:gown-3')!;
            // separate: inherits container's currentLocation
            expect(gown.currentLocation).toBe('loc:hospital');
        });

        test('transferCustody of packed container moves onhand', () => {
            observer.seedResource({
                id: 'res:container-1',
                conformsTo: 'spec:container',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                currentLocation: 'loc:warehouse',
            });

            observer.record({
                id: 'evt:transfer-custody-container',
                action: 'transferCustody',
                resourceInventoriedAs: 'res:container-1',
                toResourceInventoriedAs: 'res:container-1-dest',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                provider: 'agent:shipper',
                receiver: 'agent:hospital',
                toLocation: 'loc:hospital',
            });

            const src = observer.getResource('res:container-1')!;
            const dst = observer.getResource('res:container-1-dest')!;

            expect(src.onhandQuantity?.hasNumericalValue).toBe(0);
            expect(dst.onhandQuantity?.hasNumericalValue).toBe(1);
            expect(dst.currentLocation).toBe('loc:hospital');
        });
    });

    // ── stage-state ────────────────────────────────────────────────────────────
    // Diagram: produce 500/1000 buckets → accept → modify (pass/fail stage) →
    //          produce polymer scrap (from failed buckets)

    describe('stage-state: injection molding quality transitions', () => {
        test('produce buckets: creates resource with no stage', () => {
            observer.record({
                id: 'evt:produce-500',
                action: 'produce',
                resourceInventoriedAs: 'res:buckets',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'ea' },
                outputOf: 'proc:make-buckets',
            });

            const buckets = observer.getResource('res:buckets')!;
            expect(buckets.accountingQuantity?.hasNumericalValue).toBe(500);
            expect(buckets.stage).toBeUndefined();
        });

        test('accept takes buckets into QC: decrements onhand (in-process)', () => {
            observer.seedResource({
                id: 'res:buckets',
                conformsTo: 'spec:bucket',
                accountingQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:accept-buckets',
                action: 'accept',
                resourceInventoriedAs: 'res:buckets',
                resourceQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
                inputOf: 'proc:qc',
            });

            // accept: decrement onhand (resource is now in-process)
            // accept.stageEffect = 'noEffect' — stage is NOT changed by accept
            const buckets = observer.getResource('res:buckets')!;
            expect(buckets.onhandQuantity?.hasNumericalValue).toBe(0);
            expect(buckets.accountingQuantity?.hasNumericalValue).toBe(1000); // accounting unchanged
        });

        test('modify with pass state marks resource as passed (state via event.state)', () => {
            observer.seedResource({
                id: 'res:buckets',
                conformsTo: 'spec:bucket',
                accountingQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'ea' }, // in process
                state: 'awaiting-qc',
            });

            observer.record({
                id: 'evt:modify-pass',
                action: 'modify',
                resourceInventoriedAs: 'res:buckets',
                resourceQuantity: { hasNumericalValue: 800, hasUnit: 'ea' },
                state: 'pass',          // event.state → resource.state (stateEffect: 'update')
                outputOf: 'proc:qc',
            });

            // modify: increment onhand, update state
            const buckets = observer.getResource('res:buckets')!;
            expect(buckets.onhandQuantity?.hasNumericalValue).toBe(800);
            expect(buckets.state).toBe('pass');
        });

        test('modify sets stage via registered process.basedOn', () => {
            // stage is read from process.basedOn, not from event.stage
            observer.registerProcess({ id: 'proc:qc-stage', basedOn: 'pspec:qc-pass', name: 'QC Pass' });
            observer.seedResource({
                id: 'res:buckets-staged',
                conformsTo: 'spec:bucket',
                accountingQuantity: { hasNumericalValue: 500, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:modify-stage',
                action: 'modify',
                resourceInventoriedAs: 'res:buckets-staged',
                resourceQuantity: { hasNumericalValue: 500, hasUnit: 'ea' },
                outputOf: 'proc:qc-stage',   // process.basedOn = 'pspec:qc-pass'
            });

            const buckets = observer.getResource('res:buckets-staged')!;
            expect(buckets.stage).toBe('pspec:qc-pass');  // set from process.basedOn
        });

        test('failed buckets produce polymer scrap resource', () => {
            observer.record({
                id: 'evt:produce-polymer',
                action: 'produce',
                resourceInventoriedAs: 'res:polymer-scrap',
                resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
                outputOf: 'proc:qc',
            });

            const scrap = observer.getResource('res:polymer-scrap')!;
            expect(scrap.accountingQuantity?.hasNumericalValue).toBe(200);
            // stage is only set when process has basedOn — without it, stage stays undefined
            expect(scrap.stage).toBeUndefined();
        });
    });

    // ── proc-workflow ──────────────────────────────────────────────────────────
    // Diagram: accept Alice's car → "Change the oil" process → modify Alice's car

    describe('proc-workflow: car service with accept/modify', () => {
        test('accept takes car into service (onhand decrements)', () => {
            observer.seedResource({
                id: 'res:alice-car',
                conformsTo: 'spec:car',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                primaryAccountable: 'agent:alice',
            });

            observer.record({
                id: 'evt:accept-car',
                action: 'accept',
                resourceInventoriedAs: 'res:alice-car',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:oil-change',
            });

            const car = observer.getResource('res:alice-car')!;
            expect(car.onhandQuantity?.hasNumericalValue).toBe(0);      // in the shop
            expect(car.accountingQuantity?.hasNumericalValue).toBe(1);  // Alice still owns it
        });

        test('modify returns serviced car (onhand increments, state updated)', () => {
            observer.seedResource({
                id: 'res:alice-car',
                conformsTo: 'spec:car',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 0, hasUnit: 'ea' }, // in shop
                state: 'needs-service',
            });

            observer.record({
                id: 'evt:modify-car',
                action: 'modify',
                resourceInventoriedAs: 'res:alice-car',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                state: 'serviced',
                outputOf: 'proc:oil-change',
            });

            const car = observer.getResource('res:alice-car')!;
            expect(car.onhandQuantity?.hasNumericalValue).toBe(1);  // returned
            expect(car.state).toBe('serviced');
        });

        test('accept + modify round-trip: car returns with new state', () => {
            observer.seedResource({
                id: 'res:alice-car',
                conformsTo: 'spec:car',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                state: 'needs-oil-change',
            });

            observer.record({ id: 'e1', action: 'accept',
                resourceInventoriedAs: 'res:alice-car',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:oil-change' });

            observer.record({ id: 'e2', action: 'modify',
                resourceInventoriedAs: 'res:alice-car',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                state: 'oil-changed',
                outputOf: 'proc:oil-change' });

            const car = observer.getResource('res:alice-car')!;
            expect(car.onhandQuantity?.hasNumericalValue).toBe(1);   // back with owner
            expect(car.accountingQuantity?.hasNumericalValue).toBe(1); // unchanged
            expect(car.state).toBe('oil-changed');
        });
    });

    // ── proc-svc ───────────────────────────────────────────────────────────────
    // Diagram: use 3D printer 8h + consume 3 handouts + work 8h →
    //          deliverService to Bob, Alice, Carol

    describe('proc-svc: deliverService to multiple receivers', () => {
        test('consume handouts: decrements inventory', () => {
            observer.seedResource({
                id: 'res:handouts',
                conformsTo: 'spec:handout',
                accountingQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:consume-handouts',
                action: 'consume',
                resourceInventoriedAs: 'res:handouts',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'ea' },
                inputOf: 'proc:workshop',
            });

            expect(observer.getResource('res:handouts')!.accountingQuantity?.hasNumericalValue).toBe(7);
        });

        test('use 3D printer: no quantity change', () => {
            observer.seedResource({
                id: 'res:3d-printer',
                conformsTo: 'spec:3d-printer',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });

            observer.record({
                id: 'evt:use-printer',
                action: 'use',
                resourceInventoriedAs: 'res:3d-printer',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hour' },
                inputOf: 'proc:workshop',
            });

            expect(observer.getResource('res:3d-printer')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('deliverService records service events for each receiver', () => {
            // deliverService: no inventory effect, just records the service delivery
            observer.record({
                id: 'evt:svc-bob',
                action: 'deliverService',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'day' },
                receiver: 'agent:bob',
                outputOf: 'proc:workshop',
            });
            observer.record({
                id: 'evt:svc-alice',
                action: 'deliverService',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'day' },
                receiver: 'agent:alice',
                outputOf: 'proc:workshop',
            });
            observer.record({
                id: 'evt:svc-carol',
                action: 'deliverService',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'day' },
                receiver: 'agent:carol',
                outputOf: 'proc:workshop',
            });

            // Events are recorded (no exception thrown)
            // inventory unchanged since deliverService has no resource effect
            expect(observer.inventory().length).toBe(0);
        });
    });

    // ── claim ──────────────────────────────────────────────────────────────────
    // Diagram: work 7h by Bob → claim for transfer of 140 CAD →
    //          transfer 70 CAD to Bob (partial settlement)

    describe('claim: work generates claim, partial transfer settlement', () => {
        test('work event generates a claim; transfer partially settles it', () => {
            observer.registerClaim({
                id: 'claim:bob-labor',
                action: 'transfer',
                resourceConformsTo: 'spec:cad',
                resourceQuantity: { hasNumericalValue: 140, hasUnit: 'CAD' },
                triggeredBy: 'evt:work-bob',
                finished: false,
            });

            // Work event that triggered the claim
            observer.record({
                id: 'evt:work-bob',
                action: 'work',
                effortQuantity: { hasNumericalValue: 7, hasUnit: 'hour' },
                inputOf: 'proc:machining',
            });

            // Partial settlement: transfer 70 CAD
            observer.record({
                id: 'evt:pay-bob-partial',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 70, hasUnit: 'CAD' },
                settles: 'claim:bob-labor',
            });

            const claimState = observer.getClaimState('claim:bob-labor')!;
            expect(claimState.totalClaimed.hasNumericalValue).toBe(140);
            expect(claimState.totalSettled.hasNumericalValue).toBe(70);
            expect(claimState.finished).toBe(false); // still 70 outstanding
        });

        test('full settlement marks claim as finished', () => {
            observer.registerClaim({
                id: 'claim:bob-full',
                action: 'transfer',
                resourceConformsTo: 'spec:cad',
                resourceQuantity: { hasNumericalValue: 140, hasUnit: 'CAD' },
                finished: false,
            });

            observer.record({
                id: 'evt:pay-full',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 140, hasUnit: 'CAD' },
                settles: 'claim:bob-full',
            });

            expect(observer.getClaimState('claim:bob-full')!.finished).toBe(true);
        });
    });

    // ── book ───────────────────────────────────────────────────────────────────
    // Diagram: transfer book to Bob → claim return to library →
    //          transfer book back to library (settles claim)

    describe('book: library loan with return claim', () => {
        test('loan out: transfer book from library to Bob', () => {
            observer.seedResource({
                id: 'res:book',
                conformsTo: 'spec:book-isbn-1234',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                primaryAccountable: 'agent:library',
            });

            observer.record({
                id: 'evt:loan-out',
                action: 'transfer',
                resourceInventoriedAs: 'res:book',
                toResourceInventoriedAs: 'res:book-bob',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                provider: 'agent:library',
                receiver: 'agent:bob',
            });

            expect(observer.getResource('res:book')!.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(observer.getResource('res:book-bob')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('return claim + book transfer settles the claim', () => {
            observer.registerClaim({
                id: 'claim:return-book',
                action: 'transfer',
                resourceConformsTo: 'spec:book-isbn-1234',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                finished: false,
            });

            observer.seedResource({
                id: 'res:book-bob',
                conformsTo: 'spec:book-isbn-1234',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                primaryAccountable: 'agent:bob',
            });

            // Bob returns the book to library
            observer.record({
                id: 'evt:return-book',
                action: 'transfer',
                resourceInventoriedAs: 'res:book-bob',
                toResourceInventoriedAs: 'res:book-library',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                provider: 'agent:bob',
                receiver: 'agent:library',
                settles: 'claim:return-book',
            });

            const claim = observer.getClaimState('claim:return-book')!;
            expect(claim.totalSettled.hasNumericalValue).toBe(1);
            expect(claim.finished).toBe(true);

            expect(observer.getResource('res:book-bob')!.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(observer.getResource('res:book-library')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });
    });

    // ── ful-sat ────────────────────────────────────────────────────────────────
    // Diagram: intent to work 8h → commitment to work 8h (satisfies intent) →
    //          work 4h + work 4h (events fulfill commitment)

    describe('ful-sat: fulfillment and satisfaction tracking', () => {
        test('intent registered: satisfaction state initialized with totalDesired', () => {
            observer.registerIntent({
                id: 'intent:work-8h',
                action: 'work',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hour' },
                finished: false,
            });
            observer.registerCommitment({
                id: 'commit:work-8h',
                action: 'work',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hour' },
                satisfies: 'intent:work-8h',
                finished: false,
            });

            // Intent satisfaction state is tracked; commitment creates fulfillment state
            const sat = observer.getSatisfaction('intent:work-8h');
            expect(sat).not.toBeUndefined();
            expect(sat!.totalDesired.hasNumericalValue).toBe(8);
            expect(sat!.totalSatisfied.hasNumericalValue).toBe(0);  // no events yet

            // Commitment is tracked as fulfillment independently
            const ful = observer.getFulfillment('commit:work-8h');
            expect(ful).not.toBeUndefined();
            expect(ful!.totalCommitted.hasNumericalValue).toBe(8);
        });

        test('two partial events together fully fulfill a commitment', () => {
            observer.registerCommitment({
                id: 'commit:work-8h',
                action: 'work',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hour' },
                finished: false,
            });

            observer.record({
                id: 'evt:work-4h-a',
                action: 'work',
                effortQuantity: { hasNumericalValue: 4, hasUnit: 'hour' },
                fulfills: 'commit:work-8h',
            });

            let f = observer.getFulfillment('commit:work-8h');
            expect(f!.totalFulfilled.hasNumericalValue).toBe(4);
            expect(f!.finished).toBe(false);

            observer.record({
                id: 'evt:work-4h-b',
                action: 'work',
                effortQuantity: { hasNumericalValue: 4, hasUnit: 'hour' },
                fulfills: 'commit:work-8h',
            });

            f = observer.getFulfillment('commit:work-8h');
            expect(f!.totalFulfilled.hasNumericalValue).toBe(8);
            expect(f!.finished).toBe(true);
        });

        test('event satisfies intent directly (no commitment intermediary)', () => {
            observer.registerIntent({
                id: 'intent:produce-1-desk',
                action: 'produce',
                resourceConformsTo: 'spec:lean-desk',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                finished: false,
            });

            observer.record({
                id: 'evt:produce-desk',
                action: 'produce',
                resourceInventoriedAs: 'res:lean-desk',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                satisfies: 'intent:produce-1-desk',
            });

            const sat = observer.getSatisfaction('intent:produce-1-desk');
            expect(sat!.totalSatisfied.hasNumericalValue).toBe(1);
            expect(sat!.finished).toBe(true);
        });
    });

    // ── exch-commit ────────────────────────────────────────────────────────────
    // Diagram: Agreement → commitment (Alice transfers 50kg apples to Bob) +
    //                       commitment (Bob transfers 10L cider to Alice)

    describe('exch-commit: exchange commitments tracking', () => {
        test('two exchange commitments registered and tracked independently', () => {
            observer.registerCommitment({
                id: 'commit:apples-to-bob',
                action: 'transfer',
                resourceConformsTo: 'spec:apples',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                provider: 'agent:alice',
                receiver: 'agent:bob',
                finished: false,
            });
            observer.registerCommitment({
                id: 'commit:cider-to-alice',
                action: 'transfer',
                resourceConformsTo: 'spec:cider',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'L' },
                provider: 'agent:bob',
                receiver: 'agent:alice',
                finished: false,
            });

            const apples = observer.getFulfillment('commit:apples-to-bob')!;
            const cider  = observer.getFulfillment('commit:cider-to-alice')!;

            expect(apples.totalCommitted.hasNumericalValue).toBe(50);
            expect(cider.totalCommitted.hasNumericalValue).toBe(10);
            expect(apples.finished).toBe(false);
            expect(cider.finished).toBe(false);
        });

        test('fulfilling one commitment does not affect the other', () => {
            observer.registerCommitment({
                id: 'commit:apples',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                finished: false,
            });
            observer.registerCommitment({
                id: 'commit:cider',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'L' },
                finished: false,
            });

            observer.record({
                id: 'evt:apples-transfer',
                action: 'transfer',
                resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
                fulfills: 'commit:apples',
            });

            expect(observer.getFulfillment('commit:apples')!.finished).toBe(true);
            expect(observer.getFulfillment('commit:cider')!.finished).toBe(false);
        });
    });

    // ── simple-plan ────────────────────────────────────────────────────────────
    // Diagram: "Make printing plate" process → "Print posters" process →
    //          "Print brochures" process
    //   - Make plate: consume material → produce plate
    //   - Print posters: use plate + consume 35 sheets → produce 35 posters
    //   - Print brochures: consume 1020 sheets → produce 1000 brochures

    describe('simple-plan: multi-process printing chain', () => {
        test('Make printing plate: consume material → produce plate', () => {
            observer.seedResource({
                id: 'res:plate-material',
                conformsTo: 'spec:plate-material',
                accountingQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 5, hasUnit: 'ea' },
            });

            observer.record({
                id: 'e-consume-material',
                action: 'consume',
                resourceInventoriedAs: 'res:plate-material',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:make-plate',
            });
            observer.record({
                id: 'e-produce-plate',
                action: 'produce',
                resourceInventoriedAs: 'res:print-plate',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:make-plate',
            });

            expect(observer.getResource('res:plate-material')!.accountingQuantity?.hasNumericalValue).toBe(4);
            expect(observer.getResource('res:print-plate')!.accountingQuantity?.hasNumericalValue).toBe(1);
        });

        test('Print posters: use plate + consume sheets → produce posters', () => {
            observer.seedResource({
                id: 'res:print-plate',
                conformsTo: 'spec:print-plate',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });
            observer.seedResource({
                id: 'res:paper-sheets',
                conformsTo: 'spec:paper',
                accountingQuantity: { hasNumericalValue: 100, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 100, hasUnit: 'ea' },
            });

            observer.record({ id: 'e-use-plate', action: 'use',
                resourceInventoriedAs: 'res:print-plate',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:print-posters' });
            observer.record({ id: 'e-consume-sheets-posters', action: 'consume',
                resourceInventoriedAs: 'res:paper-sheets',
                resourceQuantity: { hasNumericalValue: 35, hasUnit: 'ea' },
                inputOf: 'proc:print-posters' });
            observer.record({ id: 'e-produce-posters', action: 'produce',
                resourceInventoriedAs: 'res:posters',
                resourceQuantity: { hasNumericalValue: 35, hasUnit: 'ea' },
                outputOf: 'proc:print-posters' });

            // plate unchanged (use = no effect)
            expect(observer.getResource('res:print-plate')!.accountingQuantity?.hasNumericalValue).toBe(1);
            // sheets consumed
            expect(observer.getResource('res:paper-sheets')!.accountingQuantity?.hasNumericalValue).toBe(65);
            // posters produced
            expect(observer.getResource('res:posters')!.accountingQuantity?.hasNumericalValue).toBe(35);
        });

        test('Print brochures: consume 1020 sheets → produce 1000 brochures (20 sheets waste)', () => {
            observer.seedResource({
                id: 'res:paper-sheets',
                conformsTo: 'spec:paper',
                accountingQuantity: { hasNumericalValue: 1020, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1020, hasUnit: 'ea' },
            });

            observer.record({ id: 'e-consume-brochure-sheets', action: 'consume',
                resourceInventoriedAs: 'res:paper-sheets',
                resourceQuantity: { hasNumericalValue: 1020, hasUnit: 'ea' },
                inputOf: 'proc:print-brochures' });
            observer.record({ id: 'e-produce-brochures', action: 'produce',
                resourceInventoriedAs: 'res:brochures',
                resourceQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
                outputOf: 'proc:print-brochures' });

            expect(observer.getResource('res:paper-sheets')!.accountingQuantity?.hasNumericalValue).toBe(0);
            expect(observer.getResource('res:brochures')!.accountingQuantity?.hasNumericalValue).toBe(1000);
        });

        test('full three-process chain: resources flow correctly', () => {
            observer.seedResource({
                id: 'res:plate-material',
                conformsTo: 'spec:plate-material',
                accountingQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
            });
            observer.seedResource({
                id: 'res:paper',
                conformsTo: 'spec:paper',
                accountingQuantity: { hasNumericalValue: 1055, hasUnit: 'ea' },
                onhandQuantity: { hasNumericalValue: 1055, hasUnit: 'ea' },
            });

            // Process 1: make plate
            observer.record({ id: 'p1-e1', action: 'consume',
                resourceInventoriedAs: 'res:plate-material',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:make-plate' });
            observer.record({ id: 'p1-e2', action: 'produce',
                resourceInventoriedAs: 'res:plate',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                outputOf: 'proc:make-plate' });

            // Process 2: print posters (35 sheets)
            observer.record({ id: 'p2-e1', action: 'use',
                resourceInventoriedAs: 'res:plate',
                resourceQuantity: { hasNumericalValue: 1, hasUnit: 'ea' },
                inputOf: 'proc:print-posters' });
            observer.record({ id: 'p2-e2', action: 'consume',
                resourceInventoriedAs: 'res:paper',
                resourceQuantity: { hasNumericalValue: 35, hasUnit: 'ea' },
                inputOf: 'proc:print-posters' });
            observer.record({ id: 'p2-e3', action: 'produce',
                resourceInventoriedAs: 'res:posters',
                resourceQuantity: { hasNumericalValue: 35, hasUnit: 'ea' },
                outputOf: 'proc:print-posters' });

            // Process 3: print brochures (1020 sheets → 1000 brochures)
            observer.record({ id: 'p3-e1', action: 'consume',
                resourceInventoriedAs: 'res:paper',
                resourceQuantity: { hasNumericalValue: 1020, hasUnit: 'ea' },
                inputOf: 'proc:print-brochures' });
            observer.record({ id: 'p3-e2', action: 'produce',
                resourceInventoriedAs: 'res:brochures',
                resourceQuantity: { hasNumericalValue: 1000, hasUnit: 'ea' },
                outputOf: 'proc:print-brochures' });

            // Plate material used up
            expect(observer.getResource('res:plate-material')!.accountingQuantity?.hasNumericalValue).toBe(0);
            // Plate still exists (use doesn't change quantity)
            expect(observer.getResource('res:plate')!.accountingQuantity?.hasNumericalValue).toBe(1);
            // Paper: 1055 - 35 - 1020 = 0
            expect(observer.getResource('res:paper')!.accountingQuantity?.hasNumericalValue).toBe(0);
            // Outputs produced
            expect(observer.getResource('res:posters')!.accountingQuantity?.hasNumericalValue).toBe(35);
            expect(observer.getResource('res:brochures')!.accountingQuantity?.hasNumericalValue).toBe(1000);
        });
    });
});
