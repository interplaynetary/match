/**
 * PlanNetter — shared netting state for supply/demand planning.
 *
 * Extracts all inventory + scheduled-flow netting logic from the individual
 * algorithm files so it can be shared across multiple algorithm calls in one
 * planning session (Mode C: demand explosion then supply explosion over the
 * same planStore).
 *
 * Netting sources:
 *   1. Observer inventory (conformingResources)
 *   2. Scheduled output flows (Intents/Commitments with outputOf set)
 *   3. Scheduled consumption flows (Intents/Commitments with inputOf set)
 *
 * The `allocated` Set tracks soft-allocations across calls so the same
 * flow is never double-counted.
 */

import type { PlanStore } from './planning';
import type { Observer } from '../observation/observer';
import type { ScheduleBook } from './schedule-book';
import { isWithinTemporalExpression } from '../utils/time';

// =============================================================================
// TYPES
// =============================================================================

export interface DemandAllocation {
    resourceId: string;
    quantity: number;
}

export interface NetDemandResult {
    remaining: number;
    inventoryAllocated: DemandAllocation[];
}

// =============================================================================
// PLAN NETTER
// =============================================================================

export class PlanNetter {
    /** Soft-allocated flow IDs (shared across all calls on this netter instance). */
    readonly allocated: Set<string> = new Set();

    constructor(
        private readonly planStore: PlanStore,
        private readonly observer?: Observer,
        private readonly scheduleBook?: ScheduleBook,
    ) {}

    /**
     * Net a demand quantity against:
     *   1. Observer inventory (resources conforming to specId)
     *   2. Scheduled output Intents/Commitments in planStore (outputOf set)
     * Marks consumed sources as soft-allocated.
     * Used by: dependent-demand (replaces its inline netting block)
     */
    netDemand(
        specId: string,
        qty: number,
        opts?: { stage?: string; state?: string; neededBy?: Date; atLocation?: string },
    ): NetDemandResult {
        let remaining = qty;
        const inventoryAllocated: DemandAllocation[] = [];

        // --- Step 1: Observer inventory ---
        if (this.observer && remaining > 0) {
            const available = this.observer.conformingResources(specId)
                .filter(r => {
                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                    if (opts?.stage && r.stage !== opts.stage) return false;
                    if (opts?.state && r.state !== opts.state) return false;
                    // Containment guard: contained resources are physically unavailable until separated
                    if (r.containedIn !== undefined) return false;
                    // Location guard: only absorb inventory at the demand location
                    if (opts?.atLocation && r.currentLocation && r.currentLocation !== opts.atLocation) return false;
                    return true;
                });

            for (const r of available) {
                if (remaining <= 0) break;
                const avail = r.accountingQuantity?.hasNumericalValue ?? 0;
                const take = Math.min(avail, remaining);
                inventoryAllocated.push({ resourceId: r.id, quantity: take });
                remaining -= take;
            }
        }

        // --- Step 2: Scheduled output Intents (outputOf set) ---
        if (remaining > 0) {
            for (const intent of this.planStore.allIntents()) {
                if (remaining <= 0) break;
                if (
                    intent.resourceConformsTo === specId &&
                    intent.outputOf !== undefined &&
                    !intent.finished &&
                    !this.allocated.has(intent.id) &&
                    (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
                ) {
                    // Temporal guard: output must be ready by neededBy
                    if (opts?.neededBy && intent.due && new Date(intent.due) > opts.neededBy) continue;
                    // Location guard: only absorb output at the demand location
                    if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                    const take = Math.min(intent.resourceQuantity!.hasNumericalValue, remaining);
                    this.allocated.add(intent.id);
                    remaining -= take;
                }
            }
        }

        // --- Step 3: Scheduled output Commitments (outputOf set) ---
        if (remaining > 0) {
            for (const commitment of this.planStore.allCommitments()) {
                if (remaining <= 0) break;
                if (
                    commitment.resourceConformsTo === specId &&
                    commitment.outputOf !== undefined &&
                    !commitment.finished &&
                    !this.allocated.has(commitment.id) &&
                    (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
                ) {
                    // Temporal guard: output must be ready by neededBy
                    if (opts?.neededBy && commitment.due && new Date(commitment.due) > opts.neededBy) continue;
                    // Location guard: only absorb output at the demand location
                    if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                    const take = Math.min(commitment.resourceQuantity!.hasNumericalValue, remaining);
                    this.allocated.add(commitment.id);
                    remaining -= take;
                }
            }
        }

        return { remaining, inventoryAllocated };
    }

    /**
     * Net available supply against scheduled consumptions in planStore
     * (Intents/Commitments with inputOf set that haven't been soft-allocated yet).
     * Returns remaining supply after deducting pre-claimed consumptions.
     * Marks consumption flows as soft-allocated.
     * Used by: dependent-supply (new — enables Mode C)
     */
    netSupply(specId: string, qty: number, availableFrom?: Date, atLocation?: string): number {
        let remaining = qty;

        // --- Scheduled consumption Intents (inputOf set) ---
        for (const intent of this.planStore.allIntents()) {
            if (remaining <= 0) break;
            if (
                intent.resourceConformsTo === specId &&
                intent.inputOf !== undefined &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: supply must be available before the consumption is due
                if (availableFrom && intent.due && new Date(intent.due) < availableFrom) continue;
                // Location guard: only absorb consumptions at the supply location
                if (atLocation && intent.atLocation && intent.atLocation !== atLocation) continue;
                const take = Math.min(intent.resourceQuantity!.hasNumericalValue, remaining);
                this.allocated.add(intent.id);
                remaining -= take;
            }
        }

        // --- Scheduled consumption Commitments (inputOf set) ---
        for (const commitment of this.planStore.allCommitments()) {
            if (remaining <= 0) break;
            if (
                commitment.resourceConformsTo === specId &&
                commitment.inputOf !== undefined &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: supply must be available before the consumption is due
                if (availableFrom && commitment.due && new Date(commitment.due) < availableFrom) continue;
                // Location guard: only absorb consumptions at the supply location
                if (atLocation && commitment.atLocation && commitment.atLocation !== atLocation) continue;
                const take = Math.min(commitment.resourceQuantity!.hasNumericalValue, remaining);
                this.allocated.add(commitment.id);
                remaining -= take;
            }
        }

        return remaining;
    }

    /**
     * READ-ONLY peek: net available quantity of specId.
     * = inventory + scheduled outputs (not yet allocated)
     *   - scheduled consumptions (not yet allocated)
     * Does NOT mutate state. Used for capacity ceiling in computeMaxByOtherMaterials.
     */
    netAvailableQty(specId: string, opts?: { stage?: string; state?: string; asOf?: Date; atLocation?: string }): number {
        let total = 0;

        // Inventory
        if (this.observer) {
            for (const r of this.observer.conformingResources(specId)) {
                if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) continue;
                if (opts?.stage && r.stage !== opts.stage) continue;
                if (opts?.state && r.state !== opts.state) continue;
                // Containment guard: contained resources are physically unavailable until separated
                if (r.containedIn !== undefined) continue;
                // Location guard: only count inventory at the queried location
                if (opts?.atLocation && r.currentLocation && r.currentLocation !== opts.atLocation) continue;
                // Availability guard: delegate to scheduleBook when available, else inline check
                if (opts?.asOf) {
                    if (this.scheduleBook) {
                        if (!this.scheduleBook.isResourceAvailable(r.id, opts.asOf)) continue;
                    } else if (r.availability_window) {
                        if (!isWithinTemporalExpression(opts.asOf, r.availability_window)) continue;
                    }
                }
                total += r.accountingQuantity?.hasNumericalValue ?? 0;
            }
        }

        // Scheduled outputs (not yet allocated)
        for (const intent of this.planStore.allIntents()) {
            if (
                intent.resourceConformsTo === specId &&
                intent.outputOf !== undefined &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only count outputs that are ready by asOf
                if (opts?.asOf && intent.due && new Date(intent.due) > opts.asOf) continue;
                // Location guard: only count output at the queried location
                if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                total += intent.resourceQuantity!.hasNumericalValue;
            }
        }
        for (const commitment of this.planStore.allCommitments()) {
            if (
                commitment.resourceConformsTo === specId &&
                commitment.outputOf !== undefined &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only count outputs that are ready by asOf
                if (opts?.asOf && commitment.due && new Date(commitment.due) > opts.asOf) continue;
                // Location guard: only count output at the queried location
                if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                total += commitment.resourceQuantity!.hasNumericalValue;
            }
        }

        // Subtract scheduled consumptions (not yet allocated)
        for (const intent of this.planStore.allIntents()) {
            if (
                intent.resourceConformsTo === specId &&
                intent.inputOf !== undefined &&
                !intent.finished &&
                !this.allocated.has(intent.id) &&
                (intent.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only deduct consumptions due by asOf (future ones haven't consumed yet)
                if (opts?.asOf && intent.due && new Date(intent.due) > opts.asOf) continue;
                // Location guard: only deduct consumptions at the queried location
                if (opts?.atLocation && intent.atLocation && intent.atLocation !== opts.atLocation) continue;
                total -= intent.resourceQuantity!.hasNumericalValue;
            }
        }
        for (const commitment of this.planStore.allCommitments()) {
            if (
                commitment.resourceConformsTo === specId &&
                commitment.inputOf !== undefined &&
                !commitment.finished &&
                !this.allocated.has(commitment.id) &&
                (commitment.resourceQuantity?.hasNumericalValue ?? 0) > 0
            ) {
                // Temporal guard: only deduct consumptions due by asOf (future ones haven't consumed yet)
                if (opts?.asOf && commitment.due && new Date(commitment.due) > opts.asOf) continue;
                // Location guard: only deduct consumptions at the queried location
                if (opts?.atLocation && commitment.atLocation && commitment.atLocation !== opts.atLocation) continue;
                total -= commitment.resourceQuantity!.hasNumericalValue;
            }
        }

        return Math.max(0, total);
    }
}
