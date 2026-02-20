import * as z from 'zod';
import {
    BlockReason,
    RiskFactor,
    Breakdown,
    DIMENSIONS,
    type Dimension
} from './process';
import { FeasibilityStatusSchema } from './feasibility';
// Re-export for convenience
export { BlockReason, RiskFactor, DIMENSIONS };
export type { Dimension };


// ═══════════════════════════════════════════════════════════════════
// DESIRE (The "Actual" / "Wanted")
// ═══════════════════════════════════════════════════════════════════

/**
 * Represents an agent's expression of intent toward a specific match.
 * Used for both Provider (offering) and Seeker (requesting).
 */
export const DesireSchema = z.object({
    /**
     * How much quantity does this agent want to contribute/consume
     * in this specific relationship?
     */
    quantity: z.number().nonnegative(),

    /**
     * Is this a "hard" commitment?
     * If true, the agent considers this effectively "booked" or "promised".
     * If false, it acts as a "soft" preference or tentative allocation.
     */
    locked: z.boolean().default(false),

    /**
     * Relative priority/importance of this specific desire.
     * Useful for tie-breaking or sorting.
     */
    priority: z.number().optional(),

    /**
     * Timestamp of when this desire was last expressed/updated.
     */
    updated_at: z.number().optional()
});

export type Desire = z.infer<typeof DesireSchema>;


// ═══════════════════════════════════════════════════════════════════
// SLOT RELATIONSHIP (The Matrix)
// ═══════════════════════════════════════════════════════════════════

/**
 * The core edge type representing the state between a Capacity Slot and a Need Slot.
 * Captures the 4-quadrant state:
 * 1. Suggestion (Feasible, No Desire)
 * 2. Pruned (Infeasible, No Desire)
 * 3. Valid (Feasible, Mutual Desire)
 * 4. Contradiction (Infeasible, Mutual Desire)
 */
export const SlotRelationshipSchema = z.object({
    // Identity
    id: z.string(), // Unique ID for this relationship edge (e.g. hash of slot IDs)
    capacity_id: z.string(),
    need_id: z.string(),

    // The Matrix of State
    feasibility: FeasibilityStatusSchema,

    // Two-sided Desire
    provider_desire: DesireSchema.optional(), // Computed from Provider agent
    seeker_desire: DesireSchema.optional(),   // Computed from Seeker agent

    // Derived State (Convenience)
    /**
     * The effective quantity agreed upon (usually min(provider, seeker)).
     * Only meaningful if both are present.
     */
    mutual_desire_quantity: z.number().default(0),

    /**
     * High-level classification of this relationship.
     * Derived from Feasibility and Desire presence.
     */
    status: z.enum(['suggestion', 'pruned', 'valid', 'contradiction'])
});

export type SlotRelationship = z.infer<typeof SlotRelationshipSchema>;
