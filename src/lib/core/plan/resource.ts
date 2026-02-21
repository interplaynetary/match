/**
 * Resource Indexing
 * 
 * Provides efficient spatial and temporal indexing for Resources,
 * mirroring the LaborIndex pattern.
 */

import { z } from 'zod';
import { Resource } from './process';
import { getSpaceTimeSignature, getTimeSignature } from './space-time-keys';
import { createHexIndex, addItemToHexIndex, queryHexIndex, queryHexIndexRadius, type HexIndex, type HexNode } from './space-time-index';

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * ResourceIndex: Container for resources with efficient lookups.
 * 
 * Structure:
 * - resources: Map<ResourceId, Resource> - Source of truth
 * - type_index: Map<TypeId, Set<ResourceId>> - Quick lookup by type
 * - space_time_index: Map<Signature, Set<ResourceId>> - Spatial/temporal lookup
 */
export interface ResourceIndex {
    /** All resources indexed by ID */
    resources: Map<string, z.infer<typeof Resource>>;
    
    /** Index by type_id (product type) */
    type_index: Map<string, Set<string>>;
    
    /** Index by space-time signature */
    space_time_index: Map<string, Set<string>>;

    /** Hierarchical Spatial Index (H3) */
    spatial_hierarchy: HexIndex<z.infer<typeof Resource>>;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get space-time signature for a resource.
 */
export function getResourceSpaceTimeSignature(
    resource: z.infer<typeof Resource>
): string {
    return getSpaceTimeSignature(resource);
}

/**
 * Build resource index from a list of resources.
 */
export function buildResourceIndex(
    resources: z.infer<typeof Resource>[]
): ResourceIndex {
    const resourceMap = new Map<string, z.infer<typeof Resource>>();
    const typeIndex = new Map<string, Set<string>>();
    const spaceTimeIndex = new Map<string, Set<string>>();
    const spatialHierarchy = createHexIndex<z.infer<typeof Resource>>(9, 0);
    
    for (const resource of resources) {
        // Store resource
        resourceMap.set(resource.id, resource);
        
        // Index by type
        if (!typeIndex.has(resource.type_id)) {
            typeIndex.set(resource.type_id, new Set());
        }
        typeIndex.get(resource.type_id)!.add(resource.id);
        
        // Index by space-time
        const signature = getResourceSpaceTimeSignature(resource);
        if (!spaceTimeIndex.has(signature)) {
            spaceTimeIndex.set(signature, new Set());
        }
        spaceTimeIndex.get(signature)!.add(resource.id);

        // Populate Hex Index
        addItemToHexIndex(
            spatialHierarchy,
            resource,
            resource.id,
            {
                lat: resource.latitude,
                lon: resource.longitude,
                h3_index: resource.h3_index
            },
            { quantity: resource.quantity },
            resource.availability_window // Pass full window
        );
    }
    
    return {
        resources: resourceMap,
        type_index: typeIndex,
        space_time_index: spaceTimeIndex,
        spatial_hierarchy: spatialHierarchy,
    };
}

/**
 * Query resources by type.
 */
export function queryResourcesByType(
    index: ResourceIndex,
    typeId: string
): z.infer<typeof Resource>[] {
    const ids = index.type_index.get(typeId);
    if (!ids) return [];
    
    return Array.from(ids)
        .map(id => index.resources.get(id))
        .filter((r): r is z.infer<typeof Resource> => r !== undefined);
}

/**
 * Query resources by location.
 * Fast path: uses HexIndex when lat/lon or h3_index is provided.
 * Slow path: falls back to city/country string filter.
 */
export function queryResourcesByLocation(
    index: ResourceIndex,
    location: { city?: string; country?: string; h3_index?: string; latitude?: number; longitude?: number; radius_km?: number }
): z.infer<typeof Resource>[] {
    // Fast path: spatial query via HexIndex
    if (location.h3_index || (location.latitude !== undefined && location.longitude !== undefined)) {
        const matchingIds = queryHexIndexRadius(index.spatial_hierarchy, {
            h3_index: location.h3_index,
            latitude: location.latitude,
            longitude: location.longitude,
            radius_km: location.radius_km,
        });
        return Array.from(matchingIds)
            .map(id => index.resources.get(id))
            .filter((r): r is z.infer<typeof Resource> => r !== undefined);
    }

    // Slow path: city/country string filter
    const results: z.infer<typeof Resource>[] = [];
    for (const resource of index.resources.values()) {
        if (location.city && resource.city !== location.city) continue;
        if (location.country && resource.country !== location.country) continue;
        results.push(resource);
    }
    return results;
}

/**
 * Query resources by H3 cell (hierarchical).
 */
export function queryResourcesByHex(
    index: ResourceIndex,
    cell: string
): HexNode<z.infer<typeof Resource>> | null {
    return queryHexIndex(index.spatial_hierarchy, cell);
}

/**
 * Query resources by type AND location.
 * Uses HexIndex fast path when spatial params are present.
 */
export function queryResourcesByTypeAndLocation(
    index: ResourceIndex,
    typeId: string,
    location: { city?: string; country?: string; h3_index?: string; latitude?: number; longitude?: number; radius_km?: number }
): z.infer<typeof Resource>[] {
    const typeIds = index.type_index.get(typeId);
    if (!typeIds) return [];

    // Fast path: spatial query via HexIndex, then intersect with type set
    if (location.h3_index || (location.latitude !== undefined && location.longitude !== undefined)) {
        const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, {
            h3_index: location.h3_index,
            latitude: location.latitude,
            longitude: location.longitude,
            radius_km: location.radius_km,
        });
        const results: z.infer<typeof Resource>[] = [];
        for (const id of spatialIds) {
            if (typeIds.has(id)) {
                const resource = index.resources.get(id);
                if (resource) results.push(resource);
            }
        }
        return results;
    }

    // Slow path: type filter then city/country string filter
    return Array.from(typeIds)
        .map(id => index.resources.get(id))
        .filter((r): r is z.infer<typeof Resource> => {
            if (!r) return false;
            if (location.city && r.city !== location.city) return false;
            if (location.country && r.country !== location.country) return false;
            return true;
        });
}
