import { describe, expect, test, beforeEach } from 'bun:test';
import { isTimeInRanges, isWithinTemporalExpression } from '../utils/time';
import type { AvailabilityWindow, SpecificDateWindow, TimeRange } from '../utils/time';
import { Observer } from '../observation/observer';
import { PlanNetter } from '../planning/netting';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';
import type { EconomicResource } from '../schemas';

// =============================================================================
// HELPERS
// =============================================================================

let idCounter = 0;
function nextId(): string {
    return `test-${++idCounter}`;
}

function makeResource(
    overrides: Partial<EconomicResource> & { conformsTo: string; quantity: number },
): EconomicResource {
    return {
        id: nextId(),
        name: overrides.name ?? overrides.conformsTo,
        conformsTo: overrides.conformsTo,
        accountingQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        onhandQuantity: { hasNumericalValue: overrides.quantity, hasUnit: 'each' },
        ...overrides,
    } as EconomicResource;
}

// Monday 2026-02-23 at 10:00 UTC
const MON_10AM = new Date('2026-02-23T10:00:00Z');
// Monday 2026-02-23 at 02:00 UTC
const MON_2AM  = new Date('2026-02-23T02:00:00Z');
// Tuesday 2026-02-24 at 10:00 UTC
const TUE_10AM = new Date('2026-02-24T10:00:00Z');
// Saturday 2026-02-28 at 14:00 UTC
const SAT_2PM  = new Date('2026-02-28T14:00:00Z');

const WORK_HOURS: TimeRange[] = [{ start_time: '09:00', end_time: '17:00' }];

const MON_FRI_9_TO_5: AvailabilityWindow = {
    day_schedules: [
        { days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], time_ranges: WORK_HOURS },
    ],
};

// =============================================================================
// isTimeInRanges
// =============================================================================

describe('isTimeInRanges', () => {
    const ranges: TimeRange[] = [{ start_time: '09:00', end_time: '17:00' }];

    test('returns true for time inside range', () => {
        expect(isTimeInRanges('10:00', ranges)).toBe(true);
        expect(isTimeInRanges('09:00', ranges)).toBe(true);  // start inclusive
        expect(isTimeInRanges('16:59', ranges)).toBe(true);
    });

    test('returns false for time outside range (end exclusive)', () => {
        expect(isTimeInRanges('17:00', ranges)).toBe(false); // end exclusive
        expect(isTimeInRanges('08:59', ranges)).toBe(false);
        expect(isTimeInRanges('02:00', ranges)).toBe(false);
    });

    test('returns false for empty ranges array', () => {
        expect(isTimeInRanges('10:00', [])).toBe(false);
    });

    test('matches any of multiple ranges', () => {
        const multi: TimeRange[] = [
            { start_time: '08:00', end_time: '12:00' },
            { start_time: '14:00', end_time: '18:00' },
        ];
        expect(isTimeInRanges('09:00', multi)).toBe(true);
        expect(isTimeInRanges('15:00', multi)).toBe(true);
        expect(isTimeInRanges('13:00', multi)).toBe(false);
    });
});

// =============================================================================
// isWithinTemporalExpression — SpecificDateWindow
// =============================================================================

describe('isWithinTemporalExpression — SpecificDateWindow', () => {
    test('returns true when date is in specific_dates (no time_ranges)', () => {
        const window: SpecificDateWindow = { specific_dates: ['2026-02-23'] };
        expect(isWithinTemporalExpression(MON_10AM, window)).toBe(true);
    });

    test('returns false when date is not in specific_dates', () => {
        const window: SpecificDateWindow = { specific_dates: ['2026-03-01'] };
        expect(isWithinTemporalExpression(MON_10AM, window)).toBe(false);
    });

    test('returns true when date matches and time is within time_ranges', () => {
        const window: SpecificDateWindow = {
            specific_dates: ['2026-02-23'],
            time_ranges: WORK_HOURS,
        };
        expect(isWithinTemporalExpression(MON_10AM, window)).toBe(true);
    });

    test('returns false when date matches but time is outside time_ranges', () => {
        const window: SpecificDateWindow = {
            specific_dates: ['2026-02-23'],
            time_ranges: WORK_HOURS,
        };
        expect(isWithinTemporalExpression(MON_2AM, window)).toBe(false);
    });
});

// =============================================================================
// isWithinTemporalExpression — AvailabilityWindow (day_schedules)
// =============================================================================

describe('isWithinTemporalExpression — AvailabilityWindow day_schedules', () => {
    test('returns true for weekday at 10am in Mon-Fri 9-5 window', () => {
        expect(isWithinTemporalExpression(MON_10AM, MON_FRI_9_TO_5)).toBe(true);
        expect(isWithinTemporalExpression(TUE_10AM, MON_FRI_9_TO_5)).toBe(true);
    });

    test('returns false for weekday at 2am (outside work hours)', () => {
        expect(isWithinTemporalExpression(MON_2AM, MON_FRI_9_TO_5)).toBe(false);
    });

    test('returns false for Saturday even during "work hours"', () => {
        expect(isWithinTemporalExpression(SAT_2PM, MON_FRI_9_TO_5)).toBe(false);
    });
});

// =============================================================================
// isWithinTemporalExpression — AvailabilityWindow (time_ranges only)
// =============================================================================

describe('isWithinTemporalExpression — AvailabilityWindow time_ranges only', () => {
    const allDay: AvailabilityWindow = { time_ranges: [{ start_time: '06:00', end_time: '22:00' }] };

    test('returns true when time is within range on any day', () => {
        expect(isWithinTemporalExpression(SAT_2PM, allDay)).toBe(true); // Saturday 14:00
    });

    test('returns false when time is outside range', () => {
        expect(isWithinTemporalExpression(MON_2AM, allDay)).toBe(false); // 02:00 < 06:00
    });
});

// =============================================================================
// isWithinTemporalExpression — AvailabilityWindow (month_schedules)
// =============================================================================

describe('isWithinTemporalExpression — AvailabilityWindow month_schedules', () => {
    // February only, Mon-Fri 9-5
    const febOnly: AvailabilityWindow = {
        month_schedules: [
            {
                month: 2,
                day_schedules: [
                    { days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], time_ranges: WORK_HOURS },
                ],
            },
        ],
    };

    test('returns true for a weekday in February during work hours', () => {
        expect(isWithinTemporalExpression(MON_10AM, febOnly)).toBe(true);
    });

    test('returns false for a date in a different month', () => {
        const mar_10am = new Date('2026-03-02T10:00:00Z'); // Monday in March
        expect(isWithinTemporalExpression(mar_10am, febOnly)).toBe(false);
    });
});

// =============================================================================
// skillsOf + agentsWithSkill
// =============================================================================

describe('Observer — skillsOf / agentsWithSkill', () => {
    let observer: Observer;

    beforeEach(() => {
        idCounter = 0;
        const processReg = new ProcessRegistry();
        observer = new Observer(processReg);
    });

    test('skillsOf returns resources where primaryAccountable matches', () => {
        const r1 = makeResource({ conformsTo: 'spec:welding', quantity: 1, primaryAccountable: 'agent:alice' });
        const r2 = makeResource({ conformsTo: 'spec:driving', quantity: 1, primaryAccountable: 'agent:alice' });
        const r3 = makeResource({ conformsTo: 'spec:welding', quantity: 1, primaryAccountable: 'agent:bob' });
        observer.seedResource(r1);
        observer.seedResource(r2);
        observer.seedResource(r3);

        const aliceSkills = observer.skillsOf('agent:alice');
        expect(aliceSkills).toHaveLength(2);
        expect(aliceSkills.map(r => r.id)).toContain(r1.id);
        expect(aliceSkills.map(r => r.id)).toContain(r2.id);

        const bobSkills = observer.skillsOf('agent:bob');
        expect(bobSkills).toHaveLength(1);
        expect(bobSkills[0].id).toBe(r3.id);
    });

    test('skillsOf returns empty array for agent with no skills', () => {
        expect(observer.skillsOf('agent:unknown')).toHaveLength(0);
    });

    test('agentsWithSkill returns unique agent IDs for a given spec', () => {
        const r1 = makeResource({ conformsTo: 'spec:welding', quantity: 1, primaryAccountable: 'agent:alice' });
        const r2 = makeResource({ conformsTo: 'spec:welding', quantity: 1, primaryAccountable: 'agent:bob' });
        // alice has two welding resources — should appear only once
        const r3 = makeResource({ conformsTo: 'spec:welding', quantity: 1, primaryAccountable: 'agent:alice' });
        const r4 = makeResource({ conformsTo: 'spec:driving', quantity: 1, primaryAccountable: 'agent:carol' });
        observer.seedResource(r1);
        observer.seedResource(r2);
        observer.seedResource(r3);
        observer.seedResource(r4);

        const welders = observer.agentsWithSkill('spec:welding');
        expect(welders).toHaveLength(2);
        expect(welders).toContain('agent:alice');
        expect(welders).toContain('agent:bob');
        expect(welders).not.toContain('agent:carol');
    });

    test('agentsWithSkill ignores resources without primaryAccountable', () => {
        const r1 = makeResource({ conformsTo: 'spec:welding', quantity: 1 }); // no primaryAccountable
        observer.seedResource(r1);
        expect(observer.agentsWithSkill('spec:welding')).toHaveLength(0);
    });
});

// =============================================================================
// netAvailableQty — availability_window filter
// =============================================================================

describe('PlanNetter.netAvailableQty — availability_window', () => {
    let processReg: ProcessRegistry;
    let planStore: PlanStore;
    let observer: Observer;

    beforeEach(() => {
        idCounter = 0;
        processReg = new ProcessRegistry();
        planStore = new PlanStore(processReg);
        observer = new Observer(processReg);
    });

    test('includes resource when asOf is within availability_window', () => {
        const resource = makeResource({
            conformsTo: 'spec:machine',
            quantity: 5,
            availability_window: MON_FRI_9_TO_5,
        });
        observer.seedResource(resource);
        const netter = new PlanNetter(planStore, observer);

        const qty = netter.netAvailableQty('spec:machine', { asOf: MON_10AM });
        expect(qty).toBe(5);
    });

    test('excludes resource when asOf is outside availability_window', () => {
        const resource = makeResource({
            conformsTo: 'spec:machine',
            quantity: 5,
            availability_window: MON_FRI_9_TO_5,
        });
        observer.seedResource(resource);
        const netter = new PlanNetter(planStore, observer);

        const qty = netter.netAvailableQty('spec:machine', { asOf: MON_2AM });
        expect(qty).toBe(0);
    });

    test('ignores availability_window when asOf is not provided (backward compat)', () => {
        const resource = makeResource({
            conformsTo: 'spec:machine',
            quantity: 5,
            availability_window: MON_FRI_9_TO_5,
        });
        observer.seedResource(resource);
        const netter = new PlanNetter(planStore, observer);

        // No asOf → availability_window not checked
        const qty = netter.netAvailableQty('spec:machine');
        expect(qty).toBe(5);
    });

    test('resource without availability_window is always included when asOf provided', () => {
        const resource = makeResource({ conformsTo: 'spec:tool', quantity: 3 });
        observer.seedResource(resource);
        const netter = new PlanNetter(planStore, observer);

        const qty = netter.netAvailableQty('spec:tool', { asOf: MON_2AM });
        expect(qty).toBe(3);
    });

    test('only window-available resources contribute when multiple resources exist', () => {
        const available = makeResource({
            conformsTo: 'spec:machine',
            quantity: 4,
            availability_window: MON_FRI_9_TO_5,
        });
        const unavailable = makeResource({
            conformsTo: 'spec:machine',
            quantity: 6,
            availability_window: {
                day_schedules: [
                    { days: ['saturday', 'sunday'], time_ranges: [{ start_time: '10:00', end_time: '18:00' }] },
                ],
            },
        });
        observer.seedResource(available);
        observer.seedResource(unavailable);
        const netter = new PlanNetter(planStore, observer);

        // Monday 10am: only 'available' resource should be counted
        const qty = netter.netAvailableQty('spec:machine', { asOf: MON_10AM });
        expect(qty).toBe(4);
    });
});
