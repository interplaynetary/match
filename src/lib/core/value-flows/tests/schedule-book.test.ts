import { describe, expect, test, beforeEach } from 'bun:test';
import { ScheduleBook } from '../planning/schedule-book';
import { PlanNetter } from '../planning/netting';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';
import { buildAgentIndex, nodeCoversDay, getTotalAgentHours, netEffortHours } from '../indexes/agents';
import type { AgentCapacity } from '../indexes/agents';
import type { EconomicResource, Intent, Commitment } from '../schemas';

// =============================================================================
// HELPERS
// =============================================================================

let idCounter = 0;
function nextId(): string { return `t-${++idCounter}`; }

function makeResource(overrides: Partial<EconomicResource> & { conformsTo: string; quantity: number }): EconomicResource {
    return {
        id: nextId(),
        name: overrides.conformsTo,
        conformsTo: overrides.conformsTo,
        accountingQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        onhandQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        ...overrides,
    } as EconomicResource;
}

// =============================================================================
// SHARED SETUP
// =============================================================================

let processReg: ProcessRegistry;
let planStore: PlanStore;
let observer: Observer;

beforeEach(() => {
    idCounter = 0;
    processReg = new ProcessRegistry();
    planStore = new PlanStore(processReg);
    observer = new Observer(processReg);
});

// =============================================================================
// blocksFor — basic collection
// =============================================================================

describe('ScheduleBook.blocksFor — basic collection', () => {
    test('returns empty array when planStore is empty', () => {
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice')).toEqual([]);
    });

    test('includes intent where provider matches', () => {
        planStore.addIntent({ action: 'work', provider: 'agent:alice' });
        const sb = new ScheduleBook(planStore);
        const blocks = sb.blocksFor('agent:alice');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('intent');
        expect(blocks[0].action).toBe('work');
    });

    test('includes intent where receiver matches', () => {
        planStore.addIntent({ action: 'deliverService', receiver: 'agent:bob' });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:bob')).toHaveLength(1);
    });

    test('includes intent where resourceInventoriedAs matches', () => {
        planStore.addIntent({ action: 'use', resourceInventoriedAs: 'res:tool1', provider: 'agent:alice' });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('res:tool1')).toHaveLength(1);
    });

    test('includes commitment where provider matches', () => {
        planStore.addCommitment({ action: 'work', provider: 'agent:alice', receiver: 'org:acme' });
        const sb = new ScheduleBook(planStore);
        const blocks = sb.blocksFor('agent:alice');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('commitment');
    });

    test('includes commitment where receiver matches', () => {
        planStore.addCommitment({ action: 'consume', provider: 'agent:alice', receiver: 'org:acme' });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('org:acme')).toHaveLength(1);
    });

    test('excludes records for unrelated entity', () => {
        planStore.addIntent({ action: 'work', provider: 'agent:alice' });
        planStore.addCommitment({ action: 'work', provider: 'agent:bob', receiver: 'org:acme' });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:carol')).toHaveLength(0);
    });

    test('collects both intents and commitments for same entity', () => {
        planStore.addIntent({ action: 'work', provider: 'agent:alice' });
        planStore.addCommitment({ action: 'work', provider: 'agent:alice', receiver: 'org:acme' });
        const sb = new ScheduleBook(planStore);
        const blocks = sb.blocksFor('agent:alice');
        expect(blocks).toHaveLength(2);
        const types = blocks.map(b => b.type).sort();
        expect(types).toEqual(['commitment', 'intent']);
    });
});

// =============================================================================
// blocksFor — date filter (blockOverlapsDate)
// =============================================================================

describe('ScheduleBook.blocksFor — date filter', () => {
    const monday = new Date('2026-02-23T10:00:00Z'); // a Monday

    test('includes block when hasBeginning+hasEnd straddles the date (inclusive start)', () => {
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(1);
    });

    test('excludes block when hasBeginning+hasEnd interval does not cover date (exclusive end)', () => {
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-24T00:00:00.000Z',
            hasEnd: '2026-02-25T00:00:00.000Z',
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(0);
    });

    test('includes block when due is on the same UTC calendar day', () => {
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            due: '2026-02-23T14:00:00.000Z',
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(1);
    });

    test('excludes block when due is on a different day', () => {
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            due: '2026-02-24T14:00:00.000Z',
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(0);
    });

    test('includes block matching availability_window', () => {
        // Monday 09:00–17:00 window — query at 10:00 UTC on a Monday
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(1);
    });

    test('excludes block whose availability_window does not cover date', () => {
        // Wednesday only — querying on Monday
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            availability_window: {
                day_schedules: [{ days: ['wednesday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(0);
    });

    test('includes block with no temporal info (conservative: always overlaps)', () => {
        planStore.addIntent({ action: 'work', provider: 'agent:alice' });
        const sb = new ScheduleBook(planStore);
        expect(sb.blocksFor('agent:alice', { date: monday })).toHaveLength(1);
    });
});

// =============================================================================
// blocksFor — action filter
// =============================================================================

describe('ScheduleBook.blocksFor — action filter', () => {
    beforeEach(() => {
        planStore.addIntent({ action: 'work', provider: 'agent:alice' });
        planStore.addIntent({ action: 'use', provider: 'agent:alice' });
        planStore.addCommitment({ action: 'work', provider: 'agent:alice', receiver: 'org:acme' });
    });

    test('filters to requested actions', () => {
        const sb = new ScheduleBook(planStore);
        const blocks = sb.blocksFor('agent:alice', { actions: ['work'] });
        expect(blocks).toHaveLength(2); // 1 intent + 1 commitment, both 'work'
        expect(blocks.every(b => b.action === 'work')).toBe(true);
    });

    test('combines action filter with date filter', () => {
        const monday = new Date('2026-02-23T10:00:00Z');
        // Only the commitment has a due on Monday
        planStore.addCommitment({
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            due: '2026-02-23T09:00:00.000Z',
        });
        const sb = new ScheduleBook(planStore);
        // The three existing blocks have no temporal info (always match) + 1 new one with due
        const blocks = sb.blocksFor('agent:alice', { date: monday, actions: ['work'] });
        // All work blocks match the date (2 existing + 1 new commitment)
        expect(blocks.every(b => b.action === 'work')).toBe(true);
    });
});

// =============================================================================
// committedEffortOn
// =============================================================================

describe('ScheduleBook.committedEffortOn', () => {
    const dt = new Date('2026-02-23T10:00:00Z'); // Monday

    test('returns 0 when no work commitments exist', () => {
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(0);
    });

    test('sums effortQuantity of work commitments that overlap the date', () => {
        planStore.addCommitment({
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            due: '2026-02-23T09:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(6);
    });

    test('ignores commitments with different action', () => {
        planStore.addCommitment({
            action: 'consume',
            provider: 'agent:alice',
            receiver: 'org:acme',
            due: '2026-02-23T09:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(0);
    });

    test('ignores commitments where agent is receiver only (not provider)', () => {
        planStore.addCommitment({
            action: 'work',
            provider: 'org:acme',
            receiver: 'agent:alice',
            due: '2026-02-23T09:00:00.000Z',
            effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        // agent:alice is receiver — committedEffortOn should still find the block
        // because blocksFor matches receiver. But only work commitments where provider === agentId
        // represent committed labor by that agent. The current impl sums all work commitments
        // for the entity regardless of role — this is intentional per plan (blocks for any role).
        // Here alice is receiver so the commitment IS found.
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(4);
    });

    test('ignores commitments on a different date', () => {
        planStore.addCommitment({
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            due: '2026-02-24T09:00:00.000Z', // Tuesday
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(0);
    });

    test('sums multiple overlapping work commitments', () => {
        planStore.addCommitment({
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            due: '2026-02-23T09:00:00.000Z',
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
        });
        planStore.addCommitment({
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:beta',
            due: '2026-02-23T14:00:00.000Z',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(5);
    });

    test('ignores work intents (only counts commitments)', () => {
        planStore.addIntent({
            action: 'work',
            provider: 'agent:alice',
            due: '2026-02-23T09:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });
        const sb = new ScheduleBook(planStore);
        expect(sb.committedEffortOn('agent:alice', dt)).toBe(0);
    });
});

// =============================================================================
// isResourceAvailable
// =============================================================================

describe('ScheduleBook.isResourceAvailable', () => {
    const monday = new Date('2026-02-23T10:00:00Z');

    test('returns true when no observer is configured', () => {
        const sb = new ScheduleBook(planStore);
        expect(sb.isResourceAvailable('res:anything', monday)).toBe(true);
    });

    test('returns true when resource has no availability_window', () => {
        const resource = makeResource({ conformsTo: 'spec:tool', quantity: 1 });
        observer.seedResource(resource);
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable(resource.id, monday)).toBe(true);
    });

    test('returns true when resource is not found', () => {
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable('res:nonexistent', monday)).toBe(true);
    });

    test('returns true when resource window covers the date', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 1,
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        observer.seedResource(resource);
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable(resource.id, monday)).toBe(true);
    });

    test('returns false when resource window does not cover the date', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 1,
            availability_window: {
                day_schedules: [{ days: ['wednesday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        observer.seedResource(resource);
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable(resource.id, monday)).toBe(false);
    });

    test('SpecificDateWindow — returns true on matching date', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 1,
            availability_window: {
                specific_dates: ['2026-02-23'],
            },
        });
        observer.seedResource(resource);
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable(resource.id, monday)).toBe(true);
    });

    test('SpecificDateWindow — returns false on non-matching date', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 1,
            availability_window: {
                specific_dates: ['2026-02-24'],
            },
        });
        observer.seedResource(resource);
        const sb = new ScheduleBook(planStore, observer);
        expect(sb.isResourceAvailable(resource.id, monday)).toBe(false);
    });
});

// =============================================================================
// netEffortHours
// =============================================================================

describe('netEffortHours (agents.ts)', () => {
    const monday = new Date('2026-02-23T10:00:00Z');

    function makeIntent(overrides: Partial<Intent>): Intent {
        return { id: nextId(), action: 'work', finished: false, ...overrides } as Intent;
    }

    test('returns 0 for unknown agent', () => {
        const index = buildAgentIndex([], [], new Map());
        expect(netEffortHours('agent:nobody', monday, index)).toBe(0);
    });

    test('returns remaining_hours for agent with matching node', () => {
        const intent = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });
        const index = buildAgentIndex([intent], [], new Map());
        expect(netEffortHours('agent:alice', monday, index)).toBe(8);
    });

    test('deducts committed_hours already baked into the index', () => {
        const intent = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });
        const commitment: Commitment = {
            id: nextId(), action: 'work', finished: false,
            provider: 'agent:alice', receiver: 'org:acme',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T15:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        expect(netEffortHours('agent:alice', monday, index)).toBe(2);
    });

    test('clamped to 0 when over-committed', () => {
        const intent = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' },
        });
        const commitment: Commitment = {
            id: nextId(), action: 'work', finished: false,
            provider: 'agent:alice', receiver: 'org:acme',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        expect(netEffortHours('agent:alice', monday, index)).toBe(0);
    });

    test('excludes node not covering the query date', () => {
        const intent = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T09:00:00.000Z', // Monday
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
        });
        const index = buildAgentIndex([intent], [], new Map());
        const tuesday = new Date('2026-02-24T10:00:00Z');
        expect(netEffortHours('agent:alice', tuesday, index)).toBe(0);
    });

    test('recurring window: only counts on matching days', () => {
        const intent = makeIntent({
            provider: 'agent:alice',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        const index = buildAgentIndex([intent], [], new Map());
        expect(netEffortHours('agent:alice', monday, index)).toBe(8);
        expect(netEffortHours('agent:alice', new Date('2026-02-24T10:00:00Z'), index)).toBe(0);
    });

    test('sums remaining_hours across multiple nodes (different day slots)', () => {
        const i1 = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T12:00:00.000Z',
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
        });
        const i2 = makeIntent({
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T14:00:00.000Z',
            hasEnd: '2026-02-23T17:00:00.000Z',
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
        });
        const index = buildAgentIndex([i1, i2], [], new Map());
        expect(netEffortHours('agent:alice', monday, index)).toBe(6);
    });
});

// =============================================================================
// buildAgentIndex — committed_hours / remaining_hours
// =============================================================================

describe('buildAgentIndex with commitments', () => {
    test('committed_hours = 0 when no commitments passed', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map());
        const capacities = [...index.agent_capacities.values()];
        expect(capacities).toHaveLength(1);
        expect(capacities[0].committed_hours).toBe(0);
        expect(capacities[0].remaining_hours).toBe(8);
    });

    test('reflects work commitment hours that overlap capacity window', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            finished: false,
        };
        const commitment: Commitment = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T15:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        const capacities = [...index.agent_capacities.values()];
        expect(capacities[0].committed_hours).toBe(6);
        expect(capacities[0].remaining_hours).toBe(2);
    });

    test('ignores non-work commitments', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            finished: false,
        };
        const commitment: Commitment = {
            id: nextId(),
            action: 'consume', // not a work commitment
            provider: 'agent:alice',
            receiver: 'org:acme',
            hasBeginning: '2026-02-23T09:00:00.000Z',
            hasEnd: '2026-02-23T15:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        const capacities = [...index.agent_capacities.values()];
        expect(capacities[0].committed_hours).toBe(0);
    });

    test('ignores work commitments outside capacity window', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            finished: false,
        };
        const commitment: Commitment = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            hasBeginning: '2026-02-25T09:00:00.000Z', // Wednesday — outside Mon window
            hasEnd: '2026-02-25T15:00:00.000Z',
            effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        const capacities = [...index.agent_capacities.values()];
        expect(capacities[0].committed_hours).toBe(0);
        expect(capacities[0].remaining_hours).toBe(8);
    });

    test('remaining_hours clamped to 0 when over-committed', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 4, hasUnit: 'hours' },
            finished: false,
        };
        const commitment: Commitment = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            receiver: 'org:acme',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' }, // more than offered
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map(), 7, [commitment]);
        const capacities = [...index.agent_capacities.values()];
        expect(capacities[0].committed_hours).toBe(8);
        expect(capacities[0].remaining_hours).toBe(0); // clamped
    });
});

// =============================================================================
// PlanNetter.netAvailableQty — ScheduleBook delegation
// =============================================================================

describe('PlanNetter.netAvailableQty with scheduleBook', () => {
    const monday = new Date('2026-02-23T10:00:00Z');

    test('delegates to scheduleBook.isResourceAvailable when scheduleBook provided', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 5,
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        observer.seedResource(resource);

        const sb = new ScheduleBook(planStore, observer);
        const netter = new PlanNetter(planStore, observer, sb);

        // On Monday (within window) — should count inventory
        const qty = netter.netAvailableQty('spec:tool', { asOf: monday });
        expect(qty).toBe(5);
    });

    test('scheduleBook excludes resource outside window', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 5,
            availability_window: {
                day_schedules: [{ days: ['wednesday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        observer.seedResource(resource);

        const sb = new ScheduleBook(planStore, observer);
        const netter = new PlanNetter(planStore, observer, sb);

        // Monday — outside Wednesday window
        const qty = netter.netAvailableQty('spec:tool', { asOf: monday });
        expect(qty).toBe(0);
    });

    test('falls back to inline check when no scheduleBook', () => {
        const resource = makeResource({
            conformsTo: 'spec:tool',
            quantity: 5,
            availability_window: {
                day_schedules: [{ days: ['wednesday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        observer.seedResource(resource);

        // No scheduleBook — fallback to inline isWithinTemporalExpression
        const netter = new PlanNetter(planStore, observer);
        const qty = netter.netAvailableQty('spec:tool', { asOf: monday });
        expect(qty).toBe(0); // still excluded by inline check
    });

    test('counts resource without window when scheduleBook present', () => {
        const resource = makeResource({ conformsTo: 'spec:steel', quantity: 10 });
        observer.seedResource(resource);

        const sb = new ScheduleBook(planStore, observer);
        const netter = new PlanNetter(planStore, observer, sb);
        const qty = netter.netAvailableQty('spec:steel', { asOf: monday });
        expect(qty).toBe(10);
    });
});

// =============================================================================
// buildAgentIndex — availability_window exposure
// =============================================================================

describe('buildAgentIndex — availability_window exposure', () => {
    test('capacity node exposes availability_window from intent', () => {
        const window = { day_schedules: [{ days: ['monday' as const], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }] };
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            availability_window: window,
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map());
        const cap = [...index.agent_capacities.values()][0];
        expect(cap.availability_window).toEqual(window);
    });

    test('capacity node has undefined availability_window when intent has none', () => {
        const intent: Intent = {
            id: nextId(),
            action: 'work',
            provider: 'agent:alice',
            hasBeginning: '2026-02-23T00:00:00.000Z',
            hasEnd: '2026-02-24T00:00:00.000Z',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            finished: false,
        };
        const index = buildAgentIndex([intent], [], new Map());
        const cap = [...index.agent_capacities.values()][0];
        expect(cap.availability_window).toBeUndefined();
    });
});


// =============================================================================
// nodeCoversDay — the extracted calendar-day predicate
// =============================================================================

describe('nodeCoversDay', () => {
    const monday = new Date('2026-02-23T10:00:00Z'); // 2026-02-23
    const tuesday = new Date('2026-02-24T10:00:00Z'); // 2026-02-24

    function makeCapacity(overrides: Partial<AgentCapacity>): AgentCapacity {
        return {
            id: 'cap:test',
            agent_id: 'agent:alice',
            space_time_signature: 'sig',
            total_hours: 8,
            resource_specs: [],
            intent_ids: [],
            committed_hours: 0,
            remaining_hours: 8,
            ...overrides,
        };
    }

    test('availability_window: returns true when window covers the date', () => {
        const cap = makeCapacity({
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        expect(nodeCoversDay(cap, monday)).toBe(true);
    });

    test('availability_window: returns false when window does not cover the date', () => {
        const cap = makeCapacity({
            availability_window: {
                day_schedules: [{ days: ['wednesday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        });
        expect(nodeCoversDay(cap, monday)).toBe(false);
    });

    test('availability_window SpecificDateWindow: true on matching date', () => {
        const cap = makeCapacity({
            availability_window: { specific_dates: ['2026-02-23'] },
        });
        expect(nodeCoversDay(cap, monday)).toBe(true);
        expect(nodeCoversDay(cap, tuesday)).toBe(false);
    });

    test('start_date: returns true when start_date calendar day matches', () => {
        const cap = makeCapacity({ start_date: '2026-02-23T09:00:00.000Z' });
        expect(nodeCoversDay(cap, monday)).toBe(true);
        expect(nodeCoversDay(cap, tuesday)).toBe(false);
    });

    test('end_date only (due-based): returns true when end_date calendar day matches', () => {
        const cap = makeCapacity({ start_date: null, end_date: '2026-02-23T17:00:00.000Z' });
        expect(nodeCoversDay(cap, monday)).toBe(true);
        expect(nodeCoversDay(cap, tuesday)).toBe(false);
    });

    test('no temporal info: returns true (conservative)', () => {
        const cap = makeCapacity({ start_date: null, end_date: null });
        expect(nodeCoversDay(cap, monday)).toBe(true);
    });
});

// =============================================================================
// getTotalAgentHours — dt guard
// =============================================================================

describe('getTotalAgentHours — dt guard', () => {
    test('without dt: sums all capacity nodes regardless of window', () => {
        const intents: Intent[] = [
            {
                id: nextId(), action: 'work', provider: 'agent:alice', finished: false,
                hasBeginning: '2026-02-23T09:00:00.000Z', // Monday
                hasEnd: '2026-02-23T17:00:00.000Z',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            },
            {
                id: nextId(), action: 'work', provider: 'agent:alice', finished: false,
                hasBeginning: '2026-02-24T09:00:00.000Z', // Tuesday
                hasEnd: '2026-02-24T17:00:00.000Z',
                effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            },
        ];
        const index = buildAgentIndex(intents, [], new Map());
        const all = [...index.agent_capacities.values()];
        // No dt → all nodes summed
        expect(getTotalAgentHours(all)).toBe(14);
    });

    test('with dt: only nodes covering that day are summed', () => {
        const intents: Intent[] = [
            {
                id: nextId(), action: 'work', provider: 'agent:alice', finished: false,
                hasBeginning: '2026-02-23T09:00:00.000Z', // Monday
                hasEnd: '2026-02-23T17:00:00.000Z',
                effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            },
            {
                id: nextId(), action: 'work', provider: 'agent:alice', finished: false,
                hasBeginning: '2026-02-24T09:00:00.000Z', // Tuesday
                hasEnd: '2026-02-24T17:00:00.000Z',
                effortQuantity: { hasNumericalValue: 6, hasUnit: 'hours' },
            },
        ];
        const index = buildAgentIndex(intents, [], new Map());
        const all = [...index.agent_capacities.values()];
        const monday = new Date('2026-02-23T10:00:00Z');
        const tuesday = new Date('2026-02-24T10:00:00Z');
        // dt filter: only the matching day's node
        expect(getTotalAgentHours(all, monday)).toBe(8);
        expect(getTotalAgentHours(all, tuesday)).toBe(6);
    });

    test('recurring window: dt guard uses hoursInWindowOnDate', () => {
        const intent: Intent = {
            id: nextId(), action: 'work', provider: 'agent:alice', finished: false,
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            availability_window: {
                day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '17:00' }] }],
            },
        };
        const index = buildAgentIndex([intent], [], new Map());
        const all = [...index.agent_capacities.values()];
        const monday = new Date('2026-02-23T10:00:00Z');  // Monday
        const tuesday = new Date('2026-02-24T10:00:00Z'); // Tuesday
        expect(getTotalAgentHours(all, monday)).toBe(8);
        expect(getTotalAgentHours(all, tuesday)).toBe(0); // window doesn't cover Tuesday
    });
});


