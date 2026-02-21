import {
    createHexIndex, addItemToHexIndex, queryHexIndexRadius,
    type HexIndex, type HexNode,
} from '../utils/space-time-index';
import { getSpaceTimeSignature, commitmentToSpaceTimeContext, toDateKey, wrapDate } from '../utils/space-time-keys';
import { spatialThingToH3 } from '../utils/space';
import type { Commitment, SpatialThing } from '../schemas';

export interface CommitmentIndex {
    commitments:       Map<string, Commitment>;
    spec_index:        Map<string, Set<string>>;   // resourceConformsTo → ids
    action_index:      Map<string, Set<string>>;   // VfAction → ids
    agent_index:       Map<string, Set<string>>;   // provider|receiver → ids
    plan_index:        Map<string, Set<string>>;   // plannedWithin → ids
    process_index:     Map<string, Set<string>>;   // inputOf|outputOf Process ID → ids
    satisfies_index:   Map<string, Set<string>>;   // Intent ID → Commitment IDs (per-occurrence tracking)
    space_time_index:  Map<string, Set<string>>;   // spaceTimeSig → ids
    spatial_hierarchy: HexIndex<Commitment>;
}

function addTo(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
}

export function buildCommitmentIndex(
    commitments: Commitment[],
    locations: Map<string, SpatialThing>,
    h3Resolution: number = 7,
): CommitmentIndex {
    const index: CommitmentIndex = {
        commitments: new Map(),
        spec_index: new Map(),
        action_index: new Map(),
        agent_index: new Map(),
        plan_index: new Map(),
        process_index: new Map(),
        satisfies_index: new Map(),
        space_time_index: new Map(),
        spatial_hierarchy: createHexIndex<Commitment>(),
    };

    for (const commitment of commitments) {
        index.commitments.set(commitment.id, commitment);

        addTo(index.spec_index, commitment.resourceConformsTo, commitment.id);
        addTo(index.action_index, commitment.action, commitment.id);
        addTo(index.agent_index, commitment.provider, commitment.id);
        addTo(index.agent_index, commitment.receiver, commitment.id);
        addTo(index.plan_index, commitment.plannedWithin, commitment.id);
        addTo(index.process_index, commitment.inputOf, commitment.id);
        addTo(index.process_index, commitment.outputOf, commitment.id);
        addTo(index.satisfies_index, commitment.satisfies, commitment.id);

        const st = commitment.atLocation ? locations.get(commitment.atLocation) : undefined;
        const ctx = commitmentToSpaceTimeContext(commitment, st, h3Resolution);
        const sig = getSpaceTimeSignature(ctx, h3Resolution);
        addTo(index.space_time_index, sig, commitment.id);

        if (st) {
            addItemToHexIndex(
                index.spatial_hierarchy,
                commitment,
                commitment.id,
                { lat: st.lat, lon: st.long, h3_index: spatialThingToH3(st, h3Resolution) },
                {
                    quantity: commitment.resourceQuantity?.hasNumericalValue,
                    hours: commitment.effortQuantity?.hasNumericalValue,
                },
                commitment.availability_window                        // TemporalExpression when present
                    ?? wrapDate(toDateKey(commitment.hasBeginning ?? commitment.hasPointInTime)),
            );
        }
    }

    return index;
}

export function queryCommitmentsBySpec(index: CommitmentIndex, specId: string): Commitment[] {
    const ids = index.spec_index.get(specId) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByAction(index: CommitmentIndex, action: string): Commitment[] {
    const ids = index.action_index.get(action) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByAgent(index: CommitmentIndex, agentId: string): Commitment[] {
    const ids = index.agent_index.get(agentId) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByPlan(index: CommitmentIndex, planId: string): Commitment[] {
    const ids = index.plan_index.get(planId) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByProcess(index: CommitmentIndex, processId: string): Commitment[] {
    const ids = index.process_index.get(processId) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByLocation(
    index: CommitmentIndex,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): Commitment[] {
    if (!query.h3_index && query.latitude === undefined) return [];
    const ids = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsBySpecAndLocation(
    index: CommitmentIndex,
    specId: string,
    query: { h3_index?: string; latitude?: number; longitude?: number; radius_km?: number },
): Commitment[] {
    const specIds = index.spec_index.get(specId) ?? new Set<string>();
    if (specIds.size === 0) return [];
    const spatialIds = queryHexIndexRadius(index.spatial_hierarchy, query);
    return [...specIds]
        .filter(id => spatialIds.has(id))
        .map(id => index.commitments.get(id)!)
        .filter(Boolean);
}

export function queryCommitmentsByIntent(index: CommitmentIndex, intentId: string): Commitment[] {
    const ids = index.satisfies_index.get(intentId) ?? new Set<string>();
    return [...ids].map(id => index.commitments.get(id)!).filter(Boolean);
}

export function queryCommitmentsByHex(index: CommitmentIndex, cell: string): HexNode<Commitment> | null {
    return index.spatial_hierarchy.nodes.get(cell) ?? null;
}
