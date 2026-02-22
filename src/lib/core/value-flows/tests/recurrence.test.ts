import { describe, expect, test } from 'bun:test';
import {
    dateMatchesWindow,
    materializeOccurrenceDates,
    unfulfilledOccurrences,
    groupEventsByOccurrence,
    getOccurrenceStatus,
    occurrenceDateKey,
} from '../utils/recurrence';
import type { AvailabilityWindow } from '../utils/time';
import type { EconomicEvent, Commitment } from '../schemas';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build an EconomicEvent with the fields needed for recurrence tests */
function makeEvent(id: string, hasPointInTime?: string, qty?: number): EconomicEvent {
    return {
        id,
        action: 'transfer',
        hasPointInTime,
        resourceQuantity: qty !== undefined ? { hasNumericalValue: qty, hasUnit: 'kg' } : undefined,
    };
}

/** Build a Commitment with per-occurrence expectations */
function makeCommitment(id: string, resourceQty?: number, effortHrs?: number): Commitment {
    return {
        id,
        action: 'transfer',
        finished: false,
        resourceQuantity: resourceQty !== undefined
            ? { hasNumericalValue: resourceQty, hasUnit: 'kg' }
            : undefined,
        effortQuantity: effortHrs !== undefined
            ? { hasNumericalValue: effortHrs, hasUnit: 'hours' }
            : undefined,
    };
}

// ─── dateMatchesWindow ────────────────────────────────────────────────────────

describe('dateMatchesWindow', () => {

    /**
     * February/March 2026 calendar:
     *   Feb 1 = Sunday. Feb 2 = Monday (week 1), Feb 9 = Monday (week 2), Feb 16 (week 3)
     *   March 1 = Sunday. March 2 = Monday (week 1), March 9 = Monday (week 2)
     *
     * week = Math.ceil(day-of-month / 7)
     */

    test('day_schedules: every Monday matches Mondays only', () => {
        const window: AvailabilityWindow = {
            day_schedules: [{ days: ['monday'], time_ranges: [] }],
        };

        // Mondays
        expect(dateMatchesWindow('2026-02-02', window)).toBe(true);
        expect(dateMatchesWindow('2026-02-09', window)).toBe(true);
        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);

        // Other days
        expect(dateMatchesWindow('2026-02-03', window)).toBe(false); // Tuesday
        expect(dateMatchesWindow('2026-02-07', window)).toBe(false); // Saturday
        expect(dateMatchesWindow('2026-02-08', window)).toBe(false); // Sunday
    });

    test('day_schedules: multi-day pattern matches each listed day', () => {
        const window: AvailabilityWindow = {
            day_schedules: [{ days: ['monday', 'wednesday', 'friday'], time_ranges: [] }],
        };

        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);  // Monday
        expect(dateMatchesWindow('2026-03-04', window)).toBe(true);  // Wednesday
        expect(dateMatchesWindow('2026-03-06', window)).toBe(true);  // Friday
        expect(dateMatchesWindow('2026-03-03', window)).toBe(false); // Tuesday
        expect(dateMatchesWindow('2026-03-07', window)).toBe(false); // Saturday
    });

    test('week_schedules: first and third week only', () => {
        // week = Math.ceil(dayOfMonth / 7): weeks 1 (1–7) and 3 (15–21)
        const window: AvailabilityWindow = {
            week_schedules: [{ weeks: [1, 3], day_schedules: [] }],
        };

        // Week 1 of March: 1–7
        expect(dateMatchesWindow('2026-03-01', window)).toBe(true);
        expect(dateMatchesWindow('2026-03-07', window)).toBe(true);
        // Week 2 of March: 8–14
        expect(dateMatchesWindow('2026-03-08', window)).toBe(false);
        expect(dateMatchesWindow('2026-03-14', window)).toBe(false);
        // Week 3 of March: 15–21
        expect(dateMatchesWindow('2026-03-15', window)).toBe(true);
        expect(dateMatchesWindow('2026-03-21', window)).toBe(true);
        // Week 4 of March: 22–28
        expect(dateMatchesWindow('2026-03-22', window)).toBe(false);
    });

    test('week_schedules + day_schedules: first week Mondays only', () => {
        const window: AvailabilityWindow = {
            week_schedules: [{
                weeks: [1],
                day_schedules: [{ days: ['monday'], time_ranges: [] }],
            }],
        };

        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);  // week 1, Monday
        expect(dateMatchesWindow('2026-03-01', window)).toBe(false); // week 1, Sunday
        expect(dateMatchesWindow('2026-03-09', window)).toBe(false); // week 2, Monday
    });

    test('month_schedules: only March matches', () => {
        const window: AvailabilityWindow = {
            month_schedules: [{ month: 3 }],
        };

        expect(dateMatchesWindow('2026-03-15', window)).toBe(true);
        expect(dateMatchesWindow('2026-02-15', window)).toBe(false);
        expect(dateMatchesWindow('2026-04-15', window)).toBe(false);
    });

    test('month_schedules + day_schedules: March Mondays', () => {
        const window: AvailabilityWindow = {
            month_schedules: [{
                month: 3,
                day_schedules: [{ days: ['monday'], time_ranges: [] }],
            }],
        };

        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);  // March Monday
        expect(dateMatchesWindow('2026-03-03', window)).toBe(false); // March Tuesday
        expect(dateMatchesWindow('2026-02-02', window)).toBe(false); // February Monday — wrong month
    });

    test('month_schedules + week_schedules + day_schedules: March week-1 Mondays', () => {
        const window: AvailabilityWindow = {
            month_schedules: [{
                month: 3,
                week_schedules: [{
                    weeks: [1],
                    day_schedules: [{ days: ['monday'], time_ranges: [] }],
                }],
            }],
        };

        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);  // March, week 1, Monday
        expect(dateMatchesWindow('2026-03-09', window)).toBe(false); // March, week 2, Monday
        expect(dateMatchesWindow('2026-03-01', window)).toBe(false); // March, week 1, Sunday
        expect(dateMatchesWindow('2026-02-02', window)).toBe(false); // February (wrong month)
    });

    test('top-level time_ranges: every day matches', () => {
        const window: AvailabilityWindow = {
            time_ranges: [{ start_time: '09:00', end_time: '17:00' }],
        };

        expect(dateMatchesWindow('2026-03-02', window)).toBe(true);  // Monday
        expect(dateMatchesWindow('2026-03-07', window)).toBe(true);  // Saturday
        expect(dateMatchesWindow('2026-01-01', window)).toBe(true);  // any date
    });
});

// ─── materializeOccurrenceDates ───────────────────────────────────────────────

describe('materializeOccurrenceDates', () => {

    test('every Monday in a two-week window produces exactly 2 dates', () => {
        const window: AvailabilityWindow = {
            day_schedules: [{ days: ['monday'], time_ranges: [] }],
        };

        // 2026-03-02 to 2026-03-15 inclusive = two Mondays (2nd and 9th)
        const dates = materializeOccurrenceDates(window, '2026-03-02', '2026-03-15');
        expect(dates).toEqual(['2026-03-02', '2026-03-09']);
    });

    test('start and end dates are inclusive', () => {
        const window: AvailabilityWindow = {
            day_schedules: [{ days: ['monday'], time_ranges: [] }],
        };

        // 2026-03-02 is itself a Monday → should appear
        const dates = materializeOccurrenceDates(window, '2026-03-02', '2026-03-02');
        expect(dates).toEqual(['2026-03-02']);
    });

    test('empty result when no days match in the range', () => {
        const window: AvailabilityWindow = {
            day_schedules: [{ days: ['saturday'], time_ranges: [] }],
        };

        // Monday–Friday only
        const dates = materializeOccurrenceDates(window, '2026-03-02', '2026-03-06');
        expect(dates).toEqual([]);
    });

    test('week_schedules: first week of each month over two months', () => {
        // Only first week (days 1–7) matches
        const window: AvailabilityWindow = {
            week_schedules: [{ weeks: [1], day_schedules: [] }],
        };

        const dates = materializeOccurrenceDates(window, '2026-03-01', '2026-04-07');

        // March week 1: March 1–7; April week 1: April 1–7
        expect(dates.length).toBe(14);
        expect(dates[0]).toBe('2026-03-01');
        expect(dates[6]).toBe('2026-03-07');
        expect(dates[7]).toBe('2026-04-01');
        expect(dates[13]).toBe('2026-04-07');
    });

    test('month_schedules: only March days are returned across a wider range', () => {
        const window: AvailabilityWindow = {
            month_schedules: [{ month: 3 }],
        };

        const dates = materializeOccurrenceDates(window, '2026-02-15', '2026-04-15');

        // Only March 1–31 should appear (31 days)
        expect(dates.length).toBe(31);
        expect(dates[0]).toBe('2026-03-01');
        expect(dates[30]).toBe('2026-03-31');
    });
});

// ─── unfulfilledOccurrences ───────────────────────────────────────────────────

describe('unfulfilledOccurrences', () => {

    const everyMonday: AvailabilityWindow = {
        day_schedules: [{ days: ['monday'], time_ranges: [] }],
    };

    test('returns the second Monday when only the first is fulfilled', () => {
        // Events that fulfill the first Monday
        const events = [makeEvent('e1', '2026-03-02T10:00:00Z')];
        const byOccurrence = groupEventsByOccurrence(events);

        const gaps = unfulfilledOccurrences(everyMonday, '2026-03-02', '2026-03-15', byOccurrence);

        expect(gaps).toEqual(['2026-03-09']);
    });

    test('returns empty when all occurrences are fulfilled', () => {
        const events = [
            makeEvent('e1', '2026-03-02T10:00:00Z'),
            makeEvent('e2', '2026-03-09T10:00:00Z'),
        ];
        const byOccurrence = groupEventsByOccurrence(events);

        const gaps = unfulfilledOccurrences(everyMonday, '2026-03-02', '2026-03-15', byOccurrence);

        expect(gaps).toEqual([]);
    });

    test('returns all occurrences when no events exist', () => {
        const byOccurrence = groupEventsByOccurrence([]);

        const gaps = unfulfilledOccurrences(everyMonday, '2026-03-02', '2026-03-16', byOccurrence);

        // March 2, 9, 16 are Mondays
        expect(gaps).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
    });

    test('events on non-occurrence dates do not count as fulfillment', () => {
        // Tuesday event — not a Monday, doesn't fulfill a Monday occurrence
        const events = [makeEvent('e1', '2026-03-03T10:00:00Z')];
        const byOccurrence = groupEventsByOccurrence(events);

        const gaps = unfulfilledOccurrences(everyMonday, '2026-03-02', '2026-03-09', byOccurrence);

        // Both Mondays are still unfulfilled
        expect(gaps).toEqual(['2026-03-02', '2026-03-09']);
    });
});

// ─── groupEventsByOccurrence ─────────────────────────────────────────────────

describe('groupEventsByOccurrence', () => {

    test('groups events by YYYY-MM-DD date key', () => {
        const events = [
            makeEvent('e1', '2026-03-02T09:00:00Z'),
            makeEvent('e2', '2026-03-09T14:00:00Z'),
            makeEvent('e3', '2026-03-02T16:00:00Z'), // same day as e1
        ];

        const groups = groupEventsByOccurrence(events);

        expect(groups.size).toBe(2);
        expect(groups.get('2026-03-02')?.map(e => e.id).sort()).toEqual(['e1', 'e3']);
        expect(groups.get('2026-03-09')?.map(e => e.id)).toEqual(['e2']);
    });

    test('events without any date are silently skipped', () => {
        const events: EconomicEvent[] = [
            { id: 'no-date', action: 'transfer' },
            makeEvent('has-date', '2026-03-02T10:00:00Z'),
        ];

        const groups = groupEventsByOccurrence(events);

        expect(groups.size).toBe(1);
        expect(groups.has('2026-03-02')).toBe(true);
        // 'no-date' event not in any group
        expect(Array.from(groups.values()).flat().map(e => e.id)).not.toContain('no-date');
    });

    test('prefers hasPointInTime over hasBeginning for the date key', () => {
        const event: EconomicEvent = {
            id: 'e1',
            action: 'transfer',
            hasPointInTime: '2026-03-02T10:00:00Z',
            hasBeginning: '2026-03-09T10:00:00Z', // different date — should be ignored
        };

        const groups = groupEventsByOccurrence([event]);

        expect(groups.has('2026-03-02')).toBe(true);
        expect(groups.has('2026-03-09')).toBe(false);
    });

    test('falls back to hasBeginning when hasPointInTime is absent', () => {
        const event: EconomicEvent = {
            id: 'e1',
            action: 'transfer',
            hasBeginning: '2026-03-09T08:00:00Z',
        };

        const groups = groupEventsByOccurrence([event]);

        expect(groups.has('2026-03-09')).toBe(true);
    });

    test('empty event list produces empty map', () => {
        expect(groupEventsByOccurrence([]).size).toBe(0);
    });
});

// ─── occurrenceDateKey ────────────────────────────────────────────────────────

describe('occurrenceDateKey', () => {

    test('returns YYYY-MM-DD from hasPointInTime', () => {
        expect(occurrenceDateKey(makeEvent('e', '2026-03-15T10:00:00Z'))).toBe('2026-03-15');
    });

    test('returns undefined when no date fields are set', () => {
        expect(occurrenceDateKey({ id: 'x', action: 'transfer' })).toBeUndefined();
    });
});

// ─── getOccurrenceStatus ─────────────────────────────────────────────────────

describe('getOccurrenceStatus', () => {

    test('fully fulfilled quantity marks finished: true', () => {
        const commitment = makeCommitment('c1', 100);
        const events = [makeEvent('e1', '2026-03-02T10:00:00Z', 100)];
        const byOcc = groupEventsByOccurrence(events);

        const status = getOccurrenceStatus(commitment, byOcc);

        const occ = status.get('2026-03-02')!;
        expect(occ).toBeDefined();
        expect(occ.fulfilled_quantity).toBe(100);
        expect(occ.committed_quantity).toBe(100);
        expect(occ.finished).toBe(true);
    });

    test('partial fulfillment marks finished: false', () => {
        const commitment = makeCommitment('c1', 100);
        const events = [makeEvent('e1', '2026-03-02T10:00:00Z', 40)];
        const byOcc = groupEventsByOccurrence(events);

        const status = getOccurrenceStatus(commitment, byOcc);

        const occ = status.get('2026-03-02')!;
        expect(occ.fulfilled_quantity).toBe(40);
        expect(occ.committed_quantity).toBe(100);
        expect(occ.finished).toBe(false);
    });

    test('multiple events on same date are summed', () => {
        const commitment = makeCommitment('c1', 100);
        const events = [
            makeEvent('e1', '2026-03-02T09:00:00Z', 60),
            makeEvent('e2', '2026-03-02T14:00:00Z', 40),
        ];
        const byOcc = groupEventsByOccurrence(events);

        const status = getOccurrenceStatus(commitment, byOcc);

        const occ = status.get('2026-03-02')!;
        expect(occ.fulfilled_quantity).toBe(100);
        expect(occ.finished).toBe(true);
        expect(occ.events).toContain('e1');
        expect(occ.events).toContain('e2');
    });

    test('effort hours tracked separately from quantities', () => {
        // Commitment requires both 100 kg AND 5 hours
        const commitment = makeCommitment('c1', 100, 5);
        // Event delivers 100 kg but only 3 hours → not fully finished
        const events: EconomicEvent[] = [{
            id: 'e1',
            action: 'work',
            hasPointInTime: '2026-03-02T10:00:00Z',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            effortQuantity: { hasNumericalValue: 3, hasUnit: 'hours' },
        }];
        const byOcc = groupEventsByOccurrence(events);

        const status = getOccurrenceStatus(commitment, byOcc);

        const occ = status.get('2026-03-02')!;
        expect(occ.fulfilled_quantity).toBe(100);
        expect(occ.fulfilled_hours).toBe(3);
        expect(occ.committed_hours).toBe(5);
        expect(occ.finished).toBe(false); // hours not met
    });

    test('dates with no events do not appear in the result', () => {
        const commitment = makeCommitment('c1', 100);
        // Event on March 2 only; March 9 has no event
        const events = [makeEvent('e1', '2026-03-02T10:00:00Z', 100)];
        const byOcc = groupEventsByOccurrence(events);

        const status = getOccurrenceStatus(commitment, byOcc);

        // Only March 2 appears
        expect(status.size).toBe(1);
        expect(status.has('2026-03-02')).toBe(true);
        expect(status.has('2026-03-09')).toBe(false);
    });

    test('empty event map produces empty status', () => {
        const commitment = makeCommitment('c1', 100);
        const status = getOccurrenceStatus(commitment, new Map());
        expect(status.size).toBe(0);
    });
});
