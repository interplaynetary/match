/**
 * Value Equations — Distribute income to contributors.
 *
 * From algorithms/equations.md (Sensorica pattern):
 *   "The idea is to have a published formula for distributing income to
 *    contributors to creating some deliverable that brings in some money."
 *
 * Algorithm:
 *   1. Start with an income event (e.g., a transfer or deliverService event)
 *   2. Trace backwards from the output resource to find all contributing events
 *   3. Score each contributor's input via a configurable ValueEquation formula
 *   4. Distribute income proportionally to scores
 *
 * Built-in formula types (any can be mixed in a weighted equation):
 *   - 'effort'   — weight by effort-hours contributed (work events)
 *   - 'resource' — weight by resource quantity consumed (consume events)
 *   - 'equal'    — equal share to every unique contributor agent
 *   - 'custom'   — caller-provided scoring function
 *
 * This is intentionally flexible: value networks can define their own
 * formulas and combine multiple criteria with different weights.
 */

import type { EconomicEvent } from '../schemas';
import type { Observer } from '../observation/observer';
import type { ProcessRegistry } from '../process-registry';
import { trace } from './track-trace';
import type { SNEIndex } from './SNE';

// =============================================================================
// TYPES
// =============================================================================

/** How to score a single contribution event. */
export type ContributionScorer = (event: EconomicEvent) => number;

/** A named component of a value equation, with a weight. */
export interface ValueEquationComponent {
    name: string;
    weight: number;             // 0..1, all weights should sum to 1
    scorer: ContributionScorer;
}

/** Published formula for distributing income. */
export interface ValueEquation {
    id: string;
    name: string;
    note?: string;
    components: ValueEquationComponent[];
}

/** One contributor's score and share. */
export interface ContributorShare {
    agentId: string;
    /** Raw weighted score before normalization */
    rawScore: number;
    /** Fraction of total income (0..1) */
    share: number;
    /** Absolute amount in income units */
    amount: number;
    /** The contributing events attributed to this agent */
    contributingEventIds: string[];
}

export interface ValueEquationResult {
    incomeEventId: string;
    totalIncome: number;
    incomeUnit: string;
    equationId: string;
    equationName: string;
    shares: ContributorShare[];
    /** Agents that contributed but received 0 (score was 0) */
    zeroScoreAgents: string[];
}

// =============================================================================
// BUILT-IN SCORERS
// =============================================================================

/** Score by effort quantity (hours, minutes, etc.). */
export const effortScorer: ContributionScorer = (event) => {
    return event.effortQuantity?.hasNumericalValue ?? 0;
};

/** Score by resource quantity consumed. */
export const resourceScorer: ContributionScorer = (event) => {
    if (!['consume', 'use', 'cite'].includes(event.action)) return 0;
    return event.resourceQuantity?.hasNumericalValue ?? 0;
};

/** Equal score for any contributor (1 if they have any event, 0 otherwise). */
export const equalScorer: ContributionScorer = (_event) => 1;

// =============================================================================
// BUILT-IN EQUATIONS
// =============================================================================

/** Distribute entirely by effort hours. */
export const effortEquation: ValueEquation = {
    id: 'vf:effort-only',
    name: 'Effort Hours',
    note: 'Distribute income proportionally to effort-hours contributed.',
    components: [{ name: 'effort', weight: 1, scorer: effortScorer }],
};

/** Equal shares to all unique contributors. */
export const equalEquation: ValueEquation = {
    id: 'vf:equal-share',
    name: 'Equal Share',
    note: 'Every contributor receives an equal share regardless of quantity.',
    components: [{ name: 'equal', weight: 1, scorer: equalScorer }],
};

/** Hybrid: 70% effort + 30% resource usage. */
export const hybridEquation: ValueEquation = {
    id: 'vf:hybrid',
    name: 'Effort + Resource Hybrid',
    note: '70% by effort-hours, 30% by resource quantity.',
    components: [
        { name: 'effort', weight: 0.7, scorer: effortScorer },
        { name: 'resource', weight: 0.3, scorer: resourceScorer },
    ],
};

// =============================================================================
// DEPRECIATION SCORER
// =============================================================================

/**
 * Creates a ContributionScorer that weights `use` events by depreciation value:
 *   score = (duration_used / lifespan) × SNE(tool_spec)
 *
 * This properly credits tool owners for the fraction of the tool's embodied
 * labor consumed by a production run, rather than counting raw resource quantity.
 *
 * @param sneIndex   Pre-built SNE index (specId → effort hours/unit)
 * @param lifespans  Map of specId → total lifespan in effort hours
 * @param observer   Optional; used to look up resourceConformsTo when absent on event
 */
export function makeDepreciationScorer(
    sneIndex: SNEIndex,
    lifespans: Map<string, number>,
    observer?: Observer,
): ContributionScorer {
    return (event: EconomicEvent) => {
        if (event.action !== 'use') return 0;
        const specId = event.resourceConformsTo
            ?? (event.resourceInventoriedAs
                ? observer?.getResource(event.resourceInventoriedAs)?.conformsTo
                : undefined);
        if (!specId) return 0;
        const lifespan = lifespans.get(specId);
        if (!lifespan || lifespan <= 0) return 0;
        const duration = event.effortQuantity?.hasNumericalValue ?? 0;
        const equipSNE = sneIndex.get(specId) ?? 0;
        return (duration / lifespan) * equipSNE;
    };
}

/**
 * Convenience factory: 60% effort + 40% depreciation value equation.
 * Balances direct labor contribution with tool owner compensation.
 */
export function makeHybridWithDepreciationEquation(
    sneIndex: SNEIndex,
    lifespans: Map<string, number>,
    observer?: Observer,
): ValueEquation {
    return {
        id: 'hybrid-with-depreciation',
        name: 'Effort + Depreciation',
        components: [
            { name: 'labor', weight: 0.6, scorer: effortScorer },
            { name: 'depreciation', weight: 0.4, scorer: makeDepreciationScorer(sneIndex, lifespans, observer) },
        ],
    };
}

// =============================================================================
// DISTRIBUTE INCOME
// =============================================================================

/**
 * Distribute income from an event (typically a sale) backwards to contributors.
 *
 * @param incomeEventId - The event that brought in income (transfer, deliverService, etc.)
 * @param observer - Observation layer
 * @param processReg - Process registry
 * @param equation - The value equation to apply
 */
export function distributeIncome(
    incomeEventId: string,
    observer: Observer,
    processReg: ProcessRegistry,
    equation: ValueEquation,
): ValueEquationResult {
    const incomeEvent = observer.getEvent(incomeEventId);
    if (!incomeEvent) throw new Error(`Event ${incomeEventId} not found`);

    const totalIncome = incomeEvent.resourceQuantity?.hasNumericalValue ?? 0;
    const incomeUnit = incomeEvent.resourceQuantity?.hasUnit ?? 'USD';

    // Collect all contributing input events by tracing backwards from the income event
    const nodes = trace(incomeEventId, observer, processReg);
    const contributingEvents = nodes
        .filter(n => n.kind === 'event')
        .map(n => n.data as EconomicEvent)
        .filter(e => e.id !== incomeEventId && isContributingEvent(e));

    if (contributingEvents.length === 0) {
        return {
            incomeEventId,
            totalIncome,
            incomeUnit,
            equationId: equation.id,
            equationName: equation.name,
            shares: [],
            zeroScoreAgents: [],
        };
    }

    // Score each event by each equation component (weighted)
    const agentScores = new Map<string, { score: number; eventIds: string[] }>();

    for (const event of contributingEvents) {
        const agentId = event.provider;
        if (!agentId) continue;

        let weightedScore = 0;
        for (const component of equation.components) {
            weightedScore += component.weight * component.scorer(event);
        }

        const existing = agentScores.get(agentId) ?? { score: 0, eventIds: [] };
        existing.score += weightedScore;
        existing.eventIds.push(event.id);
        agentScores.set(agentId, existing);
    }

    const totalScore = Array.from(agentScores.values()).reduce((s, a) => s + a.score, 0);
    const zeroScoreAgents: string[] = [];
    const shares: ContributorShare[] = [];

    for (const [agentId, { score, eventIds }] of agentScores) {
        if (score === 0) {
            zeroScoreAgents.push(agentId);
            continue;
        }
        const share = totalScore === 0 ? 0 : score / totalScore;
        shares.push({
            agentId,
            rawScore: score,
            share,
            amount: share * totalIncome,
            contributingEventIds: eventIds,
        });
    }

    // Sort descending by share
    shares.sort((a, b) => b.share - a.share);

    return {
        incomeEventId,
        totalIncome,
        incomeUnit,
        equationId: equation.id,
        equationName: equation.name,
        shares,
        zeroScoreAgents,
    };
}

// =============================================================================
// MULTI-OUTPUT DISTRIBUTION
// =============================================================================

/**
 * Distribute income when a single output event (e.g. sale) covers multiple
 * deliverables (e.g. a bundle of products from different contributors).
 *
 * Each output commitment is split proportionally, then each split is distributed
 * to its own contributors via the equation.
 *
 * @param incomeEventIds - Multiple income events (one per output)
 * @param observer - Observation layer
 * @param processReg - Process registry
 * @param equation - Value equation to apply to each output
 */
export function distributeMultipleIncome(
    incomeEventIds: string[],
    observer: Observer,
    processReg: ProcessRegistry,
    equation: ValueEquation,
): ValueEquationResult[] {
    return incomeEventIds.map(id => distributeIncome(id, observer, processReg, equation));
}

// =============================================================================
// INTERNAL
// =============================================================================

/** Events that represent actual contributions (not output/transfer events). */
const CONTRIBUTING_ACTIONS = new Set(['work', 'consume', 'use', 'cite', 'deliverService']);

function isContributingEvent(event: EconomicEvent): boolean {
    return CONTRIBUTING_ACTIONS.has(event.action);
}
