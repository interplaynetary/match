import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { spatialThingToH3 } from '../utils/space';
import type { EconomicResource, SpatialThing } from '../schemas';

export interface EconomicResourceIndex {
    resources:         Map<string, EconomicResource>;
    spec_index:        Map<string, Set<string>>;   // conformsTo → ids
    accountable_index: Map<string, Set<string>>;   // primaryAccountable Agent ID → ids
    stage_index:       Map<string, Set<string>>;   // stage ProcessSpec ID → ids
    location_index:    Map<string, Set<string>>;   // currentLocation SpatialThing ID → ids
    spatial_hierarchy: HexIndex<EconomicResource>;
}

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

export function buildEconomicResourceIndex(
    resources: EconomicResource[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): EconomicResourceIndex {
    const index: EconomicResourceIndex = {
        resources: new Map(),
        spec_index: new Map(),
        accountable_index: new Map(),
        stage_index: new Map(),
        location_index: new Map(),
        spatial_hierarchy: createHexIndex<EconomicResource>(),
    };

    for (const resource of resources) {
        index.resources.set(resource.id, resource);

        addTo(index.spec_index, resource.conformsTo, resource.id);
        addTo(index.accountable_index, resource.primaryAccountable, resource.id);
        addTo(index.stage_index, resource.stage, resource.id);
        addTo(index.location_index, resource.currentLocation, resource.id);

        const st = resource.currentLocation ? locations.get(resource.currentLocation) : undefined;
        if (st) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                resource,
                resource.id,
                { lat: st.lat, lon: st.long, h3_index: spatialThingToH3(st, h3Resolution) },
                {
                    quantity: resource.onhandQuantity?.hasNumericalValue,
                    hours: 0,
                },
            );
        }
    }

    return index;
}

export function queryResourcesBySpec(index: EconomicResourceIndex, specId: string): EconomicResource[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.resources.get(id)!).filter(Boolean);
}

export function queryResourcesByAccountable(index: EconomicResourceIndex, agentId: string): EconomicResource[] {
    const ids = index.accountable_index.get(agentId) ?? new Set<string>();
    return [...ids].map(id => index.resources.get(id)!).filter(Boolean);
}

export function queryResourcesByStage(index: EconomicResourceIndex, processSpecId: string): EconomicResource[] {
    const ids = index.stage_index.get(processSpecId) ?? new Set<string>();
    return [...ids].map(id => index.resources.get(id)!).filter(Boolean);
}

export function queryResourcesByLocation(index: EconomicResourceIndex, locationId: string): EconomicResource[] {
    const ids = index.location_index.get(locationId) ?? new Set<string>();
    return [...ids].map(id => index.resources.get(id)!).filter(Boolean);
}

export function queryResourcesBySpecAndLocation(
    index: EconomicResourceIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): EconomicResource[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.resources.get(id)!)
        .filter(Boolean);
}

export function queryResourcesByHex(index: EconomicResourceIndex, cell: string): HexNode<EconomicResource> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}
