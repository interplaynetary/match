/**
 * Lazy Per-Occurrence Fulfillment Utilities
 *
 * Core idea: an "occurrence" of a recurring Commitment or Intent is not a
 * stored record — it is derived lazily from the date embedded in whichever
 * EconomicEvent arrives to fulfill/satisfy it.
 *
 * This means:
 *   - No occurrence registry to maintain
 *   - Fulfilled occurrences emerge from events as they are recorded
 *   - Unfulfilled occurrences are implicitly absent from the map
 *   - Enumerating unfulfilled slots (e.g. "which Mondays have no event yet?")
 *     requires the eager `materializeOccurrenceDates` path — use sparingly
 *
 * The boundary between planning and observation is preserved:
 *   Commitment  — the recurring contract (planning layer)
 *   EconomicEvent — each realized instance (observation layer, always point-in-time)
 *   OccurrenceStatus — derived view joining the two (analytics layer)
 */

import type { AvailabilityWindow } from './time';
import { calendarComponents, toDateKey } from './space-time-keys';
import type { EconomicEvent, Commitment } from '../schemas';

// =============================================================================
// OCCURRENCE STATUS
// =============================================================================

/**
 * Fulfillment status for a single occurrence (one date) of a recurring Commitment.
 *
 * Derived lazily: only dates that have at least one fulfilling event appear.
 * Dates with no events are implicitly unfulfilled — gap = full committed quantity.
 */
export interface OccurrenceStatus {
    /** YYYY-MM-DD — the occurrence date */
    date: string;

    /** IDs of EconomicEvents that fell on this date */
    events: string[];

    fulfilled_quantity: number;   // sum of event.resourceQuantity on this date
    fulfilled_hours: number;      // sum of event.effortQuantity on this date

    committed_quantity: number;   // commitment.resourceQuantity (per-occurrence expectation)
    committed_hours: number;      // commitment.effortQuantity (per-occurrence expectation)

    /** true when fulfilled >= committed for both quantity and hours */
    finished: boolean;
}

// =============================================================================
// LAZY CORE — derive occurrences from arriving events
// =============================================================================

/**
 * Extract the occurrence date key from an EconomicEvent.
 * Prefers hasPointInTime (instantaneous) → hasBeginning → created.
 * Returns undefined if no date is available.
 */
export function occurrenceDateKey(event: EconomicEvent): string | undefined {
    return toDateKey(event.hasPointInTime ?? event.hasBeginning ?? event.created);
}

/**
 * Group a set of EconomicEvents by their occurrence date key.
 *
 * This is the lazy core: no window knowledge needed, no occurrence registry.
 * Events with no date are silently skipped.
 * Occurrences with no events simply do not appear in the result.
 */
export function groupEventsByOccurrence(
    events: EconomicEvent[],
): Map<string, EconomicEvent[]> {
    const groups = new Map<string, EconomicEvent[]>();
    for (const event of events) {
        const key = occurrenceDateKey(event);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(event);
    }
    return groups;
}

/**
 * Compute per-occurrence fulfillment status for a recurring Commitment.
 *
 * Only dates that have at least one event appear in the result.
 * For a date with no events: status is implicitly { fulfilled: 0, gap: committed }.
 *
 * @param commitment  The recurring Commitment (source of per-occurrence expectation)
 * @param eventsByOccurrence  Output of groupEventsByOccurrence()
 */
export function getOccurrenceStatus(
    commitment: Commitment,
    eventsByOccurrence: Map<string, EconomicEvent[]>,
): Map<string, OccurrenceStatus> {
    const committedQty   = commitment.resourceQuantity?.hasNumericalValue ?? 0;
    const committedHours = commitment.effortQuantity?.hasNumericalValue   ?? 0;

    const result = new Map<string, OccurrenceStatus>();

    for (const [date, events] of eventsByOccurrence) {
        const fulfilledQty   = events.reduce((s, e) => s + (e.resourceQuantity?.hasNumericalValue ?? 0), 0);
        const fulfilledHours = events.reduce((s, e) => s + (e.effortQuantity?.hasNumericalValue   ?? 0), 0);

        result.set(date, {
            date,
            events: events.map(e => e.id),
            fulfilled_quantity: fulfilledQty,
            fulfilled_hours:    fulfilledHours,
            committed_quantity: committedQty,
            committed_hours:    committedHours,
            finished: fulfilledQty >= committedQty && fulfilledHours >= committedHours,
        });
    }

    return result;
}

// =============================================================================
// EAGER PATH — enumerate expected dates (use sparingly)
// =============================================================================

/**
 * Returns true if a given calendar date falls within an AvailabilityWindow pattern.
 *
 * Priority hierarchy (mirrors TemporalIndex structure in space-time-index.ts):
 *   month_schedules > week_schedules > day_schedules > time_ranges
 *
 * Accepts a YYYY-MM-DD string; uses calendarComponents (UTC noon) for consistency
 * with the temporal index and spatial signature systems.
 */
export function dateMatchesWindow(isoDate: string, window: AvailabilityWindow): boolean {
    const { day, week, month } = calendarComponents(isoDate);

    // Level 1: month_schedules
    if (window.month_schedules?.length) {
        const mSched = window.month_schedules.find(m => m.month === month);
        if (!mSched) return false;

        if (mSched.week_schedules?.length) {
            const wSched = mSched.week_schedules.find(w => w.weeks.includes(week));
            if (!wSched) return false;
            if (wSched.day_schedules?.length) {
                return wSched.day_schedules.some(d => d.days.includes(day));
            }
            return true; // whole week within this month matches
        }
        if (mSched.day_schedules?.length) {
            return mSched.day_schedules.some(d => d.days.includes(day));
        }
        return true; // whole month matches
    }

    // Level 2: week_schedules (all months)
    if (window.week_schedules?.length) {
        const wSched = window.week_schedules.find(w => w.weeks.includes(week));
        if (!wSched) return false;
        if (wSched.day_schedules?.length) {
            return wSched.day_schedules.some(d => d.days.includes(day));
        }
        return true; // whole week matches
    }

    // Level 3: day_schedules (all weeks, all months)
    if (window.day_schedules?.length) {
        return window.day_schedules.some(d => d.days.includes(day));
    }

    // Level 4: time_ranges — any day at specified times
    if (window.time_ranges?.length) return true;

    return false;
}

/**
 * Enumerate all dates in [from, to] that match an AvailabilityWindow.
 *
 * Use this only when you need to find UNFULFILLED occurrences — i.e. expected
 * dates that have no events yet. For fulfilled-slot analysis, prefer
 * groupEventsByOccurrence() which is O(events) rather than O(days).
 *
 * @param window  The recurring pattern to match against
 * @param from    Start date inclusive (YYYY-MM-DD)
 * @param to      End date inclusive (YYYY-MM-DD)
 */
export function materializeOccurrenceDates(
    window: AvailabilityWindow,
    from: string,
    to: string,
): string[] {
    const results: string[] = [];
    const cursor = new Date(`${from}T12:00:00Z`); // noon UTC avoids DST edge cases
    const end    = new Date(`${to}T12:00:00Z`);

    while (cursor <= end) {
        const isoDate = cursor.toISOString().slice(0, 10);
        if (dateMatchesWindow(isoDate, window)) {
            results.push(isoDate);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return results;
}

/**
 * Convenience: find which expected occurrences in [from, to] have no fulfilling events.
 *
 * Returns the dates that appear in materializeOccurrenceDates but NOT in
 * groupEventsByOccurrence — i.e. the gaps.
 */
export function unfulfilledOccurrences(
    window: AvailabilityWindow,
    from: string,
    to: string,
    eventsByOccurrence: Map<string, EconomicEvent[]>,
): string[] {
    return materializeOccurrenceDates(window, from, to)
        .filter(date => !eventsByOccurrence.has(date));
}
