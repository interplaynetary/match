/**
 * Allocation: Tracking commitments of capacity to slots.
 *
 * A commitment is allocation state — a claim on capacity pledged to a slot.
 * Nothing changed in the world; it's a coordination decision that partitions
 * capacity so it isn't double-counted.
 *
 * Actual fulfillment happens when effects are produced and accepted. Those
 * effects fold into state, and slot predicates re-evaluate via derivation.
 * Coverage of actual fulfillment is derived state, not a recorded artifact.
 *
 * "Economy of time, along with the planned distribution of labour time among
 * the various branches of production, remains the first economic law on the
 * basis of communal production." — Marx, Grundrisse
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { NanoId } from '../primitives/ids';
import { createHexIndex, addItemToHexIndex, queryHexIndexRadius, type HexIndex } from '../primitives/space-time-index';

// =============================================================================
// COMMITMENT — Allocation state: a claim on capacity for a slot
// =============================================================================

export const Commitment = z.object({
    id: NanoId,
    slot_id: NanoId,
    process_id: NanoId,
    occurrence: z.string().optional(),  // YYYY-MM-DD for recurring

    contributor_id: z.string(),
    capacity_id: NanoId.optional(),  // which capacity resource this draws from

    quantity: z.number().positive(),
    unit: z.string().optional(),

    committed_at: z.date(),
    cancelled_at: z.date().optional(),

    // Spatial (for discovery/reporting)
    h3_index: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    radius_km: z.number().optional(),

    notes: z.string().optional(),
});

export type Commitment = z.infer<typeof Commitment>;

export const isActiveCommitment = (c: Commitment) => !c.cancelled_at;

// =============================================================================
// OCCURRENCE KEY
// =============================================================================

export type OccurrenceKey = `${string}:${string | '_'}`;

export const occurrenceKey = (slot_id: NanoId, occurrence?: string): OccurrenceKey =>
    `${slot_id}:${occurrence ?? '_'}`;

// =============================================================================
// ALLOCATION COVERAGE — How much of a slot's need is claimed
// =============================================================================

export interface AllocationCoverage {
    slot_id: NanoId;
    occurrence?: string;

    quantity_needed: number;
    quantity_allocated: number;  // sum of active commitments
    quantity_gap: number;        // needed - allocated (negative = over-allocated)

    allocation_ratio: number;    // allocated / needed

    status: 'fully_allocated' | 'partial' | 'gap';

    commitments: Commitment[];
    contributors: string[];
}

export interface SlotAllocation {
    slot_id: NanoId;
    process_id: NanoId;
    is_recurring: boolean;

    occurrences: Map<string | undefined, AllocationCoverage>;

    total_needed: number;
    total_allocated: number;
    total_gap: number;

    occurrences_count: number;
    occurrences_fully_allocated: number;
    occurrences_with_gap: number;

    unique_contributors: string[];
}

// =============================================================================
// ALLOCATIONS STORE
// =============================================================================

export class Allocations {
    private commitments = new Map<NanoId, Commitment>();

    // Indexes
    private commitmentsBySlot = new Map<NanoId, Set<NanoId>>();
    private commitmentsByOccurrence = new Map<OccurrenceKey, Set<NanoId>>();
    private commitmentsByContributor = new Map<string, Set<NanoId>>();
    private commitmentsByCapacity = new Map<NanoId, Set<NanoId>>();
    
    // Spatial Index
    private spatialIndex: HexIndex<Commitment> = createHexIndex<Commitment>(9, 4);

    // =========================================================================
    // COMMITMENTS
    // =========================================================================

    commit(data: {
        slot_id: NanoId;
        process_id: NanoId;
        contributor_id: string;
        quantity: number;
        unit?: string;
        occurrence?: string;
        capacity_id?: NanoId;
        h3_index?: string;
        latitude?: number;
        longitude?: number;
        radius_km?: number;
        notes?: string;
    }): Commitment {
        const commitment: Commitment = {
            id: nanoid() as NanoId,
            slot_id: data.slot_id,
            process_id: data.process_id,
            occurrence: data.occurrence,
            contributor_id: data.contributor_id,
            capacity_id: data.capacity_id,
            quantity: data.quantity,
            unit: data.unit,
            committed_at: new Date(),
            h3_index: data.h3_index,
            latitude: data.latitude,
            longitude: data.longitude,
            radius_km: data.radius_km,
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

        const cancelled: Commitment = { ...c, cancelled_at: new Date() };
        this.commitments.set(id, cancelled);
        
        // Remove from spatial index (we don't have a deleteFromHexIndex yet, so we'll just leave it or rebuild. For now, it remains but isActiveCommitment filters it out).
        
        return cancelled;
    }

    getCommitment(id: NanoId): Commitment | undefined {
        return this.commitments.get(id);
    }

    // =========================================================================
    // QUERIES
    // =========================================================================

    commitmentsForSlot(slot_id: NanoId): Commitment[] {
        return this.getFromIndex(this.commitmentsBySlot, slot_id);
    }

    commitmentsForOccurrence(slot_id: NanoId, occurrence?: string): Commitment[] {
        return this.getFromIndex(
            this.commitmentsByOccurrence,
            occurrenceKey(slot_id, occurrence),
        );
    }

    commitmentsForContributor(contributor_id: string): Commitment[] {
        return this.getFromIndex(this.commitmentsByContributor, contributor_id);
    }

    commitmentsForCapacity(capacity_id: NanoId): Commitment[] {
        return this.getFromIndex(this.commitmentsByCapacity, capacity_id);
    }
    
    commitmentsByLocation(location: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number }): Commitment[] {
         const matchingIds = queryHexIndexRadius(this.spatialIndex, location);
         return Array.from(matchingIds)
              .map(id => this.commitments.get(id as NanoId))
              .filter((c): c is Commitment => c !== undefined && isActiveCommitment(c)); // Only active ones
    }

    // =========================================================================
    // ALLOCATION COVERAGE
    // =========================================================================

    /**
     * How much of a slot's need is allocated (claimed by commitments)
     * for a single occurrence.
     */
    allocationCoverage(
        slot_id: NanoId,
        quantity_needed: number,
        occurrence?: string,
    ): AllocationCoverage {
        const commitments = this.commitmentsForOccurrence(slot_id, occurrence)
            .filter(isActiveCommitment);

        const allocated = commitments.reduce((sum, c) => sum + c.quantity, 0);
        const gap = quantity_needed - allocated;

        const ratio = quantity_needed > 0
            ? allocated / quantity_needed
            : (allocated > 0 ? 1 : 0);

        const status: AllocationCoverage['status'] =
            ratio >= 1 ? 'fully_allocated' :
            ratio > 0 ? 'partial' : 'gap';

        const contributors = [...new Set(commitments.map(c => c.contributor_id))];

        return {
            slot_id,
            occurrence,
            quantity_needed,
            quantity_allocated: allocated,
            quantity_gap: gap,
            allocation_ratio: ratio,
            status,
            commitments,
            contributors,
        };
    }

    /**
     * Allocation coverage for a slot across all known occurrences.
     */
    slotAllocation(
        slot_id: NanoId,
        process_id: NanoId,
        quantity_needed: number,
        is_recurring: boolean = false,
    ): SlotAllocation {
        const knownOccurrences = new Set<string | undefined>();

        for (const c of this.commitmentsForSlot(slot_id)) {
            knownOccurrences.add(c.occurrence);
        }

        if (knownOccurrences.size === 0) {
            knownOccurrences.add(undefined);
        }

        const occurrences = new Map<string | undefined, AllocationCoverage>();
        let totalNeeded = 0, totalAllocated = 0, totalGap = 0;
        let countFullyAllocated = 0, countWithGap = 0;
        const allContributors = new Set<string>();

        for (const occ of knownOccurrences) {
            const coverage = this.allocationCoverage(slot_id, quantity_needed, occ);
            occurrences.set(occ, coverage);

            totalNeeded += coverage.quantity_needed;
            totalAllocated += coverage.quantity_allocated;
            totalGap += Math.max(0, coverage.quantity_gap);

            if (coverage.status === 'fully_allocated') countFullyAllocated++;
            if (coverage.status === 'gap' || coverage.status === 'partial') countWithGap++;

            coverage.contributors.forEach(id => allContributors.add(id));
        }

        return {
            slot_id,
            process_id,
            is_recurring,
            occurrences,
            total_needed: totalNeeded,
            total_allocated: totalAllocated,
            total_gap: totalGap,
            occurrences_count: knownOccurrences.size,
            occurrences_fully_allocated: countFullyAllocated,
            occurrences_with_gap: countWithGap,
            unique_contributors: Array.from(allContributors),
        };
    }

    /**
     * Allocation coverage for expected future occurrences (recurring slots).
     */
    recurringAllocation(
        slot_id: NanoId,
        process_id: NanoId,
        quantity_needed: number,
        expectedOccurrences: string[],
    ): SlotAllocation {
        const allocation = this.slotAllocation(slot_id, process_id, quantity_needed, true);

        for (const occ of expectedOccurrences) {
            if (!allocation.occurrences.has(occ)) {
                const coverage = this.allocationCoverage(slot_id, quantity_needed, occ);
                allocation.occurrences.set(occ, coverage);

                allocation.total_needed += coverage.quantity_needed;
                allocation.total_gap += Math.max(0, coverage.quantity_gap);
                allocation.occurrences_count++;

                if (coverage.status === 'gap') {
                    allocation.occurrences_with_gap++;
                }
            }
        }

        return allocation;
    }

    // =========================================================================
    // MANAGEMENT
    // =========================================================================

    clear() {
        this.commitments.clear();
        this.commitmentsBySlot.clear();
        this.commitmentsByOccurrence.clear();
        this.commitmentsByContributor.clear();
        this.commitmentsByCapacity.clear();
        this.spatialIndex = createHexIndex<Commitment>(9, 4);
    }

    allCommitments(): Commitment[] {
        return Array.from(this.commitments.values());
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
        
        // Add to Spatial Index
        addItemToHexIndex(this.spatialIndex, c, c.id, {
             h3_index: c.h3_index,
             lat: c.latitude,
             lon: c.longitude,
        }, { quantity: c.quantity });
    }

    private addToIndex<K>(index: Map<K, Set<NanoId>>, key: K, id: NanoId) {
        const set = index.get(key) ?? new Set();
        set.add(id);
        index.set(key, set);
    }

    private getFromIndex<K>(index: Map<K, Set<NanoId>>, key: K): Commitment[] {
        const ids = index.get(key);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => this.commitments.get(id))
            .filter((v): v is Commitment => v !== undefined);
    }
}

// =============================================================================
// DEFAULT INSTANCE
// =============================================================================

export const allocations = new Allocations();
