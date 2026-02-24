/**
 * Track & Trace — Resource provenance and destination algorithms.
 *
 * From the VF spec:
 *   - trace(): Follow a resource BACKWARDS to its origins
 *   - track(): Follow a resource FORWARDS to its destinations
 *
 * These algorithms traverse the event-process graph using the
 * Observer's indexes and the `previousEvent` breadcrumbs.
 *
 * The result is an ordered list of FlowNodes (events, processes, resources)
 * forming a tree of causal relationships.
 */

import type { EconomicEvent, EconomicResource, Process } from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { Observer } from '../observation/observer';
import type { ProcessRegistry } from '../process-registry';

// =============================================================================
// FLOW TREE — Result type
// =============================================================================

export type FlowNodeKind = 'event' | 'process' | 'resource';

export interface FlowNode {
    kind: FlowNodeKind;
    id: string;
    /** The node that led us here in the traversal */
    parent?: string;
    /** The actual data — one of Event, Process, or Resource */
    data: EconomicEvent | Process | EconomicResource;
}

// =============================================================================
// TRACE — Follow backwards to origins
// =============================================================================

/**
 * Get the "previous" flow step(s) for a given node.
 *
 * - Resource.previous → all output events, transfer-in events, raise/lower events
 * - Process.previous → all input events
 * - Event.previous   → the process (if output), or the resource (if has resourceInventoriedAs)
 */
function previousOf(
    node: FlowNode,
    observer: Observer,
    processes: ProcessRegistry,
    includeStale: boolean,
): FlowNode[] {
    switch (node.kind) {
        case 'resource': {
            // All events that created/modified this resource
            const events = includeStale
                ? observer.eventsForResource(node.id)
                : observer.activeEventsForResource(node.id);
            return events
                .filter(e => {
                    const def = ACTION_DEFINITIONS[e.action];
                    // Output events, transfer-to events, raise/lower
                    return e.outputOf ||
                        e.toResourceInventoriedAs === node.id ||
                        e.action === 'raise' || e.action === 'lower';
                })
                .map(e => ({ kind: 'event' as const, id: e.id, data: e }));
        }
        case 'process': {
            // All input events
            const events = observer.eventsForProcess(node.id)
                .filter(e => e.inputOf === node.id);
            return events.map(e => ({ kind: 'event' as const, id: e.id, data: e }));
        }
        case 'event': {
            const event = node.data as EconomicEvent;
            const results: FlowNode[] = [];

            if (event.outputOf) {
                // This event is output of a process → go to the process
                const proc = processes.get(event.outputOf);
                if (proc) results.push({ kind: 'process', id: proc.id, data: proc });
            } else if (event.action === 'raise' || event.action === 'lower') {
                // raise/lower with no previousEvent = origin
                if (event.previousEvent) {
                    const prev = observer.getEvent(event.previousEvent);
                    if (prev) results.push({ kind: 'event', id: prev.id, data: prev });
                }
            } else if (event.resourceInventoriedAs) {
                // Go to the resource
                const resource = observer.getResource(event.resourceInventoriedAs);
                if (resource) results.push({ kind: 'resource', id: resource.id, data: resource });
            }

            return results;
        }
    }
}


/**
 * Trace a resource or event backwards to its origins.
 *
 * Returns an ordered list of FlowNodes forming a backwards tree.
 * Each node has a `parent` field pointing to the node that led to it.
 *
 * By default, corrected (stale) events are excluded from the traversal.
 * Pass `{ includeStale: true }` to include them for audit purposes.
 *
 * @param startId - The resource or event ID to trace from
 */
export function trace(
    startId: string,
    observer: Observer,
    processes: ProcessRegistry,
    opts?: { includeStale?: boolean },
): FlowNode[] {
    const includeStale = opts?.includeStale ?? false;

    // Determine starting node
    const resource = observer.getResource(startId);
    const event = resource ? undefined : observer.getEvent(startId);
    if (!resource && !event) return [];

    const startNode: FlowNode = resource
        ? { kind: 'resource', id: startId, data: resource }
        : { kind: 'event', id: startId, data: event! };

    const flows: FlowNode[] = [startNode];
    const visited = new Set<string>([startId]);

    function dfs(current: FlowNode): void {
        const prevNodes = previousOf(current, observer, processes, includeStale);

        for (const prev of prevNodes) {
            if (!visited.has(prev.id)) {
                visited.add(prev.id);
                prev.parent = current.id;
                flows.push(prev);
                dfs(prev);
            }
        }
    }

    dfs(startNode);
    return flows;
}

// =============================================================================
// TRACK — Follow forwards to destinations
// =============================================================================

/**
 * Get the "next" flow step(s) for a given node.
 *
 * - Resource.next → all events where this resource is resourceInventoriedAs
 * - Process.next  → all output events
 * - Event.next    → the process (if input), or the resource (if output/transfer)
 */
function nextOf(
    node: FlowNode,
    observer: Observer,
    processes: ProcessRegistry,
    includeStale: boolean,
): FlowNode[] {
    switch (node.kind) {
        case 'resource': {
            const events = includeStale
                ? observer.eventsForResource(node.id)
                : observer.activeEventsForResource(node.id);
            return events.map(e => ({ kind: 'event' as const, id: e.id, data: e }));
        }
        case 'process': {
            // All output events
            const events = observer.eventsForProcess(node.id)
                .filter(e => e.outputOf === node.id);
            return events.map(e => ({ kind: 'event' as const, id: e.id, data: e }));
        }
        case 'event': {
            const event = node.data as EconomicEvent;
            const results: FlowNode[] = [];

            if (event.inputOf) {
                // This event is input to a process → go to the process
                const proc = processes.get(event.inputOf);
                if (proc) results.push({ kind: 'process', id: proc.id, data: proc });
            }
            if (event.outputOf) {
                // Output event → go to the produced resource
                if (event.resourceInventoriedAs) {
                    const resource = observer.getResource(event.resourceInventoriedAs);
                    if (resource) results.push({ kind: 'resource', id: resource.id, data: resource });
                }
            }
            if (event.toResourceInventoriedAs) {
                // Transfer → go to the destination resource
                const resource = observer.getResource(event.toResourceInventoriedAs);
                if (resource) results.push({ kind: 'resource', id: resource.id, data: resource });
            }

            return results;
        }
    }
}

/**
 * Track a resource or event forwards to its destinations.
 *
 * Returns an ordered list of FlowNodes forming a forwards tree.
 *
 * By default, corrected (stale) events are excluded from the traversal.
 * Pass `{ includeStale: true }` to include them for audit purposes.
 *
 * @param startId - The resource or event ID to track from
 */
export function track(
    startId: string,
    observer: Observer,
    processes: ProcessRegistry,
    opts?: { includeStale?: boolean },
): FlowNode[] {
    const includeStale = opts?.includeStale ?? false;

    const resource = observer.getResource(startId);
    const event = resource ? undefined : observer.getEvent(startId);
    if (!resource && !event) return [];

    const startNode: FlowNode = resource
        ? { kind: 'resource', id: startId, data: resource }
        : { kind: 'event', id: startId, data: event! };

    const flows: FlowNode[] = [startNode];
    const visited = new Set<string>([startId]);

    function dfs(current: FlowNode): void {
        const nxtNodes = nextOf(current, observer, processes, includeStale);

        for (const nxt of nxtNodes) {
            if (!visited.has(nxt.id)) {
                visited.add(nxt.id);
                nxt.parent = current.id;
                flows.push(nxt);
                dfs(nxt);
            }
        }
    }

    dfs(startNode);
    return flows;
}
