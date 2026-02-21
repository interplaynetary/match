import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { spatialThingToH3 } from '../utils/space';
import { getSpaceTimeSignature, toDateKey, wrapDate } from '../utils/space-time-keys';
import type { Proposal, SpatialThing } from '../schemas';

export interface ProposalIndex {
    proposals:         Map<string, Proposal>;
    purpose_index:     Map<string, Set<string>>;   // 'offer'|'request' → ids
    scope_index:       Map<string, Set<string>>;   // inScopeOf Agent ID → ids
    space_time_index:  Map<string, Set<string>>;   // spaceTimeSig → ids
    spatial_hierarchy: HexIndex<Proposal>;
}

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

export function buildProposalIndex(
    proposals: Proposal[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): ProposalIndex {
    const index: ProposalIndex = {
        proposals: new Map(),
        purpose_index: new Map(),
        scope_index: new Map(),
        space_time_index: new Map(),
        spatial_hierarchy: createHexIndex<Proposal>(),
    };

    for (const proposal of proposals) {
        index.proposals.set(proposal.id, proposal);

        addTo(index.purpose_index, proposal.purpose, proposal.id);

        for (const agentId of proposal.inScopeOf ?? []) {
            addTo(index.scope_index, agentId, proposal.id);
        }

        const st = proposal.eligibleLocation ? locations.get(proposal.eligibleLocation) : undefined;

        const h3Cell = st ? spatialThingToH3(st, h3Resolution) : undefined;
        const sig = getSpaceTimeSignature({
            h3_index: h3Cell,
            latitude: st?.lat,
            longitude: st?.long,
            start_date: proposal.hasBeginning ?? null,
            end_date: proposal.hasEnd ?? null,
        }, h3Resolution);
        addTo(index.space_time_index, sig, proposal.id);

        if (st) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                proposal,
                proposal.id,
                { lat: st.lat, lon: st.long, h3_index: h3Cell },
                { quantity: 0, hours: 0 },
                wrapDate(toDateKey(proposal.hasBeginning)),
            );
        }
    }

    return index;
}

export function queryProposalsByPurpose(index: ProposalIndex, purpose: 'offer' | 'request'): Proposal[] {
    const ids = index.purpose_index.get(purpose) ?? new Set<string>();
    return [...ids].map(id => index.proposals.get(id)!).filter(Boolean);
}

export function queryProposalsByScope(index: ProposalIndex, agentId: string): Proposal[] {
    const ids = index.scope_index.get(agentId) ?? new Set<string>();
    return [...ids].map(id => index.proposals.get(id)!).filter(Boolean);
}

export function queryProposalsByLocation(
    index: ProposalIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): Proposal[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.proposals.get(id)!).filter(Boolean);
}

export function queryProposalsByHex(index: ProposalIndex, cell: string): HexNode<Proposal> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}
