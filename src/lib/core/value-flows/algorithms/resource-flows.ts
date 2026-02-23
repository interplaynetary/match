/**
 * Resource Flows — Timeline of resource inflows and outflows.
 *
 * From algorithms/cashflows.md:
 *   "Cash inflows and outflows are plotted on a timeline, sometimes weekly,
 *    sometimes quarterly, totalled as a positive or negative number for each
 *    period, and then summarized into a running cumulative cash flow."
 *
 * Supports any resource, not just money — e.g., water, energy, hours.
 *
 * Two data sources:
 *   - ACTUAL (past):     EconomicEvents already recorded in the Observer
 *   - FORECASTED (future): Commitments and Intents from the PlanStore
 *
 * A flow is an inflow if:
 *   - The specified agent is the receiver (resource/rights coming in)
 * An outflow if:
 *   - The specified agent is the provider (resource/rights going out)
 *
 * Period granularity:
 *   - 'day', 'week', 'month', 'quarter', 'year'
 */

import type { EconomicEvent, Commitment, Intent } from '../schemas';
import type { Observer } from '../observation/observer';
import type { PlanStore } from '../planning/planning';

// =============================================================================
// TYPES
// =============================================================================

export type PeriodGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface CashFlowEntry {
    /** ISO period key, e.g. "2024-03" for a month, "2024-W12" for a week */
    period: string;
    periodStart: Date;
    periodEnd: Date;
    /** Actual inflows from events in this period */
    actualInflows: number;
    /** Actual outflows from events in this period */
    actualOutflows: number;
    /** Net actual (inflows - outflows) */
    netActual: number;
    /** Forecasted inflows from commitments/intents in this period */
    forecastedInflows: number;
    /** Forecasted outflows from commitments/intents in this period */
    forecastedOutflows: number;
    /** Net forecasted */
    netForecasted: number;
    /** Combined net (actual + forecasted) */
    netCombined: number;
    /** Running cumulative from the start of the report */
    cumulativeNet: number;
    /** Events that contributed to actual flows */
    actualEventIds: string[];
    /** Commitment/Intent IDs that contributed to forecasted flows */
    forecastedFlowIds: string[];
}

export interface CashFlowReport {
    agentId: string;
    resourceSpecId?: string;  // if filtering to a specific resource type
    periodGranularity: PeriodGranularity;
    reportStart: Date;
    reportEnd: Date;
    entries: CashFlowEntry[];
    /** Total actual inflows over the report period */
    totalActualInflows: number;
    /** Total actual outflows over the report period */
    totalActualOutflows: number;
    /** Total forecasted inflows */
    totalForecastedInflows: number;
    /** Total forecasted outflows */
    totalForecastedOutflows: number;
}

// =============================================================================
// CASH FLOW REPORT
// =============================================================================

/**
 * Generate a cash flow report for an agent over a date range.
 *
 * @param agentId - The agent whose flows to analyze
 * @param reportStart - Start of the report period
 * @param reportEnd - End of the report period
 * @param observer - Provides actual events
 * @param planStore - Provides forecasted commitments and intents
 * @param granularity - Period grouping (default: 'month')
 * @param resourceSpecId - Optional: filter to a specific resource spec
 */
export function cashFlowReport(params: {
    agentId: string;
    reportStart: Date;
    reportEnd: Date;
    observer: Observer;
    planStore: PlanStore;
    granularity?: PeriodGranularity;
    resourceSpecId?: string;
}): CashFlowReport {
    const {
        agentId,
        reportStart,
        reportEnd,
        observer,
        planStore,
        granularity = 'month',
        resourceSpecId,
    } = params;

    // Build period buckets spanning the report range
    const buckets = buildPeriodBuckets(reportStart, reportEnd, granularity);

    // Initialize entries
    const entries: CashFlowEntry[] = buckets.map(b => ({
        period: b.key,
        periodStart: b.start,
        periodEnd: b.end,
        actualInflows: 0,
        actualOutflows: 0,
        netActual: 0,
        forecastedInflows: 0,
        forecastedOutflows: 0,
        netForecasted: 0,
        netCombined: 0,
        cumulativeNet: 0,
        actualEventIds: [],
        forecastedFlowIds: [],
    }));

    const entryByKey = new Map(entries.map(e => [e.period, e]));

    // --- Actual events ---
    const agentEvents = observer.eventsForAgent(agentId);
    for (const event of agentEvents) {
        if (!isFlowAction(event.action)) continue;
        if (resourceSpecId && event.resourceConformsTo !== resourceSpecId) continue;

        const eventTime = eventTimestamp(event);
        if (!eventTime || eventTime < reportStart || eventTime >= reportEnd) continue;

        const key = periodKey(eventTime, granularity);
        const entry = entryByKey.get(key);
        if (!entry) continue;

        const qty = event.resourceQuantity?.hasNumericalValue ?? 0;
        if (event.receiver === agentId) {
            entry.actualInflows += qty;
        } else if (event.provider === agentId) {
            entry.actualOutflows += qty;
        }
        entry.actualEventIds.push(event.id);
    }

    // --- Forecasted commitments ---
    const commitments = planStore.allCommitments().filter(c =>
        (c.provider === agentId || c.receiver === agentId) && !c.finished
    );
    for (const commitment of commitments) {
        if (!isFlowAction(commitment.action)) continue;
        if (resourceSpecId && commitment.resourceConformsTo !== resourceSpecId) continue;

        const flowTime = commitmentTimestamp(commitment);
        if (!flowTime || flowTime < reportStart || flowTime >= reportEnd) continue;

        const key = periodKey(flowTime, granularity);
        const entry = entryByKey.get(key);
        if (!entry) continue;

        const qty = commitment.resourceQuantity?.hasNumericalValue ?? 0;
        if (commitment.receiver === agentId) {
            entry.forecastedInflows += qty;
        } else if (commitment.provider === agentId) {
            entry.forecastedOutflows += qty;
        }
        entry.forecastedFlowIds.push(commitment.id);
    }

    // --- Forecasted intents (open, unmatched) ---
    const intents = planStore.allIntents().filter(i =>
        (i.provider === agentId || i.receiver === agentId) && !i.finished
    );
    for (const intent of intents) {
        if (!isFlowAction(intent.action)) continue;
        if (resourceSpecId && intent.resourceConformsTo !== resourceSpecId) continue;

        const flowTime = intentTimestamp(intent);
        if (!flowTime || flowTime < reportStart || flowTime >= reportEnd) continue;

        const key = periodKey(flowTime, granularity);
        const entry = entryByKey.get(key);
        if (!entry) continue;

        // Use availableQuantity if set, otherwise resourceQuantity
        const qty = (intent.availableQuantity ?? intent.resourceQuantity)?.hasNumericalValue ?? 0;
        if (intent.receiver === agentId) {
            entry.forecastedInflows += qty;
        } else if (intent.provider === agentId) {
            entry.forecastedOutflows += qty;
        }
        entry.forecastedFlowIds.push(intent.id);
    }

    // --- Compute nets and cumulative ---
    let cumulative = 0;
    for (const entry of entries) {
        entry.netActual = entry.actualInflows - entry.actualOutflows;
        entry.netForecasted = entry.forecastedInflows - entry.forecastedOutflows;
        entry.netCombined = entry.netActual + entry.netForecasted;
        cumulative += entry.netCombined;
        entry.cumulativeNet = cumulative;
    }

    // --- Report totals ---
    const totalActualInflows = entries.reduce((s, e) => s + e.actualInflows, 0);
    const totalActualOutflows = entries.reduce((s, e) => s + e.actualOutflows, 0);
    const totalForecastedInflows = entries.reduce((s, e) => s + e.forecastedInflows, 0);
    const totalForecastedOutflows = entries.reduce((s, e) => s + e.forecastedOutflows, 0);

    return {
        agentId,
        resourceSpecId,
        periodGranularity: granularity,
        reportStart,
        reportEnd,
        entries,
        totalActualInflows,
        totalActualOutflows,
        totalForecastedInflows,
        totalForecastedOutflows,
    };
}

// =============================================================================
// INTERNAL — Period utilities
// =============================================================================

interface PeriodBucket {
    key: string;
    start: Date;
    end: Date;
}

function buildPeriodBuckets(start: Date, end: Date, granularity: PeriodGranularity): PeriodBucket[] {
    const buckets: PeriodBucket[] = [];
    let cursor = periodStart(start, granularity);

    while (cursor < end) {
        const bucketEnd = nextPeriodStart(cursor, granularity);
        buckets.push({
            key: periodKey(cursor, granularity),
            start: new Date(cursor),
            end: bucketEnd,
        });
        cursor = bucketEnd;
    }

    return buckets;
}

function periodStart(date: Date, granularity: PeriodGranularity): Date {
    const d = new Date(date);
    switch (granularity) {
        case 'day':
            d.setUTCHours(0, 0, 0, 0);
            break;
        case 'week': {
            const day = d.getUTCDay();
            d.setUTCDate(d.getUTCDate() - day); // Sunday as week start
            d.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'month':
            d.setUTCDate(1);
            d.setUTCHours(0, 0, 0, 0);
            break;
        case 'quarter': {
            const q = Math.floor(d.getUTCMonth() / 3);
            d.setUTCMonth(q * 3, 1);
            d.setUTCHours(0, 0, 0, 0);
            break;
        }
        case 'year':
            d.setUTCMonth(0, 1);
            d.setUTCHours(0, 0, 0, 0);
            break;
    }
    return d;
}

function nextPeriodStart(current: Date, granularity: PeriodGranularity): Date {
    const d = new Date(current);
    switch (granularity) {
        case 'day': d.setUTCDate(d.getUTCDate() + 1); break;
        case 'week': d.setUTCDate(d.getUTCDate() + 7); break;
        case 'month': d.setUTCMonth(d.getUTCMonth() + 1); break;
        case 'quarter': d.setUTCMonth(d.getUTCMonth() + 3); break;
        case 'year': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    }
    return d;
}

function periodKey(date: Date, granularity: PeriodGranularity): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    switch (granularity) {
        case 'day': return `${y}-${m}-${d}`;
        case 'week': {
            // ISO week number
            const thursday = new Date(date);
            thursday.setUTCDate(date.getUTCDate() - date.getUTCDay() + 4);
            const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
            const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
        }
        case 'month': return `${y}-${m}`;
        case 'quarter': return `${y}-Q${Math.floor((date.getUTCMonth() / 3)) + 1}`;
        case 'year': return `${y}`;
    }
}

// =============================================================================
// INTERNAL — Event timestamp resolution
// =============================================================================

function eventTimestamp(event: EconomicEvent): Date | null {
    const t = event.hasPointInTime ?? event.hasEnd ?? event.hasBeginning ?? event.created;
    return t ? new Date(t) : null;
}

function commitmentTimestamp(commitment: Commitment): Date | null {
    const t = commitment.due ?? commitment.hasPointInTime ?? commitment.hasEnd ?? commitment.hasBeginning;
    return t ? new Date(t) : null;
}

function intentTimestamp(intent: Intent): Date | null {
    const t = intent.due ?? intent.hasPointInTime ?? intent.hasEnd ?? intent.hasBeginning;
    return t ? new Date(t) : null;
}

// =============================================================================
// INTERNAL — Which actions move value
// =============================================================================

/** Actions that represent a flow of economic value (transfer, exchange, sale) */
const FLOW_ACTIONS = new Set([
    'transfer', 'transferAllRights', 'transferCustody',
    'produce', 'consume', 'deliverService',
    'move', 'copy',
    'raise', 'lower',
]);

function isFlowAction(action: string): boolean {
    return FLOW_ACTIONS.has(action);
}
