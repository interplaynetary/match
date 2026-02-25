import { expect, test, describe } from "bun:test";
import {
    buildIndependentSupplyIndex,
    querySupplyBySpec,
    querySupplyByLocation,
    querySupplyBySpecAndLocation,
    getTotalSupplyQuantity,
    getTotalSupplyHours,
} from "../indexes/independent-supply";
import { buildAgentIndex } from "../indexes/agents";
import type { EconomicResource, Intent, Commitment, SpatialThing } from "../schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function nextId(): string { return `id-${++_id}`; }

function resource(overrides: Partial<EconomicResource> & { id?: string }): EconomicResource {
    return {
        id: overrides.id ?? nextId(),
        conformsTo: 'spec:default',
        ...overrides,
    } as EconomicResource;
}

function intent(overrides: Partial<Intent> & { id?: string }): Intent {
    return {
        id: overrides.id ?? nextId(),
        action: 'produce',
        finished: false,
        ...overrides,
    } as Intent;
}

function commitment(overrides: Partial<Commitment> & { id?: string }): Commitment {
    return {
        id: overrides.id ?? nextId(),
        action: 'produce',
        finished: false,
        ...overrides,
    } as Commitment;
}

const LONDON: SpatialThing = { id: 'loc:london', lat: 51.5074, long: -0.1278 };
const PARIS:  SpatialThing = { id: 'loc:paris',  lat: 48.8566, long: 2.3522 };

const emptyAgentIndex = buildAgentIndex([], [], new Map());

// ---------------------------------------------------------------------------

describe("IndependentSupplyIndex — inventory stratum", () => {
    test("resource with positive onhandQuantity appears as inventory slot", () => {
        const r = resource({ id: 'r1', conformsTo: 'spec:wheat', onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' } });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());

        expect(index.supply_slots.size).toBe(1);
        const slot = index.supply_slots.get('inv:r1');
        expect(slot).toBeDefined();
        expect(slot?.slot_type).toBe('inventory');
        expect(slot?.spec_id).toBe('spec:wheat');
        expect(slot?.quantity).toBe(100);
        expect(slot?.hours).toBe(0);
        expect(slot?.source_id).toBe('r1');
    });

    test("resource with zero onhandQuantity is excluded", () => {
        const r = resource({ conformsTo: 'spec:wheat', onhandQuantity: { hasNumericalValue: 0, hasUnit: 'kg' } });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("resource without onhandQuantity is excluded", () => {
        const r = resource({ conformsTo: 'spec:wheat' });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("contained resource (containedIn set) is excluded", () => {
        const r = resource({
            conformsTo: 'spec:wheat',
            containedIn: 'container:1',
            onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
        });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("spec_index populated for inventory slot", () => {
        const r = resource({ id: 'r2', conformsTo: 'spec:flour', onhandQuantity: { hasNumericalValue: 20, hasUnit: 'kg' } });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());

        const ids = index.spec_index.get('spec:flour');
        expect(ids).toBeDefined();
        expect(ids?.has('inv:r2')).toBe(true);
    });

    test("inventory slot with location appears in cell_index and spatial_hierarchy", () => {
        const r = resource({
            id: 'r3',
            conformsTo: 'spec:wood',
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'ea' },
            currentLocation: 'loc:london',
        });
        const locations = new Map<string, SpatialThing>([['loc:london', LONDON]]);
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, locations);

        const slot = index.supply_slots.get('inv:r3')!;
        expect(slot.h3_cell).toBeDefined();
        expect(index.cell_index.get(slot.h3_cell!)?.has('inv:r3')).toBe(true);

        // Spatial hierarchy contains this slot
        const results = querySupplyByLocation(index, { latitude: 51.5074, longitude: -0.1278, radius_km: 10 });
        expect(results.some(s => s.id === 'inv:r3')).toBe(true);
    });
});

describe("IndependentSupplyIndex — scheduled_receipt stratum (intents)", () => {
    test("outputOf intent appears as scheduled_receipt slot", () => {
        const i = intent({
            id: 'i1',
            outputOf: 'process:bake',
            resourceConformsTo: 'spec:bread',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'loaves' },
            hasEnd: '2026-03-01T12:00:00Z',
        });
        const index = buildIndependentSupplyIndex([], [i], [], emptyAgentIndex, new Map());

        expect(index.supply_slots.size).toBe(1);
        const slot = index.supply_slots.get('sched:i1');
        expect(slot).toBeDefined();
        expect(slot?.slot_type).toBe('scheduled_receipt');
        expect(slot?.spec_id).toBe('spec:bread');
        expect(slot?.quantity).toBe(30);
        expect(slot?.available_from).toBe('2026-03-01T12:00:00Z');
        expect(slot?.source_id).toBe('i1');
    });

    test("intent without outputOf is excluded", () => {
        const i = intent({ resourceConformsTo: 'spec:bread', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'loaves' } });
        const index = buildIndependentSupplyIndex([], [i], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("finished outputOf intent is excluded", () => {
        const i = intent({ outputOf: 'process:bake', finished: true, resourceConformsTo: 'spec:bread' });
        const index = buildIndependentSupplyIndex([], [i], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("work outputOf intent is excluded (labor handled separately)", () => {
        const i = intent({ outputOf: 'process:work', action: 'work', resourceConformsTo: 'spec:labor' });
        const index = buildIndependentSupplyIndex([], [i], [], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });
});

describe("IndependentSupplyIndex — scheduled_receipt stratum (commitments)", () => {
    test("outputOf commitment appears as scheduled_receipt slot", () => {
        const c = commitment({
            id: 'c1',
            outputOf: 'process:forge',
            resourceConformsTo: 'spec:steel',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'tons' },
            due: '2026-04-01T00:00:00Z',
        });
        const index = buildIndependentSupplyIndex([], [], [c], emptyAgentIndex, new Map());

        expect(index.supply_slots.size).toBe(1);
        const slot = index.supply_slots.get('sched:c1');
        expect(slot).toBeDefined();
        expect(slot?.slot_type).toBe('scheduled_receipt');
        expect(slot?.quantity).toBe(5);
        expect(slot?.available_from).toBe('2026-04-01T00:00:00Z');
    });

    test("finished commitment is excluded", () => {
        const c = commitment({ outputOf: 'process:forge', finished: true, resourceConformsTo: 'spec:steel' });
        const index = buildIndependentSupplyIndex([], [], [c], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("work commitment is excluded", () => {
        const c = commitment({ outputOf: 'process:work', action: 'work' });
        const index = buildIndependentSupplyIndex([], [], [c], emptyAgentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });
});

describe("IndependentSupplyIndex — labor stratum", () => {
    test("AgentCapacity with remaining_hours appears as labor slot", () => {
        const workIntent = intent({
            id: 'wi1',
            action: 'work',
            provider: 'agent:alice',
            resourceConformsTo: 'spec:welding',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const agentIndex = buildAgentIndex([workIntent], [], new Map());
        const index = buildIndependentSupplyIndex([], [], [], agentIndex, new Map());

        expect(index.supply_slots.size).toBe(1);
        const [slot] = [...index.supply_slots.values()];
        expect(slot.slot_type).toBe('labor');
        expect(slot.hours).toBe(8);
        expect(slot.quantity).toBe(0);
        expect(slot.agent_id).toBe('agent:alice');
    });

    test("AgentCapacity with remaining_hours=0 is excluded", () => {
        const workIntent = intent({
            action: 'work',
            provider: 'agent:bob',
            resourceConformsTo: 'spec:welding',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const overCommit = commitment({
            action: 'work',
            provider: 'agent:bob',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const agentIndex = buildAgentIndex([workIntent], [], new Map(), 7, [overCommit]);
        const index = buildIndependentSupplyIndex([], [], [], agentIndex, new Map());
        expect(index.supply_slots.size).toBe(0);
    });

    test("labor slot appears in spec_index for each resource_spec of the AgentCapacity", () => {
        const i1 = intent({
            action: 'work',
            provider: 'agent:alice',
            resourceConformsTo: 'spec:welding',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const i2 = intent({
            action: 'work',
            provider: 'agent:alice',
            resourceConformsTo: 'spec:cutting',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const agentIndex = buildAgentIndex([i1, i2], [], new Map());
        const index = buildIndependentSupplyIndex([], [], [], agentIndex, new Map());

        // ONE slot (same space-time sig → same AgentCapacity), but referenced by both specs
        expect(index.supply_slots.size).toBe(1);
        const [slot] = [...index.supply_slots.values()];

        expect(index.spec_index.get('spec:welding')?.has(slot.id)).toBe(true);
        expect(index.spec_index.get('spec:cutting')?.has(slot.id)).toBe(true);
    });

    test("labor hours reflect remaining_hours (after committed deduction)", () => {
        const workIntent = intent({
            action: 'work',
            provider: 'agent:carol',
            resourceConformsTo: 'spec:masonry',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const committed = commitment({
            action: 'work',
            provider: 'agent:carol',
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T12:00:00Z',
        });
        const agentIndex = buildAgentIndex([workIntent], [], new Map(), 7, [committed]);
        const index = buildIndependentSupplyIndex([], [], [], agentIndex, new Map());

        const [slot] = [...index.supply_slots.values()];
        expect(slot.hours).toBe(5); // 8 - 3
    });
});

describe("IndependentSupplyIndex — querySupplyBySpecAndLocation", () => {
    test("returns slots matching both spec and location", () => {
        const londonResource = resource({
            id: 'r:london',
            conformsTo: 'spec:steel',
            onhandQuantity: { hasNumericalValue: 10, hasUnit: 'tons' },
            currentLocation: 'loc:london',
        });
        const parisResource = resource({
            id: 'r:paris',
            conformsTo: 'spec:steel',
            onhandQuantity: { hasNumericalValue: 5, hasUnit: 'tons' },
            currentLocation: 'loc:paris',
        });
        const locations = new Map<string, SpatialThing>([
            ['loc:london', LONDON],
            ['loc:paris', PARIS],
        ]);

        const index = buildIndependentSupplyIndex([londonResource, parisResource], [], [], emptyAgentIndex, locations, 4);

        const londonResults = querySupplyBySpecAndLocation(index, 'spec:steel', {
            latitude: 51.5074,
            longitude: -0.1278,
            radius_km: 100,
        });
        expect(londonResults).toHaveLength(1);
        expect(londonResults[0].id).toBe('inv:r:london');

        const parisResults = querySupplyBySpecAndLocation(index, 'spec:steel', {
            latitude: 48.8566,
            longitude: 2.3522,
            radius_km: 100,
        });
        expect(parisResults).toHaveLength(1);
        expect(parisResults[0].id).toBe('inv:r:paris');
    });

    test("returns empty array for unknown spec", () => {
        const r = resource({ conformsTo: 'spec:steel', onhandQuantity: { hasNumericalValue: 10, hasUnit: 'tons' } });
        const index = buildIndependentSupplyIndex([r], [], [], emptyAgentIndex, new Map());
        const results = querySupplyBySpecAndLocation(index, 'spec:unknown', { latitude: 0, longitude: 0 });
        expect(results).toHaveLength(0);
    });
});

describe("IndependentSupplyIndex — getTotalSupplyQuantity / getTotalSupplyHours", () => {
    test("getTotalSupplyQuantity sums material slots only", () => {
        const r1 = resource({ conformsTo: 'spec:grain', onhandQuantity: { hasNumericalValue: 100, hasUnit: 'kg' } });
        const r2 = resource({ conformsTo: 'spec:grain', onhandQuantity: { hasNumericalValue: 50, hasUnit: 'kg' } });
        const index = buildIndependentSupplyIndex([r1, r2], [], [], emptyAgentIndex, new Map());

        const slots = querySupplyBySpec(index, 'spec:grain');
        expect(getTotalSupplyQuantity(slots)).toBe(150);
        expect(getTotalSupplyHours(slots)).toBe(0);
    });

    test("getTotalSupplyHours sums labor slots only", () => {
        const wi1 = intent({
            action: 'work',
            provider: 'agent:alice',
            resourceConformsTo: 'spec:carpentry',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const wi2 = intent({
            action: 'work',
            provider: 'agent:bob',
            resourceConformsTo: 'spec:carpentry',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T17:00:00Z',
        });
        const agentIndex = buildAgentIndex([wi1, wi2], [], new Map());
        const index = buildIndependentSupplyIndex([], [], [], agentIndex, new Map());

        const slots = querySupplyBySpec(index, 'spec:carpentry');
        expect(getTotalSupplyHours(slots)).toBe(14); // 8 + 6
        expect(getTotalSupplyQuantity(slots)).toBe(0);
    });

    test("mixed strata: quantities and hours both summed correctly", () => {
        const r = resource({ conformsTo: 'spec:mixed', onhandQuantity: { hasNumericalValue: 20, hasUnit: 'kg' } });
        const wi = intent({
            action: 'work',
            provider: 'agent:alice',
            resourceConformsTo: 'spec:mixed',
            effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' },
            hasBeginning: '2026-02-23T09:00:00Z',
            hasEnd: '2026-02-23T13:00:00Z',
        });
        const agentIndex = buildAgentIndex([wi], [], new Map());
        const index = buildIndependentSupplyIndex([r], [], [], agentIndex, new Map());

        const slots = querySupplyBySpec(index, 'spec:mixed');
        expect(getTotalSupplyQuantity(slots)).toBe(20);
        expect(getTotalSupplyHours(slots)).toBe(4);
    });
});
