import { z } from 'zod';
// ═══════════════════════════════════════════════════════════════════
// AVAILABILITY WINDOW SYSTEM (for precise recurrence matching)
// ═══════════════════════════════════════════════════════════════════

/**
 * Time Range within a day
 * Example: { start_time: '09:00', end_time: '17:00' }
 */
export const TimeRangeSchema = z.object({
    start_time: z.string(), // HH:MM format
    end_time: z.string()     // HH:MM format
});

export type TimeRange = z.infer<typeof TimeRangeSchema>;

/**
 * Days of the week (for weekly/monthly recurrence)
 */
export const DayOfWeekSchema = z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
]);

export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

/**
 * Day Schedule - Associates specific days with specific time ranges
 * 
 * This allows expressing patterns like:
 * - "Monday & Friday: 9am-12pm, Tuesday: 2pm-5pm"
 * - "Weekends: 10am-6pm, Weekdays: 9am-5pm"
 */
export const DayScheduleSchema = z.object({
    days: z.array(DayOfWeekSchema),
    time_ranges: z.array(TimeRangeSchema)
});

export type DaySchedule = z.infer<typeof DayScheduleSchema>;

/**
 * Week Schedule - Associates specific weeks of a month with day/time patterns
 * 
 * Allows expressing:
 * - "First and third week: Monday-Friday 9-5"
 * - "Second week: Tuesday only 2-4"
 */
export const WeekScheduleSchema = z.object({
    weeks: z.array(z.number().int().min(1).max(5)),  // 1-5 (which weeks)
    day_schedules: z.array(DayScheduleSchema)
});

export type WeekSchedule = z.infer<typeof WeekScheduleSchema>;

/**
 * Month Schedule - Associates a specific month with week/day/time patterns
 * 
 * Allows expressing:
 * - "February: all weeks, Monday/Wednesday 9-12"
 * - "September: first week only, all weekdays 10-5"
 * - "October: second week Tuesday 2-4, fourth week Monday/Wednesday 9-12"
 */
export const MonthScheduleSchema = z.object({
    month: z.number().int().min(1).max(12),  // 1-12 (January-December)

    // OPTION 1: Week-specific patterns within this month (most flexible)
    week_schedules: z.array(WeekScheduleSchema).optional(),

    // OPTION 2: Simple day schedules for all weeks in this month
    day_schedules: z.array(DayScheduleSchema).optional(),

    // OPTION 3: Same times every day, all weeks in this month
    time_ranges: z.array(TimeRangeSchema).optional()
});

export type MonthSchedule = z.infer<typeof MonthScheduleSchema>;

/**
 * Availability Window - Hierarchical definition of recurring availability
 * 
 * THREE LEVELS OF SPECIFICITY:
 * 
 * LEVEL 1 (Most Specific): Month-specific patterns
 *   month_schedules: [
 *     { month: 2, day_schedules: [...] },           // February: specific days/times
 *     { month: 9, week_schedules: [                 // September: week-specific
 *       { weeks: [1], day_schedules: [...] }
 *     ]},
 *     { month: 10, week_schedules: [                // October: multiple week patterns
 *       { weeks: [2], day_schedules: [{ days: ['tuesday'], ... }] },
 *       { weeks: [4], day_schedules: [...] }
 *     ]}
 *   ]
 * 
 * LEVEL 2 (Week-Specific): Week/day patterns (no month distinction)
 *   week_schedules: [
 *     { weeks: [1, 3], day_schedules: [...] }       // First & third week
 *   ]
 * 
 * LEVEL 3 (Simple): Day patterns (all weeks, all months)
 *   day_schedules: [
 *     { days: ['monday', 'friday'], time_ranges: [...] }
 *   ]
 * 
 * LEVEL 4 (Simplest): Time ranges (all days, all weeks, all months)
 *   time_ranges: [{ start_time: '09:00', end_time: '17:00' }]
 * 
 * Priority: month_schedules > week_schedules > day_schedules > time_ranges
 */
export const AvailabilityWindowSchema = z.object({
    // LEVEL 1: Month-specific patterns (for yearly recurrence)
    month_schedules: z.array(MonthScheduleSchema).optional(),

    // LEVEL 2: Week-specific patterns (for monthly recurrence)
    week_schedules: z.array(WeekScheduleSchema).optional(),

    // LEVEL 3: Day-specific patterns (for weekly/daily recurrence)
    day_schedules: z.array(DayScheduleSchema).optional(),

    // LEVEL 4: Simple time ranges (same for all days/weeks/months)
    time_ranges: z.array(TimeRangeSchema).optional()
}).refine(
    (w) =>
        (w.month_schedules?.length ?? 0) > 0 ||
        (w.week_schedules?.length ?? 0)  > 0 ||
        (w.day_schedules?.length ?? 0)   > 0 ||
        (w.time_ranges?.length ?? 0)     > 0,
    { message: 'AvailabilityWindow must have at least one schedule or time_ranges entry' },
);

export type AvailabilityWindow = z.infer<typeof AvailabilityWindowSchema>;

// ═══════════════════════════════════════════════════════════════════
// TEMPORAL EXPRESSION — universal temporal language
// ═══════════════════════════════════════════════════════════════════

/**
 * Specific Date Window — one-time or ad-hoc multi-date temporal expression.
 *
 * The point-in-time counterpart to AvailabilityWindow's recurring patterns.
 * Use when a flow applies to exact calendar dates rather than a repeating pattern.
 *
 * Examples:
 *   single date:   { specific_dates: ['2026-03-15'] }
 *   multi-date:    { specific_dates: ['2026-04-01', '2026-04-08'] }
 *   with time:     { specific_dates: ['2026-03-15'], time_ranges: [{ start_time: '09:00', end_time: '12:00' }] }
 */
export const SpecificDateWindowSchema = z.object({
    specific_dates: z.array(z.string()),        // YYYY-MM-DD
    time_ranges: z.array(TimeRangeSchema).optional(),
});

export type SpecificDateWindow = z.infer<typeof SpecificDateWindowSchema>;

/**
 * Temporal Expression — the universal temporal language for the VF matching layer.
 *
 * Either a set of specific calendar dates (point-in-time / ad-hoc)
 * or a recurring availability pattern.
 *
 * Used everywhere time needs to be expressed:
 *   - Intent.availability_window  → standing offer or bounded window
 *   - Commitment.availability_window → recurring or scheduled commitment
 *   - HexIndex temporal binning → routes to the right TemporalIndex slot
 *
 * Priority in z.union: SpecificDateWindow is tried first (requires specific_dates),
 * so AvailabilityWindow objects (which lack specific_dates) always fall through correctly.
 */
export const TemporalExpressionSchema = z.union([
    SpecificDateWindowSchema,
    AvailabilityWindowSchema,
]);

export type TemporalExpression = z.infer<typeof TemporalExpressionSchema>;

/**
 * Type guard: is this TemporalExpression a SpecificDateWindow?
 * Discriminated by the required `specific_dates` field.
 */
export function isSpecificDateWindow(t: TemporalExpression): t is SpecificDateWindow {
    return 'specific_dates' in t;
}

// ═══════════════════════════════════════════════════════════════════
// TEMPORAL MATCHING — check whether a Date falls inside a window
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns true if the HH:MM string `time` falls within any of `ranges`.
 * End-exclusive: start_time <= time < end_time.
 */
export function isTimeInRanges(time: string, ranges: TimeRange[]): boolean {
    return ranges.some(r => time >= r.start_time && time < r.end_time);
}

/**
 * Extract day-of-week, week-of-month, and month from a Date object using UTC.
 * Mirrors the logic of `calendarComponents` in space-time-keys.ts (inlined to
 * avoid a circular import: space-time-keys imports from time.ts).
 */
function utcDateComponents(dt: Date): { day: DayOfWeek; week: number; month: number } {
    const DAY_NAMES: DayOfWeek[] = [
        'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ];
    return {
        day:   DAY_NAMES[dt.getUTCDay()],
        week:  Math.ceil(dt.getUTCDate() / 7),
        month: dt.getUTCMonth() + 1,
    };
}

/**
 * Returns true if `dt` falls within the given TemporalExpression.
 *
 * SpecificDateWindow: the UTC date must be in specific_dates, and if
 * time_ranges are present the UTC HH:MM must fall inside one of them.
 *
 * AvailabilityWindow: walks the priority hierarchy
 *   month_schedules > week_schedules > day_schedules > time_ranges.
 * All comparisons use UTC to match calendarComponents conventions.
 */
export function isWithinTemporalExpression(dt: Date, window: TemporalExpression): boolean {
    const isoDate = dt.toISOString().split('T')[0];          // YYYY-MM-DD (UTC)
    const time    = dt.toISOString().split('T')[1].slice(0, 5); // HH:MM (UTC)

    if (isSpecificDateWindow(window)) {
        if (!window.specific_dates.includes(isoDate)) return false;
        if (window.time_ranges && window.time_ranges.length > 0) {
            return isTimeInRanges(time, window.time_ranges);
        }
        return true;
    }

    // AvailabilityWindow — hierarchical priority
    const { day, week, month } = utcDateComponents(dt);

    if (window.month_schedules && window.month_schedules.length > 0) {
        for (const ms of window.month_schedules) {
            if (ms.month !== month) continue;
            if (ms.week_schedules && ms.week_schedules.length > 0) {
                for (const ws of ms.week_schedules) {
                    if (!ws.weeks.includes(week)) continue;
                    for (const ds of ws.day_schedules) {
                        if (!ds.days.includes(day)) continue;
                        if (isTimeInRanges(time, ds.time_ranges)) return true;
                    }
                }
            } else if (ms.day_schedules && ms.day_schedules.length > 0) {
                for (const ds of ms.day_schedules) {
                    if (!ds.days.includes(day)) continue;
                    if (isTimeInRanges(time, ds.time_ranges)) return true;
                }
            } else if (ms.time_ranges && ms.time_ranges.length > 0) {
                if (isTimeInRanges(time, ms.time_ranges)) return true;
            }
        }
        return false;
    }

    if (window.week_schedules && window.week_schedules.length > 0) {
        for (const ws of window.week_schedules) {
            if (!ws.weeks.includes(week)) continue;
            for (const ds of ws.day_schedules) {
                if (!ds.days.includes(day)) continue;
                if (isTimeInRanges(time, ds.time_ranges)) return true;
            }
        }
        return false;
    }

    if (window.day_schedules && window.day_schedules.length > 0) {
        for (const ds of window.day_schedules) {
            if (!ds.days.includes(day)) continue;
            if (isTimeInRanges(time, ds.time_ranges)) return true;
        }
        return false;
    }

    if (window.time_ranges && window.time_ranges.length > 0) {
        return isTimeInRanges(time, window.time_ranges);
    }

    return false;
}

// =============================================================================
// HOURS CALCULATION — how many hours a window grants on a specific date
// =============================================================================

/**
 * Sum the total hours covered by an array of TimeRanges.
 * Each range is treated as [start_time, end_time); negative spans → 0.
 */
function sumTimeRangeHours(ranges: TimeRange[]): number {
    return ranges.reduce((sum, r) => {
        const [sh, sm = 0] = r.start_time.split(':').map(Number);
        const [eh, em = 0] = r.end_time.split(':').map(Number);
        return sum + Math.max(0, (eh + em / 60) - (sh + sm / 60));
    }, 0);
}

/**
 * Returns the number of hours that `window` grants on the UTC calendar date
 * represented by `dt`.
 *
 * Mirrors the traversal hierarchy of isWithinTemporalExpression exactly
 * (month_schedules → week_schedules → day_schedules → time_ranges) but
 * accumulates hours rather than returning a boolean.
 *
 * Returns 0 when the window does not apply to the given date.
 * Returns 24 when the window applies but specifies no time_ranges (all-day).
 */
export function hoursInWindowOnDate(window: TemporalExpression, dt: Date): number {
    const isoDate = dt.toISOString().split('T')[0]; // YYYY-MM-DD (UTC)

    if (isSpecificDateWindow(window)) {
        if (!window.specific_dates.includes(isoDate)) return 0;
        if (window.time_ranges && window.time_ranges.length > 0) {
            return sumTimeRangeHours(window.time_ranges);
        }
        return 24;
    }

    // AvailabilityWindow — hierarchical priority
    const { day, week, month } = utcDateComponents(dt);

    if (window.month_schedules && window.month_schedules.length > 0) {
        for (const ms of window.month_schedules) {
            if (ms.month !== month) continue;
            if (ms.week_schedules && ms.week_schedules.length > 0) {
                for (const ws of ms.week_schedules) {
                    if (!ws.weeks.includes(week)) continue;
                    for (const ds of ws.day_schedules) {
                        if (!ds.days.includes(day)) continue;
                        return sumTimeRangeHours(ds.time_ranges);
                    }
                }
            } else if (ms.day_schedules && ms.day_schedules.length > 0) {
                for (const ds of ms.day_schedules) {
                    if (!ds.days.includes(day)) continue;
                    return sumTimeRangeHours(ds.time_ranges);
                }
            } else if (ms.time_ranges && ms.time_ranges.length > 0) {
                return sumTimeRangeHours(ms.time_ranges);
            }
        }
        return 0;
    }

    if (window.week_schedules && window.week_schedules.length > 0) {
        for (const ws of window.week_schedules) {
            if (!ws.weeks.includes(week)) continue;
            for (const ds of ws.day_schedules) {
                if (!ds.days.includes(day)) continue;
                return sumTimeRangeHours(ds.time_ranges);
            }
        }
        return 0;
    }

    if (window.day_schedules && window.day_schedules.length > 0) {
        for (const ds of window.day_schedules) {
            if (!ds.days.includes(day)) continue;
            return sumTimeRangeHours(ds.time_ranges);
        }
        return 0;
    }

    if (window.time_ranges && window.time_ranges.length > 0) {
        return sumTimeRangeHours(window.time_ranges);
    }

    return 0;
}
