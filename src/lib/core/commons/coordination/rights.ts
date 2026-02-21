/**
 * Use-Rights (⭐) System
 * 
 * Implements PLAN.md use-rights with responsibilities.
 * Rights specify who can hold them, what they can/must/cannot do,
 * and what responsibilities come with holding the right.
 */

import { z } from "zod";
import { AvailabilityWindowSchema } from "../primitives/time";

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

/**
 * Permissions: What holders can, must, and cannot do.
 */
export const PermissionsSchema = z.object({
    can: z.array(z.string()).default([]),
    must: z.array(z.string()).default([]),
    cannot: z.array(z.string()).default([]),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * Responsibility: Obligation that comes with holding a right.
 */
export const ResponsibilitySchema = z.object({
    action: z.string(),
    trigger: z.string(),
    penalty: z.string().optional(),
    condition: z.any().optional(),
});

export type Responsibility = z.infer<typeof ResponsibilitySchema>;

/**
 * Constraints: When/where/how much a right can be exercised.
 */
export const ConstraintsSchema = z.object({
    /** When: Time-based constraints */
    temporal: AvailabilityWindowSchema.optional(),
    
    /** Where: Space-based constraints */
    spatial: z.object({
        city: z.string().optional(),
        country: z.string().optional(),
        h3_index: z.string().optional(),
        max_distance_km: z.number().optional(),
    }).optional(),
    
    /** How much: Quantity-based constraints */
    quantitative: z.object({
        max_per_use: z.number().optional(),
        max_per_day: z.number().optional(),
        max_per_week: z.number().optional(),
    }).optional(),
}).optional();

export type Constraints = z.infer<typeof ConstraintsSchema>;

/**
 * TimeSlot: Start and end time for allocations.
 */
export const TimeSlotSchema = z.object({
    start: z.date(),
    end: z.date(),
});

export type TimeSlot = z.infer<typeof TimeSlotSchema>;

/**
 * AllocationEntry: Single holder-right grant.
 */
export const AllocationEntrySchema = z.object({
    holder_id: z.string(),
    holder_type: z.enum(['person', 'process']),
    right_id: z.string(),
    granted_by: z.string(),
    granted_at: z.date(),
    conditions: z.any().optional(),
});

export type AllocationEntry = z.infer<typeof AllocationEntrySchema>;

// =============================================================================
// USE-RIGHT SCHEMA
// =============================================================================

/**
 * UseRight: Specifies permissions and responsibilities for using a resource.
 * 
 * From PLAN.md:
 * - Specify who can hold ⭐
 * - Specify what 👤/🟢 can do with 🟦
 * - Specify what 👤/🟢 must do: with 🟦, or when it uses 🟦
 */
export const UseRightSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    
    // ===== Inheritance =====
    extends_template_id: z.string().optional(),
    
    // ===== Who Can Hold =====
    /**
     * Constraints on who can hold this right (JSON Logic).
     * 
     * Examples:
     * - { ">=": [{ "var": "labor_vouchers" }, 10] }
     * - { "in": [{ "var": "person_id" }, ["alice", "bob"]] }
     */
    holder_constraints: z.any(),
    
    // ===== What They Can/Must/Cannot Do =====
    permissions: PermissionsSchema,
    responsibilities: z.array(ResponsibilitySchema).default([]),
    
    // ===== When/Where/How Much =====
    constraints: ConstraintsSchema,
    
    // ===== Governance =====
    grantor_id: z.string(),
    revocable: z.boolean().default(true),
    priority: z.number().int().nonnegative().optional(),
});

export type UseRight = z.infer<typeof UseRightSchema>;

// =============================================================================
// RIGHTS CATALOG
// =============================================================================

/**
 * RightsCombination: A valid set of rights that can coexist.
 */
export const RightsCombinationSchema = z.object({
    combination_id: z.string(),
    right_ids: z.array(z.string()),
    compatible: z.boolean(),
    reason: z.string().optional(),
    constraints: z.any().optional(),
});

export type RightsCombination = z.infer<typeof RightsCombinationSchema>;

/**
 * RightsCatalog: All available rights and valid combinations for a resource.
 */
export const RightsCatalogSchema = z.object({
    resource_id: z.string(),
    available_rights: z.array(UseRightSchema),
    valid_combinations: z.array(RightsCombinationSchema),
    default_combination_id: z.string().optional(),
});

export type RightsCatalog = z.infer<typeof RightsCatalogSchema>;

// =============================================================================
// RIGHTS ALLOCATION
// =============================================================================

/**
 * RightsAllocation: Who holds what rights in a specific time slot.
 * 
 * From PLAN.md: "Time → { 🟢⭐1, 👤⭐2, 🟢⭐3 }"
 */
export const RightsAllocationSchema = z.object({
    id: z.string(),
    resource_id: z.string(),
    time_slot: TimeSlotSchema,
    allocations: z.array(AllocationEntrySchema),
    valid_combination: z.boolean(),
    combination_id: z.string().optional(),
});

export type RightsAllocation = z.infer<typeof RightsAllocationSchema>;

/**
 * RightsTimeline: Complete timeline of rights allocations for a resource.
 */
export const RightsTimelineSchema = z.object({
    resource_id: z.string(),
    allocations: z.array(RightsAllocationSchema),
    last_updated: z.date(),
});

export type RightsTimeline = z.infer<typeof RightsTimelineSchema>;

// =============================================================================
// RIGHTS TEMPLATES (for ProductType)
// =============================================================================

/**
 * RightsTemplate: Reusable rights template for ProductType.
 * 
 * ResourceInstance rights can inherit from these via extends_template_id.
 */
export const RightsTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    holder_constraints: z.any(),
    permissions: PermissionsSchema,
    responsibilities: z.array(ResponsibilitySchema).default([]),
});

export type RightsTemplate = z.infer<typeof RightsTemplateSchema>;