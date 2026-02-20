/**
 * Need Abstraction and Indexing
 * 
 * Represents a specific requirement for a resource or service in a
 * specific space-time context.
 */

import { z } from 'zod';
import { AvailabilityWindowSchema } from './time';
import { getSpaceTimeSignature, getTimeSignature } from './matching';
import { createHexIndex, addItemToHexIndex, queryHexIndex, type HexIndex, type HexNode } from './hex';

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Need: A requirement for a resource/service.
 * Mapped to Resource schema where possible for compatibility.
 */
export const Need = z.object({
    id: z.string(),
    
    /** What is needed (ProductType ID) */
    type_id: z.string(),
    
    /** Quantity needed */
    quantity: z.number().positive(),
    
    /** Unit of measurement */
    unit: z.string().optional(),
    
    /** Description of the need */
    description: z.string().optional(),
    
    /** Priority (0-1, 1 is highest) */
    priority: z.number().min(0).max(1).default(0.5),
    
    /** Who needs it */
    requester_id: z.string().optional(),
    
    // ===== Constraints (Mirror Resource constraints) =====
    
    /** When is it needed */
    availability_window: AvailabilityWindowSchema.optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    
    /** Where is it needed */
    location_type: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    h3_index: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    max_distance_km: z.number().optional(),
});

export type Need = z.infer<typeof Need>;

/**
 * NeedIndex: Container for needs with efficient lookups.
 * 
 * Structure:
 * - needs: Map<NeedId, Need> - Source of truth
 * - type_index: Map<TypeId, Set<NeedId>> - Quick lookup by type
 * - space_time_index: Map<Signature, Set<NeedId>> - Spatial/temporal lookup
 */
export interface NeedIndex {
    /** All needs indexed by ID */
    needs: Map<string, Need>;
    
    /** Index by type_id (product type) */
    type_index: Map<string, Set<string>>;
    
    /** Index by space-time signature */
    space_time_index: Map<string, Set<string>>;

    /** Hierarchical Spatial Index (H3) */
    spatial_hierarchy: HexIndex<Need>;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get space-time signature for a need.
 */
export function getNeedSpaceTimeSignature(need: Need): string {
    // Need matches Resource structure enough for getSpaceTimeSignature
    return getSpaceTimeSignature(need as any);
}

/**
 * Build need index from a list of needs.
 */
export function buildNeedIndex(needs: Need[]): NeedIndex {
    const needMap = new Map<string, Need>();
    const typeIndex = new Map<string, Set<string>>();
    const spaceTimeIndex = new Map<string, Set<string>>();
    const spatialHierarchy = createHexIndex<Need>(9, 0);
    
    for (const need of needs) {
        // Store need
        needMap.set(need.id, need);
        
        // Index by type
        if (!typeIndex.has(need.type_id)) {
            typeIndex.set(need.type_id, new Set());
        }
        typeIndex.get(need.type_id)!.add(need.id);
        
        // Index by space-time
        const signature = getNeedSpaceTimeSignature(need);
        if (!spaceTimeIndex.has(signature)) {
            spaceTimeIndex.set(signature, new Set());
        }
        spaceTimeIndex.get(signature)!.add(need.id);

        // Populate Hex Index
        addItemToHexIndex(
            spatialHierarchy,
            need,
            need.id,
            {
                lat: need.latitude,
                lon: need.longitude,
                h3_index: need.h3_index
            },
            { quantity: need.quantity },
            need.availability_window
        );
    }
    
    return {
        needs: needMap,
        type_index: typeIndex,
        space_time_index: spaceTimeIndex,
        spatial_hierarchy: spatialHierarchy,
    };
}

/**
 * Query needs by type.
 */
export function queryNeedsByType(
    index: NeedIndex,
    typeId: string
): Need[] {
    const ids = index.type_index.get(typeId);
    if (!ids) return [];
    
    return Array.from(ids)
        .map(id => index.needs.get(id))
        .filter((n): n is Need => n !== undefined);
}

/**
 * Query needs by location.
 */
export function queryNeedsByLocation(
    index: NeedIndex,
    location: { city?: string; country?: string; h3_index?: string }
): Need[] {
    const results: Need[] = [];
    
    for (const need of index.needs.values()) {
        if (location.city && need.city !== location.city) continue;
        if (location.country && need.country !== location.country) continue;
        if (location.h3_index && need.h3_index !== location.h3_index) continue;
        results.push(need);
    }
    
    return results;
}

/**
 * Query needs by H3 cell (hierarchical).
 */
export function queryNeedsByHex(
    index: NeedIndex,
    cell: string
): HexNode<Need> | null {
    return queryHexIndex(index.spatial_hierarchy, cell);
}

/**
 * Query needs by type AND location.
 */
export function queryNeedsByTypeAndLocation(
    index: NeedIndex,
    typeId: string,
    location: { city?: string; country?: string; h3_index?: string }
): Need[] {
    const typeNeeds = queryNeedsByType(index, typeId);
    
    return typeNeeds.filter(need => {
        if (location.city && need.city !== location.city) return false;
        if (location.country && need.country !== location.country) return false;
        if (location.h3_index && need.h3_index !== location.h3_index) return false;
        return true;
    });
}
