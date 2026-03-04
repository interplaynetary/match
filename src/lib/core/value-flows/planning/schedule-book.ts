/**
 * ScheduleBook — focused per-entity schedule queries.
 *
 * Provides a single place to ask what commitments an agent/resource has and
 * whether a resource is available at a given time. Both PlanNetter delegates
 * availability checks here so future enhancements only need to be implemented once.
 *
 * Design:
 *   - No state mutation — all methods are read-only.
 *   - Optional Observer dependency — graceful degradation when absent.
 *
 * For capacity aggregation (net effort hours), use `netEffortHours` from
 * `../indexes/agents` — a pure function over a pre-built AgentIndex.
 */

import type { PlanStore } from './planning';
import type { Observer } from '../observation/observer';
import type { Commitment, Intent, Measure, VfAction } from '../schemas';
import { isWithinTemporalExpression, type TemporalExpression } from '../utils/time';

// =============================================================================
// TYPES
// =============================================================================

/**
 * ScheduleBlock — normalised view over both Intent and Commitment.
 *
 * Provides a unified interface for the scheduling-relevant fields so callers
 * don't need to branch on type before inspecting temporal/effort data.
 */
export interface ScheduleBlock {
    id: string;
    type: 'commitment' | 'intent';
    action: VfAction;
    provider?: string;
    receiver?: string;
    resourceInventoriedAs?: string;
    resourceConformsTo?: string;
    effortQuantity?: Measure;
    resourceQuantity?: Measure;
    hasBeginning?: string;
    hasEnd?: string;
    due?: string;
    availability_window?: TemporalExpression;
}

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Returns true if `block` overlaps the given date.
 *
 * Overlap priority (first matching rule wins):
 *   1. hasBeginning + hasEnd → half-open [begin, end) interval check
 *   2. due only → same UTC calendar day
 *   3. availability_window → isWithinTemporalExpression
 *   4. No temporal info → true (conservative: assume it overlaps)
 */
function blockOverlapsDate(block: ScheduleBlock, dt: Date): boolean {
    if (block.hasBeginning && block.hasEnd) {
        const begin = new Date(block.hasBeginning);
        const end = new Date(block.hasEnd);
        return dt >= begin && dt < end;
    }
    if (block.due) {
        return block.due.split('T')[0] === dt.toISOString().split('T')[0];
    }
    if (block.availability_window) {
        return isWithinTemporalExpression(dt, block.availability_window);
    }
    return true;
}

/**
 * Returns true if `block` overlaps the half-open window [from, to).
 * Used for use-slot conflict detection.
 */
function blockOverlapsWindow(block: ScheduleBlock, from: Date, to: Date): boolean {
    if (block.hasBeginning && block.hasEnd) {
        const begin = new Date(block.hasBeginning);
        const end = new Date(block.hasEnd);
        return begin < to && end > from;
    }
    if (block.due) {
        const due = new Date(block.due);
        return due >= from && due < to;
    }
    return true; // no temporal info — conservative: assume overlap
}

function intentToBlock(intent: Intent): ScheduleBlock {
    return {
        id: intent.id,
        type: 'intent',
        action: intent.action,
        provider: intent.provider,
        receiver: intent.receiver,
        resourceInventoriedAs: intent.resourceInventoriedAs,
        resourceConformsTo: intent.resourceConformsTo,
        effortQuantity: intent.effortQuantity,
        resourceQuantity: intent.resourceQuantity,
        hasBeginning: intent.hasBeginning,
        hasEnd: intent.hasEnd,
        due: intent.due,
        availability_window: intent.availability_window,
    };
}

function commitmentToBlock(commitment: Commitment): ScheduleBlock {
    return {
        id: commitment.id,
        type: 'commitment',
        action: commitment.action,
        provider: commitment.provider,
        receiver: commitment.receiver,
        resourceInventoriedAs: commitment.resourceInventoriedAs,
        resourceConformsTo: commitment.resourceConformsTo,
        effortQuantity: commitment.effortQuantity,
        resourceQuantity: commitment.resourceQuantity,
        hasBeginning: commitment.hasBeginning,
        hasEnd: commitment.hasEnd,
        due: commitment.due,
        availability_window: commitment.availability_window,
    };
}

// =============================================================================
// SCHEDULE BOOK
// =============================================================================

export class ScheduleBook {
    constructor(
        private readonly planStore: PlanStore,
        private readonly observer?: Observer,
    ) {}

    /**
     * All ScheduleBlocks for a given entity (agent or resource).
     *
     * Scans all Intents and Commitments where:
     *   provider === entityId  OR
     *   receiver === entityId  OR
     *   resourceInventoriedAs === entityId
     *
     * Optional filters:
     *   date    — only blocks overlapping this date (via blockOverlapsDate)
     *   actions — only blocks with one of these actions
     */
    blocksFor(entityId: string, opts?: { date?: Date; actions?: VfAction[] }): ScheduleBlock[] {
        const blocks: ScheduleBlock[] = [];

        for (const intent of this.planStore.allIntents()) {
            if (
                intent.provider === entityId ||
                intent.receiver === entityId ||
                intent.resourceInventoriedAs === entityId
            ) {
                blocks.push(intentToBlock(intent));
            }
        }

        for (const commitment of this.planStore.allCommitments()) {
            if (
                commitment.provider === entityId ||
                commitment.receiver === entityId ||
                commitment.resourceInventoriedAs === entityId
            ) {
                blocks.push(commitmentToBlock(commitment));
            }
        }

        let result = blocks;
        if (opts?.date) {
            const dt = opts.date;
            result = result.filter(b => blockOverlapsDate(b, dt));
        }
        if (opts?.actions) {
            const actions = opts.actions;
            result = result.filter(b => actions.includes(b.action));
        }
        return result;
    }

    /**
     * Total effort hours already committed by `agentId` on date `dt`.
     *
     * Only sums work Commitments (not Intents — those are offers, not bookings).
     */
    committedEffortOn(agentId: string, dt: Date): number {
        return this.blocksFor(agentId, { date: dt, actions: ['work'] })
            .filter(b => b.type === 'commitment')
            .reduce((sum, b) => sum + (b.effortQuantity?.hasNumericalValue ?? 0), 0);
    }

    /**
     * Returns true if there is already a scheduled `use` flow for `resourceId`
     * that overlaps the half-open window [from, to).
     *
     * Used by PlanNetter.netUse to detect time-slot conflicts against pre-existing
     * commitments in the PlanStore (e.g. from a previous planning session or a
     * merged leaf PlanStore).
     */
    hasUseConflict(resourceId: string, from: Date, to: Date): boolean {
        const blocks = this.blocksFor(resourceId, { actions: ['use'] });
        return blocks.some(b => blockOverlapsWindow(b, from, to));
    }

    /**
     * Returns true if the resource is available at the given date.
     *
     * Checks the resource's availability_window via isWithinTemporalExpression.
     * Falls back to true when:
     *   - no Observer is configured
     *   - resource is not found
     *   - resource has no availability_window
     *
     * Extension point: future commitment-blocking logic goes here.
     */
    isResourceAvailable(resourceId: string, dt: Date): boolean {
        if (!this.observer) return true;
        const resource = this.observer.getResource(resourceId);
        if (!resource) return true;
        if (!resource.availability_window) return true;
        return isWithinTemporalExpression(dt, resource.availability_window);
    }

}
