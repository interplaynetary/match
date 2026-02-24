import { describe, expect, test, beforeEach } from 'bun:test';
import { PlanNetter } from '../planning/netting';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import type { EconomicResource } from '../schemas';

// =============================================================================
// HELPERS
// =============================================================================

let idCounter = 0;
function nextId(): string {
    return `test-${++idCounter}`;
}

function makeResource(overrides: Partial<EconomicResource> & { conformsTo: string; quantity: number }): EconomicResource {
    return {
        id: nextId(),
        name: overrides.name ?? overrides.conformsTo,
        conformsTo: overrides.conformsTo,
        accountingQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        onhandQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        ...overrides,
    } as EconomicResource;
}

// =============================================================================
// TESTS
// =============================================================================

describe('PlanNetter', () => {
    let processReg: ProcessRegistry;
    let planStore: PlanStore;
    let observer: Observer;
    let plan: { id: string };
    let processId: string;

    beforeEach(() => {
        idCounter = 0;
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        observer = new Observer(processReg);
        plan = planStore.addPlan({ name: 'Test Plan' });
        processId = nextId();
    });

    // ── 1. netDemand — observer inventory ──────────────────────────────────

    test('netDemand nets against observer inventory', () => {
        const resource = makeResource({ conformsTo: 'spec:wood', quantity: 8 });
        observer.seedResource(resource);

        const netter = new PlanNetter(planStore, observer);
        const result = netter.netDemand('spec:wood', 5);

        expect(result.remaining).toBe(0);
        expect(result.inventoryAllocated).toHaveLength(1);
        expect(result.inventoryAllocated[0].resourceId).toBe(resource.id);
        expect(result.inventoryAllocated[0].quantity).toBe(5);
    });

    test('netDemand returns partial remaining when inventory is insufficient', () => {
        const resource = makeResource({ conformsTo: 'spec:wood', quantity: 3 });
        observer.seedResource(resource);

        const netter = new PlanNetter(planStore, observer);
        const result = netter.netDemand('spec:wood', 10);

        expect(result.remaining).toBe(7);
        expect(result.inventoryAllocated[0].quantity).toBe(3);
    });

    // ── 2. netDemand — scheduled output Intents ────────────────────────────

    test('netDemand nets against scheduled output Intents (outputOf set)', () => {
        // Pre-existing output intent: 4 units of spec:yarn will be produced
        planStore.addIntent({
            action: 'produce',
            outputOf: processId,
            resourceConformsTo: 'spec:yarn',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        const result = netter.netDemand('spec:yarn', 4);

        expect(result.remaining).toBe(0);
        expect(result.inventoryAllocated).toHaveLength(0); // no observer inventory
    });

    // ── 3. netDemand — scheduled output Commitments ────────────────────────

    test('netDemand nets against scheduled output Commitments (outputOf set)', () => {
        planStore.addCommitment({
            action: 'produce',
            outputOf: processId,
            resourceConformsTo: 'spec:fabric',
            resourceQuantity: { hasNumericalValue: 6, hasUnit: 'm' },
            provider: 'agent:A',
            receiver: 'agent:B',
            plannedWithin: plan.id,
            created: new Date().toISOString(),
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        const result = netter.netDemand('spec:fabric', 6);

        expect(result.remaining).toBe(0);
    });

    // ── 4. netDemand — same scheduled output not double-counted ───────────

    test('netDemand: same scheduled output not double-counted across two calls', () => {
        planStore.addIntent({
            action: 'produce',
            outputOf: processId,
            resourceConformsTo: 'spec:thread',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);

        const first = netter.netDemand('spec:thread', 5);
        expect(first.remaining).toBe(0);

        // Second call: same flow already in netter.allocated → cannot use again
        const second = netter.netDemand('spec:thread', 5);
        expect(second.remaining).toBe(5); // nothing left to net against
    });

    // ── 5. netSupply — scheduled consumption Intents ──────────────────────

    test('netSupply nets against scheduled consumption Intents (inputOf set)', () => {
        // Demand explosion already scheduled a consumption of 3 units of spec:yarn
        planStore.addIntent({
            action: 'consume',
            inputOf: processId,
            resourceConformsTo: 'spec:yarn',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        const remaining = netter.netSupply('spec:yarn', 5);

        expect(remaining).toBe(2); // 5 supplied - 3 pre-claimed = 2
    });

    // ── 6. netSupply — scheduled consumption Commitments ──────────────────

    test('netSupply nets against scheduled consumption Commitments (inputOf set)', () => {
        planStore.addCommitment({
            action: 'consume',
            inputOf: processId,
            resourceConformsTo: 'spec:cotton',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'kg' },
            provider: 'agent:A',
            receiver: 'agent:B',
            plannedWithin: plan.id,
            created: new Date().toISOString(),
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        const remaining = netter.netSupply('spec:cotton', 4);

        expect(remaining).toBe(0);
    });

    // ── 7. netSupply — same consumption not double-counted ─────────────────

    test('netSupply: same consumption not double-counted across two calls', () => {
        planStore.addIntent({
            action: 'consume',
            inputOf: processId,
            resourceConformsTo: 'spec:silk',
            resourceQuantity: { hasNumericalValue: 6, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);

        const first = netter.netSupply('spec:silk', 10);
        expect(first).toBe(4); // 10 - 6 = 4

        const second = netter.netSupply('spec:silk', 8);
        expect(second).toBe(8); // consumption already allocated → not deducted again
    });

    // ── 8. netAvailableQty — inventory + outputs - consumptions ───────────

    test('netAvailableQty returns inventory + outputs - consumptions, read-only', () => {
        // 5 in inventory
        const resource = makeResource({ conformsTo: 'spec:linen', quantity: 5 });
        observer.seedResource(resource);

        // 3 more scheduled to be produced
        planStore.addIntent({
            action: 'produce',
            outputOf: processId,
            resourceConformsTo: 'spec:linen',
            resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        // 4 scheduled to be consumed
        planStore.addIntent({
            action: 'consume',
            inputOf: processId,
            resourceConformsTo: 'spec:linen',
            resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore, observer);
        const qty = netter.netAvailableQty('spec:linen');

        // 5 + 3 - 4 = 4
        expect(qty).toBe(4);
    });

    // ── Temporal guards ────────────────────────────────────────────────────

    describe('temporal guards', () => {
        // 1. netDemand — output intent due AFTER neededBy → NOT absorbed
        test('netDemand: output intent due after neededBy is NOT absorbed', () => {
            const neededBy = new Date('2026-04-01T10:00:00Z');
            const tooLate = new Date('2026-04-01T12:00:00Z');

            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:glass',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                due: tooLate.toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const result = netter.netDemand('spec:glass', 5, { neededBy });

            // Intent is ready AFTER neededBy → should NOT be absorbed
            expect(result.remaining).toBe(5);
        });

        // 2. netDemand — output intent due exactly AT neededBy → absorbed
        test('netDemand: output intent due exactly at neededBy IS absorbed', () => {
            const neededBy = new Date('2026-04-01T10:00:00Z');

            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:glass',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                due: neededBy.toISOString(), // exactly at neededBy
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const result = netter.netDemand('spec:glass', 5, { neededBy });

            // Intent due exactly AT neededBy is NOT after neededBy → absorbed
            expect(result.remaining).toBe(0);
        });

        // 3. netDemand — no neededBy provided → absorbs unconditionally
        test('netDemand: no neededBy absorbs unconditionally (backward compat)', () => {
            const farFuture = new Date('2030-01-01T00:00:00Z');

            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:glass',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                due: farFuture.toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const result = netter.netDemand('spec:glass', 5); // no neededBy

            expect(result.remaining).toBe(0);
        });

        // 4. netSupply — consumption due BEFORE availableFrom → NOT absorbed
        test('netSupply: consumption due before availableFrom is NOT absorbed', () => {
            const availableFrom = new Date('2026-04-01T09:00:00Z');
            const tooEarly = new Date('2026-04-01T07:00:00Z');

            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
                due: tooEarly.toISOString(), // needed before supply is ready
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const remaining = netter.netSupply('spec:yarn', 3, availableFrom);

            // Consumption is needed before supply arrives → NOT absorbed
            expect(remaining).toBe(3);
        });

        // 5. netSupply — consumption due AFTER availableFrom → absorbed
        test('netSupply: consumption due after availableFrom IS absorbed', () => {
            const availableFrom = new Date('2026-04-01T09:00:00Z');
            const afterArrival = new Date('2026-04-01T11:00:00Z');

            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'kg' },
                due: afterArrival.toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const remaining = netter.netSupply('spec:yarn', 3, availableFrom);

            // Consumption is due after supply arrives → absorbed
            expect(remaining).toBe(0);
        });

        // 6. netAvailableQty with asOf: future output excluded; future consumption NOT deducted
        test('netAvailableQty with asOf excludes future output and skips future consumption', () => {
            const asOf = new Date('2026-04-01T10:00:00Z');

            // Output due BEFORE asOf → should be counted
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:steel',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'each' },
                due: new Date('2026-04-01T08:00:00Z').toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            // Output due AFTER asOf → should NOT be counted
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:steel',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'each' },
                due: new Date('2026-04-01T14:00:00Z').toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            // Consumption due BEFORE asOf → should be deducted
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:steel',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
                due: new Date('2026-04-01T09:00:00Z').toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            // Consumption due AFTER asOf → should NOT be deducted
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:steel',
                resourceQuantity: { hasNumericalValue: 4, hasUnit: 'each' },
                due: new Date('2026-04-01T16:00:00Z').toISOString(),
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const qty = netter.netAvailableQty('spec:steel', { asOf });

            // Only 10 counted (before asOf), only 3 deducted (before asOf) → 10 - 3 = 7
            expect(qty).toBe(7);
        });
    });

    // ── Location guards ────────────────────────────────────────────────────

    describe('location guards', () => {
        // 1. netDemand: inventory at wrong location → NOT absorbed
        test('netDemand: inventory resource at wrong location is NOT absorbed', () => {
            const resource = makeResource({ conformsTo: 'spec:wood', quantity: 5, currentLocation: 'loc:FarmA' });
            observer.seedResource(resource);

            const netter = new PlanNetter(planStore, observer);
            const result = netter.netDemand('spec:wood', 5, { atLocation: 'loc:FactoryB' });

            expect(result.remaining).toBe(5);
            expect(result.inventoryAllocated).toHaveLength(0);
        });

        // 2. netDemand: inventory at correct location → absorbed
        test('netDemand: inventory resource at correct location IS absorbed', () => {
            const resource = makeResource({ conformsTo: 'spec:wood', quantity: 5, currentLocation: 'loc:FactoryB' });
            observer.seedResource(resource);

            const netter = new PlanNetter(planStore, observer);
            const result = netter.netDemand('spec:wood', 5, { atLocation: 'loc:FactoryB' });

            expect(result.remaining).toBe(0);
            expect(result.inventoryAllocated).toHaveLength(1);
        });

        // 3. netDemand: output intent at wrong location → NOT absorbed; intent with no atLocation → absorbed
        test('netDemand: output intent at wrong location NOT absorbed; no atLocation → absorbed', () => {
            // Intent with explicit wrong location
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
                atLocation: 'loc:FarmA',
                plannedWithin: plan.id,
                finished: false,
            });
            // Intent with no atLocation (conservative: matches any location)
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const result = netter.netDemand('spec:yarn', 5, { atLocation: 'loc:FactoryB' });

            // Only the unlocated intent (2 units) is absorbed; the FarmA one is not
            expect(result.remaining).toBe(3);
        });

        // 4. netDemand: no atLocation in opts → absorbs all intents (backward compat)
        test('netDemand: no atLocation in opts absorbs all intents regardless of their location', () => {
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
                atLocation: 'loc:FarmA',
                plannedWithin: plan.id,
                finished: false,
            });
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
                atLocation: 'loc:FactoryB',
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const result = netter.netDemand('spec:yarn', 5); // no atLocation

            expect(result.remaining).toBe(0);
        });

        // 5. netSupply: consumption at different location → NOT absorbed; no atLocation → absorbed
        test('netSupply: consumption at different location NOT absorbed; no atLocation → absorbed', () => {
            // Consumption intent at FactoryB
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'each' },
                atLocation: 'loc:FactoryB',
                plannedWithin: plan.id,
                finished: false,
            });
            // Consumption intent with no atLocation
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:yarn',
                resourceQuantity: { hasNumericalValue: 2, hasUnit: 'each' },
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            // Supply is at FarmA
            const remaining = netter.netSupply('spec:yarn', 5, undefined, 'loc:FarmA');

            // FactoryB consumption not absorbed; unlocated one is absorbed
            expect(remaining).toBe(3);
        });

        // 6. netAvailableQty with atLocation: cross-location output excluded; cross-location consumption NOT deducted
        test('netAvailableQty with atLocation filters outputs and consumptions by location', () => {
            // Output at FactoryB (should be counted)
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:fabric',
                resourceQuantity: { hasNumericalValue: 10, hasUnit: 'm' },
                atLocation: 'loc:FactoryB',
                plannedWithin: plan.id,
                finished: false,
            });
            // Output at FarmA (should NOT be counted)
            planStore.addIntent({
                action: 'produce',
                outputOf: processId,
                resourceConformsTo: 'spec:fabric',
                resourceQuantity: { hasNumericalValue: 5, hasUnit: 'm' },
                atLocation: 'loc:FarmA',
                plannedWithin: plan.id,
                finished: false,
            });
            // Consumption at FactoryB (should be deducted)
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:fabric',
                resourceQuantity: { hasNumericalValue: 3, hasUnit: 'm' },
                atLocation: 'loc:FactoryB',
                plannedWithin: plan.id,
                finished: false,
            });
            // Consumption at FarmA (should NOT be deducted)
            planStore.addIntent({
                action: 'consume',
                inputOf: processId,
                resourceConformsTo: 'spec:fabric',
                resourceQuantity: { hasNumericalValue: 4, hasUnit: 'm' },
                atLocation: 'loc:FarmA',
                plannedWithin: plan.id,
                finished: false,
            });

            const netter = new PlanNetter(planStore);
            const qty = netter.netAvailableQty('spec:fabric', { atLocation: 'loc:FactoryB' });

            // 10 (FactoryB output) - 3 (FactoryB consumption) = 7
            expect(qty).toBe(7);
        });
    });

    // ── Containment guards ─────────────────────────────────────────────────

    describe('containment guards', () => {
        // 7. netDemand: resource with containedIn set → NOT absorbed
        test('netDemand: resource with containedIn is NOT absorbed from inventory', () => {
            const contained = makeResource({ conformsTo: 'spec:flour', quantity: 5, containedIn: 'resource:bowl' });
            observer.seedResource(contained);

            const netter = new PlanNetter(planStore, observer);
            const result = netter.netDemand('spec:flour', 5);

            expect(result.remaining).toBe(5);
            expect(result.inventoryAllocated).toHaveLength(0);
        });

        // 8. netDemand: resource with containedIn: undefined → absorbed normally
        test('netDemand: resource without containedIn IS absorbed normally', () => {
            const free = makeResource({ conformsTo: 'spec:flour', quantity: 5 });
            observer.seedResource(free);

            const netter = new PlanNetter(planStore, observer);
            const result = netter.netDemand('spec:flour', 5);

            expect(result.remaining).toBe(0);
            expect(result.inventoryAllocated).toHaveLength(1);
        });

        // 9. netAvailableQty: contained resource excluded from inventory total
        test('netAvailableQty: contained resource is excluded from inventory total', () => {
            const contained = makeResource({ conformsTo: 'spec:sugar', quantity: 10, containedIn: 'resource:jar' });
            const free = makeResource({ conformsTo: 'spec:sugar', quantity: 3 });
            observer.seedResource(contained);
            observer.seedResource(free);

            const netter = new PlanNetter(planStore, observer);
            const qty = netter.netAvailableQty('spec:sugar');

            // Only the free resource counts
            expect(qty).toBe(3);
        });
    });

    // ── 9. netAvailableQty — does not mutate allocated ─────────────────────

    test('netAvailableQty does not mutate allocated Set', () => {
        planStore.addIntent({
            action: 'produce',
            outputOf: processId,
            resourceConformsTo: 'spec:polyester',
            resourceQuantity: { hasNumericalValue: 7, hasUnit: 'each' },
            plannedWithin: plan.id,
            finished: false,
        });

        const netter = new PlanNetter(planStore);
        expect(netter.allocated.size).toBe(0);

        netter.netAvailableQty('spec:polyester');

        // allocated must stay empty — netAvailableQty is read-only
        expect(netter.allocated.size).toBe(0);

        // A subsequent netDemand should still be able to consume the same intent
        const result = netter.netDemand('spec:polyester', 7);
        expect(result.remaining).toBe(0);
    });
});
