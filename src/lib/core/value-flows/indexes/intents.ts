import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { getSpaceTimeSignature, intentToSpaceTimeContext, toDateKey, wrapDate } from '../utils/space-time-keys';
import { spatialThingToH3 } from '../utils/space';
import type { Intent, SpatialThing } from '../schemas';

export interface IntentIndex {
    intents:           Map<string, Intent>;
    spec_index:        Map<string, Set<string>>;   // resourceConformsTo → ids
    action_index:      Map<string, Set<string>>;   // VfAction → ids
    agent_index:       Map<string, Set<string>>;   // provider|receiver Agent ID → ids
    plan_index:        Map<string, Set<string>>;   // plannedWithin Plan ID → ids
    space_time_index:  Map<string, Set<string>>;   // spaceTimeSig → ids
    spatial_hierarchy: HexIndex<Intent>;
}

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

export function buildIntentIndex(
    intents: Intent[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): IntentIndex {
    const index: IntentIndex = {
        intents: new Map(),
        spec_index: new Map(),
        action_index: new Map(),
        agent_index: new Map(),
        plan_index: new Map(),
        space_time_index: new Map(),
        spatial_hierarchy: createHexIndex<Intent>(),
    };

    for (const intent of intents) {
        index.intents.set(intent.id, intent);

        addTo(index.spec_index, intent.resourceConformsTo, intent.id);
        addTo(index.action_index, intent.action, intent.id);
        addTo(index.agent_index, intent.provider, intent.id);
        addTo(index.agent_index, intent.receiver, intent.id);
        addTo(index.plan_index, intent.plannedWithin, intent.id);

        const st = intent.atLocation ? locations.get(intent.atLocation) : undefined;
        const ctx = intentToSpaceTimeContext(intent, st, h3Resolution);
        const sig = getSpaceTimeSignature(ctx, h3Resolution);
        addTo(index.space_time_index, sig, intent.id);

        if (st) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                intent,
                intent.id,
                { lat: st.lat, lon: st.long, h3_index: spatialThingToH3(st, h3Resolution) },
                {
                    quantity: intent.resourceQuantity?.hasNumericalValue,
                    hours: intent.effortQuantity?.hasNumericalValue,
                },
                intent.availability_window                           // TemporalExpression when present
                    ?? wrapDate(toDateKey(intent.hasBeginning ?? intent.hasPointInTime)),
            );
        }
    }

    return index;
}

export function queryIntentsBySpec(index: IntentIndex, specId: string): Intent[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.intents.get(id)!).filter(Boolean);
}

export function queryIntentsByAction(index: IntentIndex, action: string): Intent[] {
    const ids = index.action_index.get(action) ?? new Set<string>();
    return [...ids].map(id => index.intents.get(id)!).filter(Boolean);
}

export function queryIntentsByAgent(index: IntentIndex, agentId: string): Intent[] {
    const ids = index.agent_index.get(agentId) ?? new Set<string>();
    return [...ids].map(id => index.intents.get(id)!).filter(Boolean);
}

export function queryIntentsByPlan(index: IntentIndex, planId: string): Intent[] {
    const ids = index.plan_index.get(planId) ?? new Set<string>();
    return [...ids].map(id => index.intents.get(id)!).filter(Boolean);
}

export function queryIntentsByLocation(
    index: IntentIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): Intent[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.intents.get(id)!).filter(Boolean);
}

export function queryIntentsBySpecAndLocation(
    index: IntentIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): Intent[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.intents.get(id)!)
        .filter(Boolean);
}

export function queryIntentsByHex(index: IntentIndex, cell: string): HexNode<Intent> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}
