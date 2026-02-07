/**
 * Fulfillment: Tracking commitments and deliveries to slots.
 *
 * Two immutable record types:
 * - Commitment: a promise to provide quantity (can be cancelled)
 * - Delivery: actual provision of quantity (immutable event)
 *
 * Design principles:
 * 1. Immutable records (append-only log, audit trail)
 * 2. (slot_id, occurrence) pair identifies an instance lazily
 * 3. Coverage = (delivered + committed) / needed
 * 4. Time accounting via duration_hours on Delivery
 *
 * "Economy of time, along with the planned distribution of labour time among
 * the various branches of production, remains the first economic law on the
 * basis of communal production." — Marx, Grundrisse
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { NanoId } from './commons';

// =============================================================================
// COMMITMENT
// =============================================================================
// A promise to provide quantity to a slot (for an occurrence).
// Immutable once created, can only be cancelled.

export const Commitment = z.object({
    id: NanoId,
    slot_id: NanoId,
    commons_id: NanoId,
    occurrence: z.string().optional(),  // YYYY-MM-DD for recurring

    contributor_id: z.string(),
    capacity_id: NanoId.optional(),  // which capacity resource this draws from

    quantity: z.number().positive(),
    unit: z.string().optional(),

    committed_at: z.date(),
    cancelled_at: z.date().optional(),

    notes: z.string().optional(),
});

export type Commitment = z.infer<typeof Commitment>;

export const isActiveCommitment = (c: Commitment) => !c.cancelled_at;

// =============================================================================
// DELIVERY
// =============================================================================
// Actual provision of quantity. Immutable event.
// May or may not be linked to a prior commitment.

export const Delivery = z.object({
    id: NanoId,
    slot_id: NanoId,
    commons_id: NanoId,
    occurrence: z.string().optional(),

    commitment_id: NanoId.optional(),  // link to commitment (optional)
    contributor_id: z.string(),

    quantity: z.number().nonnegative(),
    unit: z.string().optional(),

    delivered_at: z.date(),
    duration_hours: z.number().nonnegative().optional(),  // time accounting

    notes: z.string().optional(),
});

export type Delivery = z.infer<typeof Delivery>;

// =============================================================================
// OCCURRENCE KEY
// =============================================================================

export type OccurrenceKey = `${string}:${string | '_'}`;

export const occurrenceKey = (slot_id: NanoId, occurrence?: string): OccurrenceKey =>
    `${slot_id}:${occurrence ?? '_'}`;

// =============================================================================
// COVERAGE METRICS
// =============================================================================

export interface OccurrenceCoverage {
    slot_id: NanoId;
    occurrence?: string;

    quantity_needed: number;
    quantity_delivered: number;
    quantity_committed: number;  // active commitments, excluding already-delivered portions
    quantity_remaining: number;  // needed - delivered
    quantity_gap: number;        // remaining - committed (negative = over-committed)

    coverage_ratio: number;      // (delivered + committed) / needed
    delivery_ratio: number;      // delivered / needed

    status: 'delivered' | 'covered' | 'partial' | 'gap';

    commitments: Commitment[];
    deliveries: Delivery[];
    contributors: string[];
}

export interface SlotCoverage {
    slot_id: NanoId;
    commons_id: NanoId;
    is_recurring: boolean;

    // For non-recurring: single occurrence coverage
    // For recurring: aggregated across known occurrences
    occurrences: Map<string | undefined, OccurrenceCoverage>;

    total_needed: number;
    total_delivered: number;
    total_committed: number;
    total_gap: number;

    occurrences_count: number;
    occurrences_delivered: number;   // delivery_ratio >= 1
    occurrences_covered: number;     // coverage_ratio >= 1
    occurrences_with_gap: number;    // coverage_ratio < 1

    unique_contributors: string[];
}

export interface TimeAccounting {
    total_duration_hours: number;
    delivery_count: number;
    avg_duration_hours?: number;
    // Socially necessary labor time: average across similar deliveries
    socially_necessary_hours?: number;
}

// =============================================================================
// FULFILLMENT STORE
// =============================================================================

export class Fulfillments {
    private commitments = new Map<NanoId, Commitment>();
    private deliveries = new Map<NanoId, Delivery>();

    // Indexes for commitments
    private commitmentsBySlot = new Map<NanoId, Set<NanoId>>();
    private commitmentsByOccurrence = new Map<OccurrenceKey, Set<NanoId>>();
    private commitmentsByContributor = new Map<string, Set<NanoId>>();
    private commitmentsByCapacity = new Map<NanoId, Set<NanoId>>();

    // Indexes for deliveries
    private deliveriesBySlot = new Map<NanoId, Set<NanoId>>();
    private deliveriesByOccurrence = new Map<OccurrenceKey, Set<NanoId>>();
    private deliveriesByCommitment = new Map<NanoId, Set<NanoId>>();
    private deliveriesByContributor = new Map<string, Set<NanoId>>();

    // =========================================================================
    // COMMITMENTS
    // =========================================================================

    commit(data: {
        slot_id: NanoId;
        commons_id: NanoId;
        contributor_id: string;
        quantity: number;
        unit?: string;
        occurrence?: string;
        capacity_id?: NanoId;  // which capacity this draws from
        notes?: string;
    }): Commitment {
        const commitment: Commitment = {
            id: nanoid() as NanoId,
            slot_id: data.slot_id,
            commons_id: data.commons_id,
            occurrence: data.occurrence,
            contributor_id: data.contributor_id,
            capacity_id: data.capacity_id,
            quantity: data.quantity,
            unit: data.unit,
            committed_at: new Date(),
            notes: data.notes,
        };

        this.commitments.set(commitment.id, commitment);
        this.indexCommitment(commitment);
        return commitment;
    }

    cancelCommitment(id: NanoId): Commitment {
        const c = this.commitments.get(id);
        if (!c) throw new Error(`Commitment ${id} not found`);
        if (c.cancelled_at) throw new Error(`Commitment ${id} already cancelled`);

        // Create new record with cancellation (immutability)
        const cancelled: Commitment = { ...c, cancelled_at: new Date() };
        this.commitments.set(id, cancelled);
        return cancelled;
    }

    getCommitment(id: NanoId): Commitment | undefined {
        return this.commitments.get(id);
    }

    // =========================================================================
    // DELIVERIES
    // =========================================================================

    deliver(data: {
        slot_id: NanoId;
        commons_id: NanoId;
        contributor_id: string;
        quantity: number;
        unit?: string;
        occurrence?: string;
        commitment_id?: NanoId;
        duration_hours?: number;
        notes?: string;
    }): Delivery {
        // Validate commitment if provided
        if (data.commitment_id) {
            const commitment = this.commitments.get(data.commitment_id);
            if (!commitment) throw new Error(`Commitment ${data.commitment_id} not found`);
            if (commitment.cancelled_at) throw new Error(`Commitment ${data.commitment_id} is cancelled`);
        }

        const delivery: Delivery = {
            id: nanoid() as NanoId,
            slot_id: data.slot_id,
            commons_id: data.commons_id,
            occurrence: data.occurrence,
            commitment_id: data.commitment_id,
            contributor_id: data.contributor_id,
            quantity: data.quantity,
            unit: data.unit,
            delivered_at: new Date(),
            duration_hours: data.duration_hours,
            notes: data.notes,
        };

        this.deliveries.set(delivery.id, delivery);
        this.indexDelivery(delivery);
        return delivery;
    }

    getDelivery(id: NanoId): Delivery | undefined {
        return this.deliveries.get(id);
    }

    // =========================================================================
    // QUERIES
    // =========================================================================

    commitmentsForSlot(slot_id: NanoId): Commitment[] {
        return this.getFromIndex(this.commitmentsBySlot, slot_id, this.commitments);
    }

    commitmentsForOccurrence(slot_id: NanoId, occurrence?: string): Commitment[] {
        return this.getFromIndex(
            this.commitmentsByOccurrence,
            occurrenceKey(slot_id, occurrence),
            this.commitments
        );
    }

    deliveriesForSlot(slot_id: NanoId): Delivery[] {
        return this.getFromIndex(this.deliveriesBySlot, slot_id, this.deliveries);
    }

    deliveriesForOccurrence(slot_id: NanoId, occurrence?: string): Delivery[] {
        return this.getFromIndex(
            this.deliveriesByOccurrence,
            occurrenceKey(slot_id, occurrence),
            this.deliveries
        );
    }

    deliveriesForCommitment(commitment_id: NanoId): Delivery[] {
        return this.getFromIndex(this.deliveriesByCommitment, commitment_id, this.deliveries);
    }

    // =========================================================================
    // COVERAGE COMPUTATION
    // =========================================================================

    /**
     * Compute coverage for a single occurrence.
     */
    occurrenceCoverage(
        slot_id: NanoId,
        quantity_needed: number,
        occurrence?: string
    ): OccurrenceCoverage {
        const commitments = this.commitmentsForOccurrence(slot_id, occurrence)
            .filter(isActiveCommitment);
        const deliveries = this.deliveriesForOccurrence(slot_id, occurrence);

        const delivered = deliveries.reduce((sum, d) => sum + d.quantity, 0);

        // For committed: sum of commitments minus what's already delivered against them
        let committed = 0;
        for (const c of commitments) {
            const deliveredAgainst = this.deliveriesForCommitment(c.id)
                .reduce((sum, d) => sum + d.quantity, 0);
            const remaining = Math.max(0, c.quantity - deliveredAgainst);
            committed += remaining;
        }

        const remaining = Math.max(0, quantity_needed - delivered);
        const gap = remaining - committed;

        const coverageRatio = quantity_needed > 0
            ? (delivered + committed) / quantity_needed
            : (delivered + committed > 0 ? 1 : 0);

        const deliveryRatio = quantity_needed > 0
            ? delivered / quantity_needed
            : (delivered > 0 ? 1 : 0);

        const status: OccurrenceCoverage['status'] =
            deliveryRatio >= 1 ? 'delivered' :
            coverageRatio >= 1 ? 'covered' :
            coverageRatio > 0 ? 'partial' : 'gap';

        const contributors = [
            ...new Set([
                ...commitments.map(c => c.contributor_id),
                ...deliveries.map(d => d.contributor_id),
            ])
        ];

        return {
            slot_id,
            occurrence,
            quantity_needed,
            quantity_delivered: delivered,
            quantity_committed: committed,
            quantity_remaining: remaining,
            quantity_gap: gap,
            coverage_ratio: coverageRatio,
            delivery_ratio: deliveryRatio,
            status,
            commitments,
            deliveries,
            contributors,
        };
    }

    /**
     * Compute coverage for a slot across all known occurrences.
     */
    slotCoverage(
        slot_id: NanoId,
        commons_id: NanoId,
        quantity_needed: number,
        is_recurring: boolean = false
    ): SlotCoverage {
        // Gather all known occurrences from commitments and deliveries
        const knownOccurrences = new Set<string | undefined>();

        for (const c of this.commitmentsForSlot(slot_id)) {
            knownOccurrences.add(c.occurrence);
        }
        for (const d of this.deliveriesForSlot(slot_id)) {
            knownOccurrences.add(d.occurrence);
        }

        // If no occurrences known and not recurring, add undefined (the single instance)
        if (knownOccurrences.size === 0) {
            knownOccurrences.add(undefined);
        }

        // Compute coverage per occurrence
        const occurrences = new Map<string | undefined, OccurrenceCoverage>();
        let totalNeeded = 0, totalDelivered = 0, totalCommitted = 0, totalGap = 0;
        let countDelivered = 0, countCovered = 0, countWithGap = 0;
        const allContributors = new Set<string>();

        for (const occ of knownOccurrences) {
            const coverage = this.occurrenceCoverage(slot_id, quantity_needed, occ);
            occurrences.set(occ, coverage);

            totalNeeded += coverage.quantity_needed;
            totalDelivered += coverage.quantity_delivered;
            totalCommitted += coverage.quantity_committed;
            totalGap += Math.max(0, coverage.quantity_gap);

            if (coverage.status === 'delivered') countDelivered++;
            if (coverage.status === 'delivered' || coverage.status === 'covered') countCovered++;
            if (coverage.status === 'gap' || coverage.status === 'partial') countWithGap++;

            coverage.contributors.forEach(id => allContributors.add(id));
        }

        return {
            slot_id,
            commons_id,
            is_recurring,
            occurrences,
            total_needed: totalNeeded,
            total_delivered: totalDelivered,
            total_committed: totalCommitted,
            total_gap: totalGap,
            occurrences_count: knownOccurrences.size,
            occurrences_delivered: countDelivered,
            occurrences_covered: countCovered,
            occurrences_with_gap: countWithGap,
            unique_contributors: Array.from(allContributors),
        };
    }

    /**
     * Compute coverage for expected future occurrences (for recurring slots).
     * This handles the "lazy instance" problem by generating expected occurrences.
     */
    recurringCoverage(
        slot_id: NanoId,
        commons_id: NanoId,
        quantity_needed: number,
        expectedOccurrences: string[]  // caller provides based on recurrence pattern
    ): SlotCoverage {
        // Start with known occurrences
        const coverage = this.slotCoverage(slot_id, commons_id, quantity_needed, true);

        // Add any expected occurrences not yet known
        for (const occ of expectedOccurrences) {
            if (!coverage.occurrences.has(occ)) {
                const occCoverage = this.occurrenceCoverage(slot_id, quantity_needed, occ);
                coverage.occurrences.set(occ, occCoverage);

                coverage.total_needed += occCoverage.quantity_needed;
                coverage.total_gap += Math.max(0, occCoverage.quantity_gap);
                coverage.occurrences_count++;

                if (occCoverage.status === 'gap') {
                    coverage.occurrences_with_gap++;
                }
            }
        }

        return coverage;
    }

    // =========================================================================
    // TIME ACCOUNTING
    // =========================================================================

    /**
     * Time accounting for deliveries.
     */
    timeAccounting(deliveries: Delivery[]): TimeAccounting {
        const withDuration = deliveries.filter(d => d.duration_hours !== undefined);
        const totalDuration = withDuration.reduce((sum, d) => sum + d.duration_hours!, 0);
        const avgDuration = withDuration.length > 0
            ? totalDuration / withDuration.length
            : undefined;

        return {
            total_duration_hours: totalDuration,
            delivery_count: deliveries.length,
            avg_duration_hours: avgDuration,
            socially_necessary_hours: avgDuration,  // same as average for now
        };
    }

    /**
     * Time accounting for a slot.
     */
    slotTimeAccounting(slot_id: NanoId): TimeAccounting {
        return this.timeAccounting(this.deliveriesForSlot(slot_id));
    }

    /**
     * Commitment-to-delivery gap analysis.
     */
    commitmentDeliveryGap(commitment_id: NanoId): {
        commitment: Commitment;
        deliveries: Delivery[];
        quantity_committed: number;
        quantity_delivered: number;
        quantity_remaining: number;
        is_fulfilled: boolean;
        time_to_first_delivery_hours?: number;
    } | undefined {
        const commitment = this.commitments.get(commitment_id);
        if (!commitment) return undefined;

        const deliveries = this.deliveriesForCommitment(commitment_id);
        const delivered = deliveries.reduce((sum, d) => sum + d.quantity, 0);
        const remaining = Math.max(0, commitment.quantity - delivered);

        let timeToFirst: number | undefined;
        if (deliveries.length > 0) {
            const firstDelivery = deliveries.reduce((earliest, d) =>
                d.delivered_at < earliest.delivered_at ? d : earliest
            );
            timeToFirst = (firstDelivery.delivered_at.getTime() - commitment.committed_at.getTime())
                / (1000 * 60 * 60);
        }

        return {
            commitment,
            deliveries,
            quantity_committed: commitment.quantity,
            quantity_delivered: delivered,
            quantity_remaining: remaining,
            is_fulfilled: remaining === 0,
            time_to_first_delivery_hours: timeToFirst,
        };
    }

    // =========================================================================
    // MANAGEMENT
    // =========================================================================

    clear() {
        this.commitments.clear();
        this.deliveries.clear();
        this.commitmentsBySlot.clear();
        this.commitmentsByOccurrence.clear();
        this.commitmentsByContributor.clear();
        this.commitmentsByCapacity.clear();
        this.deliveriesBySlot.clear();
        this.deliveriesByOccurrence.clear();
        this.deliveriesByCommitment.clear();
        this.deliveriesByContributor.clear();
    }

    allCommitments(): Commitment[] {
        return Array.from(this.commitments.values());
    }

    allDeliveries(): Delivery[] {
        return Array.from(this.deliveries.values());
    }

    // =========================================================================
    // PRIVATE: Indexing
    // =========================================================================

    private indexCommitment(c: Commitment) {
        this.addToIndex(this.commitmentsBySlot, c.slot_id, c.id);
        this.addToIndex(this.commitmentsByOccurrence, occurrenceKey(c.slot_id, c.occurrence), c.id);
        this.addToIndex(this.commitmentsByContributor, c.contributor_id, c.id);
        if (c.capacity_id) {
            this.addToIndex(this.commitmentsByCapacity, c.capacity_id, c.id);
        }
    }

    private indexDelivery(d: Delivery) {
        this.addToIndex(this.deliveriesBySlot, d.slot_id, d.id);
        this.addToIndex(this.deliveriesByOccurrence, occurrenceKey(d.slot_id, d.occurrence), d.id);
        this.addToIndex(this.deliveriesByContributor, d.contributor_id, d.id);
        if (d.commitment_id) {
            this.addToIndex(this.deliveriesByCommitment, d.commitment_id, d.id);
        }
    }

    private addToIndex<K>(index: Map<K, Set<NanoId>>, key: K, id: NanoId) {
        const set = index.get(key) ?? new Set();
        set.add(id);
        index.set(key, set);
    }

    private getFromIndex<K, V>(
        index: Map<K, Set<NanoId>>,
        key: K,
        store: Map<NanoId, V>
    ): V[] {
        const ids = index.get(key);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => store.get(id))
            .filter((v): v is V => v !== undefined);
    }
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const fulfillments = new Fulfillments();
