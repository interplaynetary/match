import * as h3 from 'h3-js';
import { computeH3Index, REMOTE_H3_INDEX, spatialThingToH3 } from './space';
import type { AvailabilityWindow, TemporalExpression, TimeRange, DaySchedule, WeekSchedule, MonthSchedule } from './time';
import { isSpecificDateWindow } from './time';
import type { Intent, Commitment, EconomicEvent, SpatialThing } from '../schemas';

/**
 * Creates a deterministic, normalized string representation of a TimeRange.
 */
function stringifyTimeRange(tr: TimeRange): string {
    return `${tr.start_time}-${tr.end_time}`;
}

/**
 * Creates a deterministic, normalized string representation of a DaySchedule.
 */
function stringifyDaySchedule(ds: DaySchedule): string {
    const days = [...ds.days].sort().join(',');
    const times = ds.time_ranges.map(stringifyTimeRange).sort().join(',');
    return `(${days})@(${times})`;
}

/**
 * Creates a deterministic, normalized string representation of a WeekSchedule.
 */
function stringifyWeekSchedule(ws: WeekSchedule): string {
    const weeks = [...ws.weeks].sort().join(',');
    const days = ws.day_schedules.map(stringifyDaySchedule).sort().join(',');
    return `W(${weeks})->[${days}]`;
}

/**
 * Creates a deterministic, normalized string representation of an AvailabilityWindow.
 * It sorts all arrays to ensure identical windows produce the exact same string bucket.
 * This preserves the full power and precision of the Schema without loss of information.
 */
export function getCanonicalAvailabilityWindow(window: AvailabilityWindow): string {
    const parts: string[] = [];

    if (window.month_schedules?.length) {
        const sortedMonths = [...window.month_schedules].sort((a, b) => a.month - b.month);
        const monthStrs = sortedMonths.map(m => {
            let mStr = `M${m.month}`;
            if (m.week_schedules?.length) mStr += `W[${m.week_schedules.map(stringifyWeekSchedule).sort().join('|')}]`;
            if (m.day_schedules?.length) mStr += `D[${m.day_schedules.map(stringifyDaySchedule).sort().join('|')}]`;
            if (m.time_ranges?.length) mStr += `T[${m.time_ranges.map(stringifyTimeRange).sort().join('|')}]`;
            return mStr;
        });
        parts.push(`Months:${monthStrs.join(',')}`);
    }

    if (window.week_schedules?.length) {
        parts.push(`Weeks:${window.week_schedules.map(stringifyWeekSchedule).sort().join(',')}`);
    }

    if (window.day_schedules?.length) {
        parts.push(`Days:${window.day_schedules.map(stringifyDaySchedule).sort().join(',')}`);
    }

    if (window.time_ranges?.length) {
        parts.push(`Times:${window.time_ranges.map(stringifyTimeRange).sort().join(',')}`);
    }

    return parts.length > 0 ? parts.join(';') : 'always';
}

/**
 * Generates a purely temporal bucket string with absolute precision.
 */
export function getTimeSignature(slot: {
    availability_window?: TemporalExpression;
    start_date?: string | null;
    end_date?: string | null;
    recurrence?: string | null;
}): string {
    if (slot.availability_window) {
        if (isSpecificDateWindow(slot.availability_window)) {
            const dates = [...slot.availability_window.specific_dates].sort().join(',');
            return `specific|${dates}`;
        }
        return `recurring|${getCanonicalAvailabilityWindow(slot.availability_window)}`;
    } else {
        return [slot.start_date || 'any', slot.end_date || 'any', slot.recurrence || 'onetime'].join('|');
    }
}

/**
 * Extract the YYYY-MM-DD date key from an ISO datetime string.
 * Used to bin one-time VF types (EconomicEvent, Commitment, Proposal)
 * into the TemporalIndex.specific_dates map.
 */
export function toDateKey(iso: string | null | undefined): string | undefined {
    return iso ? iso.slice(0, 10) : undefined;
}

/**
 * Wrap a YYYY-MM-DD date key into a SpecificDateWindow TemporalExpression.
 *
 * Canonical helper — import this instead of defining locally in each index file.
 * Returns undefined when the date key is absent, so the item falls to full_time.
 */
export function wrapDate(dateKey: string | undefined): TemporalExpression | undefined {
    return dateKey ? { specific_dates: [dateKey] } : undefined;
}

/**
 * Decompose a YYYY-MM-DD string into the calendar components used throughout
 * the temporal indexing and recurrence systems.
 *
 * Always uses noon UTC (`T12:00:00Z`) to avoid DST edge cases — dates near
 * midnight can shift to a different local day depending on timezone offset.
 *
 * This is the single canonical implementation.  Both space-time-index.ts
 * (for index queries) and recurrence.ts (for occurrence matching) import it.
 *
 *   day   — lowercase day-of-week matching DayOfWeek enum ('monday' … 'sunday')
 *   week  — week-of-month 1–5, defined as Math.ceil(dayOfMonth / 7)
 *   month — calendar month 1–12
 */
export function calendarComponents(isoDate: string): {
    day: DayOfWeek;
    week: number;
    month: number;
} {
    const DAY_NAMES: DayOfWeek[] = [
        'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ];
    const d = new Date(`${isoDate}T12:00:00Z`);
    return {
        day:   DAY_NAMES[d.getUTCDay()],
        week:  Math.ceil(d.getUTCDate() / 7),
        month: d.getUTCMonth() + 1,
    };
}

/**
 * Interface representing the spatial and temporal context needed to compute a signature
 */
export interface SpaceTimeContext {
    location_type?: string;
    online_link?: string;
    h3_index?: string;
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    availability_window?: TemporalExpression;
    start_date?: string | null;
    end_date?: string | null;
    recurrence?: string | null;
}

/**
 * Generates an accurate space-time bucket string.
 * Spatial buckets natively use H3 Resolution 7 bounding (~1.2km radius)
 * by default to cluster local slots intelligently.
 */
export function getSpaceTimeSignature(
    slot: SpaceTimeContext,
    h3Resolution: number = 7
): string {
    const timeKey = getTimeSignature(slot);
    
    let locKey = REMOTE_H3_INDEX;
    
    // Check if it's explicitly remote
    if (!slot.location_type?.includes('remote') && !slot.online_link) {
        // If they provided an H3 hex, truncate/expand it to our bucketing resolution
        if (slot.h3_index) {
            const currentRes = h3.getResolution(slot.h3_index);
            if (currentRes === h3Resolution) {
                locKey = slot.h3_index;
            } else if (currentRes > h3Resolution) {
                locKey = h3.cellToParent(slot.h3_index, h3Resolution); 
            } else {
                // If it's coarser than our target, we just use it as is
                locKey = slot.h3_index;
            }
        } 
        // Compute H3 from lat/lng if available
        else if (slot.latitude !== undefined && slot.longitude !== undefined) {
           locKey = computeH3Index(slot as any, h3Resolution);
        }
        // Absolute fallback if only strings provided
        else {
           locKey = [slot.city || 'any', slot.country || 'any'].join('|');
        }
    }

    return `${timeKey}::${locKey}`;
}

/**
 * Interface that includes quantity for grouping algorithms
 */
export interface QuantifiedSpaceTimeContext extends SpaceTimeContext {
    quantity: number;
}

/**
 * Groups a collection of slots by their exact Space-Time properties
 */
export function groupSlotsBySpaceTime<T extends QuantifiedSpaceTimeContext>(
    slots: T[],
    h3Resolution: number = 7
): Map<string, { quantity: number; slots: T[] }> {
    const groups = new Map<string, { quantity: number; slots: T[] }>();
    for (const slot of slots) {
        const sig = getSpaceTimeSignature(slot, h3Resolution);
        const ex = groups.get(sig);
        if (ex) {
            ex.quantity += slot.quantity;
            ex.slots.push(slot);
        } else {
            groups.set(sig, { quantity: slot.quantity, slots: [slot] });
        }
    }
    return groups;
}

// =============================================================================
// VF BRIDGES — convert VF planning/observation types to SpaceTimeContext
// =============================================================================

/**
 * Extract the spatial component of a SpaceTimeContext from a resolved SpatialThing.
 * VF SpatialThing uses `lat`/`long` (not `latitude`/`longitude`).
 * Returns only the spatial fields; time fields are left to the caller.
 */
function spatialContextFromSpatialThing(
    st: SpatialThing | undefined,
    h3Resolution: number = 7,
): Pick<SpaceTimeContext, 'latitude' | 'longitude' | 'h3_index'> {
    if (!st) return {};
    return {
        latitude: st.lat,
        longitude: st.long,
        h3_index: spatialThingToH3(st, h3Resolution),
    };
}

/**
 * Convert a VF Intent to a SpaceTimeContext for bucketing/indexing.
 *
 * Time mapping:
 *   availability_window (if present) → recurring pattern, takes precedence
 *   hasBeginning → start_date (point-in-time fallback)
 *   hasEnd / due → end_date  (hasEnd takes precedence)
 *   hasPointInTime → both start_date and end_date (instantaneous)
 *
 * When availability_window is set, getSpaceTimeSignature will produce a
 * `recurring|...` key, correctly separating standing offers from one-off requests.
 *
 * @param intent    - VF Intent
 * @param location  - Resolved SpatialThing for intent.atLocation (caller must resolve the ID)
 * @param h3Resolution - H3 resolution for spatial bucketing (default 7 ≈ 1km)
 */
export function intentToSpaceTimeContext(
    intent: Intent,
    location?: SpatialThing,
    h3Resolution: number = 7,
): SpaceTimeContext {
    const spatial = spatialContextFromSpatialThing(location, h3Resolution);

    const start_date = intent.hasBeginning
        ?? intent.hasPointInTime
        ?? null;

    const end_date = intent.hasEnd
        ?? intent.due
        ?? intent.hasPointInTime
        ?? null;

    return {
        ...spatial,
        availability_window: intent.availability_window, // undefined when not a standing offer
        start_date,
        end_date,
        recurrence: null,
    };
}

/**
 * Convert a VF Commitment to a SpaceTimeContext for bucketing/indexing.
 *
 * Time mapping identical to intentToSpaceTimeContext.
 *
 * @param commitment - VF Commitment
 * @param location   - Resolved SpatialThing for commitment.atLocation
 * @param h3Resolution - H3 resolution for spatial bucketing (default 7 ≈ 1km)
 */
export function commitmentToSpaceTimeContext(
    commitment: Commitment,
    location?: SpatialThing,
    h3Resolution: number = 7,
): SpaceTimeContext {
    const spatial = spatialContextFromSpatialThing(location, h3Resolution);

    const start_date = commitment.hasBeginning
        ?? commitment.hasPointInTime
        ?? null;

    const end_date = commitment.hasEnd
        ?? commitment.due
        ?? commitment.hasPointInTime
        ?? null;

    return {
        ...spatial,
        availability_window: commitment.availability_window,
        start_date,
        end_date,
        recurrence: null,
    };
}

/**
 * Convert a VF EconomicEvent to a SpaceTimeContext.
 * Useful for indexing observed events spatially and temporally.
 * Uses atLocation (where event occurred); toLocation is ignored here
 * since SpaceTimeContext represents a single place.
 *
 * @param event    - VF EconomicEvent
 * @param location - Resolved SpatialThing for event.atLocation
 * @param h3Resolution - H3 resolution for spatial bucketing (default 7 ≈ 1km)
 */
export function economicEventToSpaceTimeContext(
    event: EconomicEvent,
    location?: SpatialThing,
    h3Resolution: number = 7,
): SpaceTimeContext {
    const spatial = spatialContextFromSpatialThing(location, h3Resolution);

    const start_date = event.hasBeginning
        ?? event.hasPointInTime
        ?? event.created
        ?? null;

    const end_date = event.hasEnd
        ?? event.hasPointInTime
        ?? event.created
        ?? null;

    return {
        ...spatial,
        start_date,
        end_date,
        recurrence: null,
    };
}
