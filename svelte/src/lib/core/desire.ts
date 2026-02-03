import * as z from 'zod';
import {
    BlockReason,
    RiskFactor,
    Breakdown,
    DIMENSIONS,
    type Dimension
} from './commons';

// Re-export for convenience
export { BlockReason, RiskFactor, DIMENSIONS };
export type { Dimension };

// ═══════════════════════════════════════════════════════════════════
// FEASIBILITY (The "Possible")
// ═══════════════════════════════════════════════════════════════════

/**
 * Simple numeric scores for each feasibility dimension.
 * Use this for quick checks; use FeasibilityBreakdown for detailed analysis.
 */
export const FeasibilityScoresSchema = z.object({
    time: z.number().min(0).max(1).default(1),
    location: z.number().min(0).max(1).default(1),
    skills: z.number().min(0).max(1).default(1),
    travel: z.number().min(0).max(1).default(1),
    resources: z.number().min(0).max(1).default(1),
    affinity: z.number().min(0).max(1).default(1),
    continuity: z.number().min(0).max(1).default(1)
});

export type FeasibilityScores = z.infer<typeof FeasibilityScoresSchema>;

/** Default scores (all 1.0) */
const defaultScores = (): FeasibilityScores => ({
    time: 1, location: 1, skills: 1, travel: 1, resources: 1, affinity: 1, continuity: 1
});

/**
 * Feasibility status - discriminated union of possible/impossible.
 * Optionally includes detailed breakdown for debugging/UI.
 */
export const FeasibilityStatusSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('possible'),
        /** Aggregated confidence (0-1), product of all dimension scores */
        confidence: z.number().min(0).max(1).default(1.0),
        /** Risk factors if confidence < 1.0 */
        risk_factors: z.array(RiskFactor).optional(),
        /** Simple dimension scores */
        scores: FeasibilityScoresSchema.default(defaultScores),
        /** Optional detailed breakdown (for debugging/UI) */
        breakdown: Breakdown.optional()
    }),
    z.object({
        type: z.literal('impossible'),
        /** Why is it impossible */
        reasons: z.array(BlockReason),
        /** Dimension scores (blocking dimensions will be 0) */
        scores: FeasibilityScoresSchema.default(defaultScores),
        /** Optional detailed breakdown */
        breakdown: Breakdown.optional()
    })
]);

export type FeasibilityStatus = z.infer<typeof FeasibilityStatusSchema>;


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
