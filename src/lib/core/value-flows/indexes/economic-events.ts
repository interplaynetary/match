import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { getSpaceTimeSignature, economicEventToSpaceTimeContext, toDateKey, wrapDate } from '../utils/space-time-keys';
import { spatialThingToH3 } from '../utils/space';
import type { EconomicEvent, SpatialThing } from '../schemas';

export interface EconomicEventIndex {
    events:                Map<string, EconomicEvent>;
    spec_index:            Map<string, Set<string>>;   // resourceConformsTo → ids
    action_index:          Map<string, Set<string>>;   // VfAction → ids
    agent_index:           Map<string, Set<string>>;   // provider|receiver → ids
    resource_index:        Map<string, Set<string>>;   // resourceInventoriedAs|toResourceInventoriedAs → ids
    process_index:         Map<string, Set<string>>;   // inputOf|outputOf → ids
    space_time_index:      Map<string, Set<string>>;   // spaceTimeSig (by atLocation) → ids
    origin_hierarchy:      HexIndex<EconomicEvent>;    // indexed by atLocation
    destination_hierarchy: HexIndex<EconomicEvent>;    // indexed by toLocation
}

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

export function buildEconomicEventIndex(
    events: EconomicEvent[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): EconomicEventIndex {
    const index: EconomicEventIndex = {
        events: new Map(),
        spec_index: new Map(),
        action_index: new Map(),
        agent_index: new Map(),
        resource_index: new Map(),
        process_index: new Map(),
        space_time_index: new Map(),
        origin_hierarchy: createHexIndex<EconomicEvent>(),
        destination_hierarchy: createHexIndex<EconomicEvent>(),
    };

    for (const event of events) {
        index.events.set(event.id, event);

        addTo(index.spec_index, event.resourceConformsTo, event.id);
        addTo(index.action_index, event.action, event.id);
        addTo(index.agent_index, event.provider, event.id);
        addTo(index.agent_index, event.receiver, event.id);
        addTo(index.resource_index, event.resourceInventoriedAs, event.id);
        addTo(index.resource_index, event.toResourceInventoriedAs, event.id);
        addTo(index.process_index, event.inputOf, event.id);
        addTo(index.process_index, event.outputOf, event.id);

        // Origin (atLocation) — space-time signature + origin hierarchy
        const originSt = event.atLocation ? locations.get(event.atLocation) : undefined;
        const ctx = economicEventToSpaceTimeContext(event, originSt, h3Resolution);
        const sig = getSpaceTimeSignature(ctx, h3Resolution);
        addTo(index.space_time_index, sig, event.id);

        const eventDateKey = toDateKey(event.hasPointInTime ?? event.hasBeginning ?? event.created);

        if (originSt) {
            addItemToHexIndex(
                index.origin_hierarchy,
                event,
                event.id,
                { lat: originSt.lat, lon: originSt.long, h3_index: spatialThingToH3(originSt, h3Resolution) },
                {
                    quantity: event.resourceQuantity?.hasNumericalValue,
                    hours: event.effortQuantity?.hasNumericalValue,
                },
                wrapDate(eventDateKey), // EconomicEvents are immutable facts — always point-in-time
            );
        }

        // Destination (toLocation) — destination hierarchy only
        const destSt = event.toLocation ? locations.get(event.toLocation) : undefined;
        if (destSt) {
            addItemToHexIndex(
                index.destination_hierarchy,
                event,
                event.id,
                { lat: destSt.lat, lon: destSt.long, h3_index: spatialThingToH3(destSt, h3Resolution) },
                {
                    quantity: event.resourceQuantity?.hasNumericalValue,
                    hours: event.effortQuantity?.hasNumericalValue,
                },
                wrapDate(eventDateKey),
            );
        }
    }

    return index;
}

export function queryEventsBySpec(index: EconomicEventIndex, specId: string): EconomicEvent[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByAction(index: EconomicEventIndex, action: string): EconomicEvent[] {
    const ids = index.action_index.get(action) ?? new Set<string>();
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByAgent(index: EconomicEventIndex, agentId: string): EconomicEvent[] {
    const ids = index.agent_index.get(agentId) ?? new Set<string>();
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByResource(index: EconomicEventIndex, resourceId: string): EconomicEvent[] {
    const ids = index.resource_index.get(resourceId) ?? new Set<string>();
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByProcess(index: EconomicEventIndex, processId: string): EconomicEvent[] {
    const ids = index.process_index.get(processId) ?? new Set<string>();
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByOrigin(
    index: EconomicEventIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): EconomicEvent[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.origin_hierarchy, query);
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByDestination(
    index: EconomicEventIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): EconomicEvent[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.destination_hierarchy, query);
    return [...ids].map(id => index.events.get(id)!).filter(Boolean);
}

export function queryEventsByOriginAndSpec(
    index: EconomicEventIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): EconomicEvent[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.origin_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.events.get(id)!)
        .filter(Boolean);
}

export function queryEventsByHex(index: EconomicEventIndex, cell: string): HexNode<EconomicEvent> | null {
    return index.origin_hierarchy.nodes.get(cell) ?? null;
}
