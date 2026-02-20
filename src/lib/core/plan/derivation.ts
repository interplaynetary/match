/**
 * Derivation: Computing present state from the stream of effects.
 *
 * The state of any entity attribute is not stored — it's derived from
 * the totality of accepted effects targeting it. This module provides
 * the reduction, constraint checking, and metabolic analysis.
 *
 * Metabolism is a field over space-time, not a scalar. The flow of
 * production and consumption varies by location and time of day/week/month.
 * Querying metabolism requires specifying WHERE and WHEN you're asking about.
 *
 * "The philosophers have only interpreted the world, in various ways.
 * The point, however, is to change it." — Marx, Theses on Feuerbach
 */

import {
    type Effect,
    type Delta,
    type DeltaOperation,
    type AssertionPhase,
    type TemporalEnvelope,
    type SpatialEnvelope,
    type StatePredicate,
    currentPhase,
} from './effect';
import { type EffectStream } from './effect-stream';
import type { AvailabilityWindow, DayOfWeek } from './time';
import {
    calculateAvailabilityIntersection,
    flattenWindowToUTCDaySchedules,
    parseTimeToMinutes,
} from './matching';
import {
    cellsCompatible,
    haversineDistance,
    REMOTE_H3_INDEX,
} from './spatial';

// =============================================================================
// DERIVED VALUE — Result of folding effects on an attribute
// =============================================================================

export interface DerivedValue {
    entity_id: string;
    attribute: string;
    value: unknown;
    /** Effects that contributed to this value (origin_ids). */
    contributors: string[];
    /** How many accepted effects were folded. */
    effect_count: number;
    /** Most recent valid_from among contributors. */
    latest_valid_from?: string;
}

// =============================================================================
// METABOLIC QUERY — A space-time region to ask about
// =============================================================================

export interface MetabolicQuery {
    temporal?: {
        /** Bounded interval start (ISO datetime). */
        start?: string;
        /** Bounded interval end (ISO datetime). */
        end?: string;
        /** Recurring pattern to query over. */
        availability_window?: AvailabilityWindow;
        timezone?: string;
    };
    spatial?: {
        latitude?: number;
        longitude?: number;
        radius_km?: number;
        h3_index?: string;
        location_type?: 'physical' | 'remote' | 'hybrid';
    };
}

// =============================================================================
// METABOLISM — Flow rates for an attribute
// =============================================================================

export interface MetabolicFlow {
    entity_id: string;
    attribute: string;

    /** Sum of all 'add' deltas (weighted by temporal fraction). */
    production: number;
    /** Sum of all 'subtract' deltas (weighted by temporal fraction). */
    consumption: number;
    /** production - consumption */
    net: number;

    /** Effects producing (adding). */
    producers: string[];
    /** Effects consuming (subtracting). */
    consumers: string[];

    /** Rate per hour during the queried window. */
    production_rate_per_hour?: number;
    consumption_rate_per_hour?: number;
    net_rate_per_hour?: number;

    /** Is this attribute sustainable at current rates? */
    sustainable: boolean;
    /** If depleting, estimated hours until exhaustion (given a known base). */
    hours_until_exhaustion?: number;
}

export interface MetabolicContribution {
    effect_origin_id: string;
    fraction: number;
    raw_delta: number;
    weighted_delta: number;
    operation: DeltaOperation;
}

export interface WindowedMetabolicFlow extends MetabolicFlow {
    query: MetabolicQuery;
    contributions: MetabolicContribution[];
}

// =============================================================================
// METABOLIC PROFILE — Metabolism sampled across time periods
// =============================================================================

export type ProfileGranularity = 'day-of-week' | 'time-of-day' | 'month' | 'week-of-month';

export interface MetabolicProfile {
    entity_id: string;
    attribute: string;
    spatial_query?: MetabolicQuery['spatial'];
    periods: Array<{ label: string; flow: WindowedMetabolicFlow }>;
}

// =============================================================================
// METABOLIC FIELD — Spatial distribution of metabolism
// =============================================================================

export interface MetabolicFieldEntry {
    h3_index: string;
    flow: WindowedMetabolicFlow;
}

export interface MetabolicField {
    attribute: string;
    temporal_query?: MetabolicQuery['temporal'];
    cells: MetabolicFieldEntry[];
}

// =============================================================================
// CONSTRAINT — What an attribute must satisfy
// =============================================================================

export interface AttributeConstraint {
    entity_id: string;
    attribute: string;
    max?: number;
    min?: number;
    exact?: unknown;
    check?: (value: unknown) => boolean;
}

export type ConstraintResult =
    | { satisfied: true }
    | { satisfied: false; violation: string };

// =============================================================================
// SLOT SATISFACTION
// =============================================================================

export interface SlotSatisfaction {
    slot_id: string;
    effects: Effect[];
    derived: DerivedValue[];
    constraints: { constraint: AttributeConstraint; result: ConstraintResult }[];
    satisfied: boolean;
    partial: boolean;
    metabolism: MetabolicFlow[];
}

// =============================================================================
// COMMONS DERIVATION
// =============================================================================

export interface ProcessDerivedState {
    process_id: string;
    slot_results: SlotSatisfaction[];
    actual: boolean;
    satisfaction_ratio: number;
    metabolism: MetabolicFlow[];
    sustainable: boolean;
}

// =============================================================================
// DERIVE — Fold accepted effects into current state
// =============================================================================

export function collectEffects(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    phases: AssertionPhase[] = ['accepted'],
): Effect[] {
    return stream.forEntity(entityId).filter(e => {
        const phase = currentPhase(e);
        if (!phases.includes(phase)) return false;
        return e.deltas.some(d => d.entity_id === entityId && d.attribute === attribute);
    });
}

export function extractDeltas(
    effects: Effect[],
    entityId: string,
    attribute: string,
): { delta: Delta; effect: Effect }[] {
    const result: { delta: Delta; effect: Effect }[] = [];
    for (const effect of effects) {
        for (const delta of effect.deltas) {
            if (delta.entity_id === entityId && delta.attribute === attribute) {
                result.push({ delta, effect });
            }
        }
    }
    result.sort((a, b) => {
        const aTime = a.effect.valid_from ?? a.effect.recorded_at.toISOString();
        const bTime = b.effect.valid_from ?? b.effect.recorded_at.toISOString();
        return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
    });
    return result;
}

export function applyDelta(current: unknown, operation: DeltaOperation, operand: unknown): unknown {
    switch (operation) {
        case 'set':
            return operand;
        case 'add':
            return (typeof current === 'number' ? current : 0) + (operand as number);
        case 'subtract':
            return (typeof current === 'number' ? current : 0) - (operand as number);
        case 'multiply':
            return (typeof current === 'number' ? current : 0) * (operand as number);
        case 'append': {
            const arr = Array.isArray(current) ? [...current] : [];
            arr.push(operand);
            return arr;
        }
        case 'remove': {
            const arr = Array.isArray(current) ? [...current] : [];
            const idx = arr.indexOf(operand);
            if (idx !== -1) arr.splice(idx, 1);
            return arr;
        }
    }
}

export function derive(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    initial: unknown = undefined,
    phases: AssertionPhase[] = ['accepted'],
): DerivedValue {
    const effects = collectEffects(stream, entityId, attribute, phases);
    const deltas = extractDeltas(effects, entityId, attribute);

    let value = initial;
    for (const { delta } of deltas) {
        value = applyDelta(value, delta.operation, delta.value);
    }

    return {
        entity_id: entityId,
        attribute,
        value,
        contributors: effects.map(e => e.origin_id),
        effect_count: effects.length,
        latest_valid_from: deltas.length > 0
            ? (deltas[deltas.length - 1]!.effect.valid_from ?? undefined)
            : undefined,
    };
}

export function deriveAt(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    knownTime: Date,
    initial: unknown = undefined,
): DerivedValue {
    const effects = stream.forEntity(entityId).filter(e => {
        const acceptedEntry = e.assertion_log.find(
            entry => entry.phase === 'accepted' && entry.at <= knownTime
        );
        if (!acceptedEntry) return false;
        const retractedEntry = e.assertion_log.find(
            entry => entry.phase === 'retracted' && entry.at <= knownTime
        );
        if (retractedEntry) return false;
        return e.deltas.some(d => d.entity_id === entityId && d.attribute === attribute);
    });

    const deltas = extractDeltas(effects, entityId, attribute);

    let value = initial;
    for (const { delta } of deltas) {
        value = applyDelta(value, delta.operation, delta.value);
    }

    return {
        entity_id: entityId,
        attribute,
        value,
        contributors: effects.map(e => e.origin_id),
        effect_count: effects.length,
    };
}

// =============================================================================
// SPACE-TIME OVERLAP — Core computation for spatiotemporally honest metabolism
// =============================================================================

/**
 * Compute total minutes per week from an availability window.
 * For bounded (non-recurring) envelopes, returns total span in minutes.
 */
export function computeTemporalMinutes(
    temporal: TemporalEnvelope | undefined,
    timezone?: string,
): { minutes: number; recurring: boolean } {
    if (!temporal) return { minutes: Infinity, recurring: false };

    // Recurring: flatten to UTC day schedules, sum durations
    if (temporal.availability_window) {
        const schedules = flattenWindowToUTCDaySchedules(
            temporal.availability_window,
            timezone,
        );
        let total = 0;
        for (const sched of schedules) {
            for (const range of sched.timeRanges) {
                const start = parseTimeToMinutes(range.start_time);
                const end = parseTimeToMinutes(range.end_time);
                const dur = end > start ? end - start : (24 * 60 + end - start);
                total += dur;
            }
        }
        return { minutes: total, recurring: true };
    }

    // Bounded: total span
    if (temporal.start && temporal.end) {
        const ms = new Date(temporal.end).getTime() - new Date(temporal.start).getTime();
        return { minutes: Math.max(0, ms / (1000 * 60)), recurring: false };
    }

    // Only start or only end: treat as unbounded
    return { minutes: Infinity, recurring: false };
}

/**
 * Compute how many minutes of an effect's temporal envelope overlap
 * with a query's temporal region.
 *
 * Handles four cases:
 *   recurring × recurring — calculateAvailabilityIntersection
 *   bounded × bounded — interval intersection
 *   recurring × bounded — check which days in the interval match the pattern
 *   bounded × recurring — mirror
 */
export function computeOverlapMinutes(
    effectTemporal: TemporalEnvelope | undefined,
    queryTemporal: MetabolicQuery['temporal'] | undefined,
    effectTz?: string,
    queryTz?: string,
): { minutes: number; recurring: boolean } {
    // Unbounded on either side: full overlap
    if (!effectTemporal || !queryTemporal) {
        // Return the bounded side's minutes, or Infinity if both unbounded
        if (effectTemporal) return computeTemporalMinutes(effectTemporal, effectTz);
        if (queryTemporal) {
            return computeTemporalMinutes(
                { start: queryTemporal.start, end: queryTemporal.end, availability_window: queryTemporal.availability_window },
                queryTemporal.timezone,
            );
        }
        return { minutes: Infinity, recurring: false };
    }

    const effectHasWindow = !!effectTemporal.availability_window;
    const queryHasWindow = !!queryTemporal.availability_window;
    const effectHasBounds = !!(effectTemporal.start && effectTemporal.end);
    const queryHasBounds = !!(queryTemporal.start && queryTemporal.end);

    // Case 1: Both have availability windows (recurring × recurring)
    if (effectHasWindow && queryHasWindow) {
        const intersection = calculateAvailabilityIntersection(
            effectTemporal.availability_window!,
            queryTemporal.availability_window!,
            effectTz,
            queryTz,
        );
        return { minutes: sumWindowMinutes(intersection), recurring: true };
    }

    // Case 2: Both bounded (interval × interval)
    if (effectHasBounds && queryHasBounds && !effectHasWindow && !queryHasWindow) {
        const overlapStart = Math.max(
            new Date(effectTemporal.start!).getTime(),
            new Date(queryTemporal.start!).getTime(),
        );
        const overlapEnd = Math.min(
            new Date(effectTemporal.end!).getTime(),
            new Date(queryTemporal.end!).getTime(),
        );
        const ms = Math.max(0, overlapEnd - overlapStart);
        return { minutes: ms / (1000 * 60), recurring: false };
    }

    // Case 3: Effect has window, query is bounded
    // Check which days in the bounded query interval match the recurring pattern
    if (effectHasWindow && queryHasBounds) {
        return computeRecurringBoundedOverlap(
            effectTemporal.availability_window!,
            effectTz,
            queryTemporal.start!,
            queryTemporal.end!,
        );
    }

    // Case 4: Query has window, effect is bounded
    if (queryHasWindow && effectHasBounds) {
        return computeRecurringBoundedOverlap(
            queryTemporal.availability_window!,
            queryTz,
            effectTemporal.start!,
            effectTemporal.end!,
        );
    }

    // Case 5: Effect has both window AND bounds (clip recurring to bounded period)
    // then intersect with query
    if (effectHasWindow && effectHasBounds) {
        // Treat the effect as recurring but only within its bounds
        // For now: compute recurring overlap, then clip by bounded overlap
        const recurringOverlap = effectHasWindow && queryHasWindow
            ? computeOverlapMinutes(
                { availability_window: effectTemporal.availability_window },
                { availability_window: queryTemporal.availability_window, timezone: queryTz },
                effectTz, queryTz,
            )
            : computeOverlapMinutes(
                { availability_window: effectTemporal.availability_window },
                queryTemporal,
                effectTz, queryTz,
            );

        // Clip by date bounds if query also has bounds
        if (queryHasBounds) {
            const boundsOverlap = computeOverlapMinutes(
                { start: effectTemporal.start, end: effectTemporal.end },
                { start: queryTemporal.start, end: queryTemporal.end },
            );
            if (boundsOverlap.minutes === 0) return { minutes: 0, recurring: false };
        }

        return recurringOverlap;
    }

    // Fallback: optimistic full overlap
    return computeTemporalMinutes(effectTemporal, effectTz);
}

/**
 * Compute overlap between a recurring availability window and a bounded interval.
 * Iterates day by day through the interval, checking which days/times match.
 */
function computeRecurringBoundedOverlap(
    window: AvailabilityWindow,
    windowTz: string | undefined,
    boundStart: string,
    boundEnd: string,
): { minutes: number; recurring: boolean } {
    const startDate = new Date(boundStart);
    const endDate = new Date(boundEnd);
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Flatten the recurring window to UTC day schedules
    // Use start date as sample for month/week resolution
    const sampleDate = boundStart.split('T')[0] ?? boundStart;
    const schedules = flattenWindowToUTCDaySchedules(window, windowTz, sampleDate);

    if (schedules.length === 0) return { minutes: 0, recurring: false };

    // Build a lookup: day → total minutes
    const dayMinutes = new Map<DayOfWeek, number>();
    for (const sched of schedules) {
        let mins = 0;
        for (const range of sched.timeRanges) {
            const s = parseTimeToMinutes(range.start_time);
            const e = parseTimeToMinutes(range.end_time);
            mins += e > s ? e - s : (24 * 60 + e - s);
        }
        dayMinutes.set(sched.day, (dayMinutes.get(sched.day) ?? 0) + mins);
    }

    // Walk day by day through the bounded interval
    let totalMinutes = 0;
    const current = new Date(startDate);
    // Cap at 366 days to prevent unbounded iteration
    const maxDays = Math.min(
        Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        366,
    );

    for (let i = 0; i < maxDays && current <= endDate; i++) {
        const dayName = dayNames[current.getUTCDay()];
        const mins = dayMinutes.get(dayName);
        if (mins) totalMinutes += mins;
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return { minutes: totalMinutes, recurring: false };
}

/**
 * Sum total minutes from an AvailabilityWindow's day_schedules.
 */
function sumWindowMinutes(window: AvailabilityWindow): number {
    let total = 0;
    if (window.day_schedules) {
        for (const ds of window.day_schedules) {
            for (const range of ds.time_ranges) {
                const s = parseTimeToMinutes(range.start_time);
                const e = parseTimeToMinutes(range.end_time);
                const dur = e > s ? e - s : (24 * 60 + e - s);
                total += dur * ds.days.length;
            }
        }
    }
    if (window.time_ranges) {
        for (const range of window.time_ranges) {
            const s = parseTimeToMinutes(range.start_time);
            const e = parseTimeToMinutes(range.end_time);
            total += e > s ? e - s : (24 * 60 + e - s);
        }
    }
    return total;
}

/**
 * Compute what fraction of an effect's temporal extent overlaps with the query.
 * Returns 0..1. Returns 1 if either side is unbounded.
 */
export function computeTemporalFraction(
    effectTemporal: TemporalEnvelope | undefined,
    queryTemporal: MetabolicQuery['temporal'] | undefined,
    effectTz?: string,
    queryTz?: string,
): number {
    if (!effectTemporal || !queryTemporal) return 1;

    const effectTotal = computeTemporalMinutes(effectTemporal, effectTz);
    if (effectTotal.minutes === 0) return 0;
    if (effectTotal.minutes === Infinity) return 1;

    const overlap = computeOverlapMinutes(effectTemporal, queryTemporal, effectTz, queryTz);
    if (overlap.minutes === 0) return 0;
    if (overlap.minutes === Infinity) return 1;

    return Math.min(1, overlap.minutes / effectTotal.minutes);
}

// =============================================================================
// SPATIAL OVERLAP
// =============================================================================

/**
 * Does an effect's spatial envelope overlap with a query's spatial region?
 * Optimistic: undefined on either side means unbounded (matches all).
 */
export function spatialOverlaps(
    effectSpatial: SpatialEnvelope | undefined,
    querySpatial: MetabolicQuery['spatial'] | undefined,
): boolean {
    if (!effectSpatial || !querySpatial) return true;

    // Remote overlaps everything
    if (effectSpatial.location_type === 'remote' || querySpatial.location_type === 'remote') return true;
    if (effectSpatial.h3_index === REMOTE_H3_INDEX || querySpatial.h3_index === REMOTE_H3_INDEX) return true;

    // H3 cell comparison
    if (effectSpatial.h3_index && querySpatial.h3_index) {
        const radius = Math.max(
            effectSpatial.radius_km ?? 0,
            querySpatial.radius_km ?? 50,
        );
        return cellsCompatible(effectSpatial.h3_index, querySpatial.h3_index, radius);
    }

    // Coordinate distance
    if (
        effectSpatial.latitude !== undefined && effectSpatial.longitude !== undefined &&
        querySpatial.latitude !== undefined && querySpatial.longitude !== undefined
    ) {
        const dist = haversineDistance(
            effectSpatial.latitude, effectSpatial.longitude,
            querySpatial.latitude, querySpatial.longitude,
        );
        const radius = Math.max(
            effectSpatial.radius_km ?? 0,
            querySpatial.radius_km ?? 50,
        );
        return dist <= radius;
    }

    // Fallback: optimistic
    return true;
}

// =============================================================================
// WINDOWED METABOLISM — Spatiotemporally honest flow computation
// =============================================================================

/**
 * Compute metabolic flow for an entity attribute within a space-time query region.
 *
 * For each accepted effect:
 * 1. Check spatial overlap — skip if no overlap
 * 2. Compute temporal fraction — what portion of the effect's time falls in the query
 * 3. Weight the delta by the fraction
 * 4. Accumulate weighted production/consumption
 * 5. Compute rates normalized to the query window's duration
 */
export function metabolizeWindowed(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    query: MetabolicQuery = {},
    base?: number,
): WindowedMetabolicFlow {
    const effects = collectEffects(stream, entityId, attribute, ['accepted']);
    const deltas = extractDeltas(effects, entityId, attribute);

    let production = 0;
    let consumption = 0;
    const producers: string[] = [];
    const consumers: string[] = [];
    const contributions: MetabolicContribution[] = [];

    for (const { delta, effect } of deltas) {
        // Spatial filter
        if (!spatialOverlaps(effect.envelope.spatial, query.spatial)) continue;

        // Temporal fraction
        const fraction = computeTemporalFraction(
            effect.envelope.temporal,
            query.temporal,
            effect.envelope.temporal?.availability_window ? undefined : undefined,
            query.temporal?.timezone,
        );
        if (fraction === 0) continue;

        const rawVal = typeof delta.value === 'number' ? delta.value : 0;
        const weightedVal = rawVal * fraction;

        if (delta.operation === 'add' && rawVal > 0) {
            production += weightedVal;
            producers.push(effect.origin_id);
        } else if (delta.operation === 'subtract' && rawVal > 0) {
            consumption += weightedVal;
            consumers.push(effect.origin_id);
        } else if (delta.operation === 'add' && rawVal < 0) {
            consumption += Math.abs(weightedVal);
            consumers.push(effect.origin_id);
        } else if (delta.operation === 'subtract' && rawVal < 0) {
            production += Math.abs(weightedVal);
            producers.push(effect.origin_id);
        } else if (delta.operation === 'set') {
            production += weightedVal;
            producers.push(effect.origin_id);
        }

        contributions.push({
            effect_origin_id: effect.origin_id,
            fraction,
            raw_delta: rawVal,
            weighted_delta: weightedVal,
            operation: delta.operation,
        });
    }

    const net = production - consumption;

    // Compute rates based on the query window's duration
    let productionRate: number | undefined;
    let consumptionRate: number | undefined;
    let netRate: number | undefined;

    const queryTemporal = query.temporal
        ? { start: query.temporal.start, end: query.temporal.end, availability_window: query.temporal.availability_window }
        : undefined;
    const queryMinutes = computeTemporalMinutes(queryTemporal, query.temporal?.timezone);

    if (queryMinutes.minutes > 0 && queryMinutes.minutes < Infinity) {
        const queryHours = queryMinutes.minutes / 60;
        productionRate = production / queryHours;
        consumptionRate = consumption / queryHours;
        netRate = net / queryHours;
    }

    // Sustainability
    const sustainable = net >= 0;
    let hoursUntilExhaustion: number | undefined;

    if (!sustainable && netRate !== undefined && netRate < 0 && base !== undefined) {
        const currentValue = base + net;
        if (currentValue > 0) {
            hoursUntilExhaustion = currentValue / Math.abs(netRate);
        } else {
            hoursUntilExhaustion = 0;
        }
    }

    return {
        entity_id: entityId,
        attribute,
        production,
        consumption,
        net,
        producers,
        consumers,
        production_rate_per_hour: productionRate,
        consumption_rate_per_hour: consumptionRate,
        net_rate_per_hour: netRate,
        sustainable,
        hours_until_exhaustion: hoursUntilExhaustion,
        query,
        contributions,
    };
}

/**
 * Flat aggregate metabolism — delegates to windowed with unbounded query.
 * Backward compatible with the original API.
 */
export function metabolize(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    base?: number,
): MetabolicFlow {
    const { query, contributions, ...flow } = metabolizeWindowed(stream, entityId, attribute, {}, base);
    return flow;
}

// =============================================================================
// METABOLIC PROFILE — Sample metabolism across time periods
// =============================================================================

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Sample metabolism across time periods for a given spatial region.
 * Reveals the rhythm: which days are rich, which are barren.
 */
export function metabolicProfile(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    spatialQuery?: MetabolicQuery['spatial'],
    granularity: ProfileGranularity = 'day-of-week',
    base?: number,
): MetabolicProfile {
    const periods: MetabolicProfile['periods'] = [];

    switch (granularity) {
        case 'day-of-week': {
            for (const day of ALL_DAYS) {
                const query: MetabolicQuery = {
                    spatial: spatialQuery,
                    temporal: {
                        availability_window: {
                            day_schedules: [{ days: [day], time_ranges: [{ start_time: '00:00', end_time: '23:59' }] }],
                        },
                    },
                };
                periods.push({ label: day, flow: metabolizeWindowed(stream, entityId, attribute, query, base) });
            }
            break;
        }

        case 'time-of-day': {
            const slots = [
                { label: 'morning', start: '06:00', end: '12:00' },
                { label: 'afternoon', start: '12:00', end: '17:00' },
                { label: 'evening', start: '17:00', end: '22:00' },
                { label: 'night', start: '22:00', end: '06:00' },
            ];
            for (const slot of slots) {
                const query: MetabolicQuery = {
                    spatial: spatialQuery,
                    temporal: {
                        availability_window: {
                            day_schedules: [{ days: ALL_DAYS, time_ranges: [{ start_time: slot.start, end_time: slot.end }] }],
                        },
                    },
                };
                periods.push({ label: slot.label, flow: metabolizeWindowed(stream, entityId, attribute, query, base) });
            }
            break;
        }

        case 'month': {
            for (let m = 1; m <= 12; m++) {
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];
                const query: MetabolicQuery = {
                    spatial: spatialQuery,
                    temporal: {
                        availability_window: {
                            month_schedules: [{
                                month: m,
                                time_ranges: [{ start_time: '00:00', end_time: '23:59' }],
                            }],
                        },
                    },
                };
                periods.push({ label: monthNames[m - 1]!, flow: metabolizeWindowed(stream, entityId, attribute, query, base) });
            }
            break;
        }

        case 'week-of-month': {
            for (let w = 1; w <= 5; w++) {
                const query: MetabolicQuery = {
                    spatial: spatialQuery,
                    temporal: {
                        availability_window: {
                            week_schedules: [{
                                weeks: [w],
                                day_schedules: [{ days: ALL_DAYS, time_ranges: [{ start_time: '00:00', end_time: '23:59' }] }],
                            }],
                        },
                    },
                };
                periods.push({ label: `week-${w}`, flow: metabolizeWindowed(stream, entityId, attribute, query, base) });
            }
            break;
        }
    }

    return {
        entity_id: entityId,
        attribute,
        spatial_query: spatialQuery,
        periods,
    };
}

// =============================================================================
// METABOLIC FIELD — Spatial distribution of metabolism
// =============================================================================

/**
 * For a given attribute and time window, compute metabolism at each
 * spatial cell. Reveals which locations are accumulating vs depleting.
 */
export function metabolicField(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    temporalQuery?: MetabolicQuery['temporal'],
    cells: string[] = [],
    base?: number,
): MetabolicField {
    const entries: MetabolicFieldEntry[] = [];

    for (const cell of cells) {
        const query: MetabolicQuery = {
            temporal: temporalQuery,
            spatial: { h3_index: cell },
        };
        const flow = metabolizeWindowed(stream, entityId, attribute, query, base);
        entries.push({ h3_index: cell, flow });
    }

    return {
        attribute,
        temporal_query: temporalQuery,
        cells: entries,
    };
}

// =============================================================================
// CONSTRAINTS
// =============================================================================

/**
 * Convert a StatePredicate (serializable, on effects) to an AttributeConstraint
 * (runtime, in derivation). Bridges the two representations.
 */
export function predicateToConstraint(pred: StatePredicate): AttributeConstraint {
    return {
        entity_id: pred.entity_id,
        attribute: pred.attribute,
        max: pred.max,
        min: pred.min,
        exact: pred.exact,
    };
}

export function checkConstraint(
    derived: DerivedValue,
    constraint: AttributeConstraint,
): ConstraintResult {
    const v = derived.value;

    if (constraint.exact !== undefined) {
        if (v !== constraint.exact) {
            return { satisfied: false, violation: `Expected exactly ${constraint.exact}, got ${v}` };
        }
    }

    if (constraint.max !== undefined) {
        if (typeof v !== 'number' || v > constraint.max) {
            return { satisfied: false, violation: `Value ${v} exceeds max ${constraint.max}` };
        }
    }

    if (constraint.min !== undefined) {
        if (typeof v !== 'number' || v < constraint.min) {
            return { satisfied: false, violation: `Value ${v} below min ${constraint.min}` };
        }
    }

    if (constraint.check && !constraint.check(v)) {
        return { satisfied: false, violation: `Custom constraint failed for value ${v}` };
    }

    return { satisfied: true };
}

export function checkCapacity(
    stream: EffectStream,
    entityId: string,
    attribute: string,
    capacity: number,
): ConstraintResult {
    const flow = metabolize(stream, entityId, attribute, capacity);
    if (flow.consumption > capacity) {
        return {
            satisfied: false,
            violation: `Total consumption ${flow.consumption} exceeds capacity ${capacity} (net: ${flow.net})`,
        };
    }
    return { satisfied: true };
}

// =============================================================================
// SLOT SATISFACTION
// =============================================================================

export function evaluateSlot(
    stream: EffectStream,
    slotId: string,
    requirements: AttributeConstraint[],
    phases: AssertionPhase[] = ['accepted'],
): SlotSatisfaction {
    const effects = stream.forEntity(slotId).filter(e =>
        phases.includes(currentPhase(e))
    );

    const derived: DerivedValue[] = [];
    const constraints: SlotSatisfaction['constraints'] = [];
    const metabolism: MetabolicFlow[] = [];

    for (const req of requirements) {
        const d = derive(stream, req.entity_id, req.attribute, undefined, phases);
        derived.push(d);

        const result = checkConstraint(d, req);
        constraints.push({ constraint: req, result });

        if (typeof d.value === 'number' || d.effect_count > 0) {
            const flow = metabolize(stream, req.entity_id, req.attribute, req.max);
            metabolism.push(flow);
        }
    }

    const satisfiedCount = constraints.filter(c => c.result.satisfied).length;

    return {
        slot_id: slotId,
        effects,
        derived,
        constraints,
        satisfied: satisfiedCount === constraints.length,
        partial: satisfiedCount > 0 && satisfiedCount < constraints.length,
        metabolism,
    };
}

// =============================================================================
// COMMONS DERIVATION
// =============================================================================

export function deriveProcess(
    stream: EffectStream,
    processId: string,
    slots: {
        id: string;
        required: boolean;
        constraints: AttributeConstraint[];
    }[],
): ProcessDerivedState {
    const slotResults: SlotSatisfaction[] = [];
    const allMetabolism: MetabolicFlow[] = [];

    let requiredCount = 0;
    let requiredSatisfied = 0;

    for (const slot of slots) {
        const satisfaction = evaluateSlot(stream, slot.id, slot.constraints);
        slotResults.push(satisfaction);
        allMetabolism.push(...satisfaction.metabolism);

        if (slot.required) {
            requiredCount++;
            if (satisfaction.satisfied) requiredSatisfied++;
        }
    }

    return {
        process_id: processId,
        slot_results: slotResults,
        actual: requiredCount > 0 ? requiredSatisfied === requiredCount : true,
        satisfaction_ratio: requiredCount > 0 ? requiredSatisfied / requiredCount : 1,
        metabolism: allMetabolism,
        sustainable: allMetabolism.every(m => m.sustainable),
    };
}

// =============================================================================
// SNAPSHOT
// =============================================================================

export interface EntitySnapshot {
    entity_id: string;
    attributes: Record<string, unknown>;
    metabolism: Record<string, MetabolicFlow>;
    as_of: Date;
}

export function snapshot(
    stream: EffectStream,
    entityId: string,
    attributes: string[],
    bases?: Record<string, number>,
): EntitySnapshot {
    const attrValues: Record<string, unknown> = {};
    const attrMetabolism: Record<string, MetabolicFlow> = {};

    for (const attr of attributes) {
        const d = derive(stream, entityId, attr);
        attrValues[attr] = d.value;
        attrMetabolism[attr] = metabolize(stream, entityId, attr, bases?.[attr]);
    }

    return {
        entity_id: entityId,
        attributes: attrValues,
        metabolism: attrMetabolism,
        as_of: new Date(),
    };
}
