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
