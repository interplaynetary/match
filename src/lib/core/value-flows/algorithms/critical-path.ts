/**
 * Critical Path Method (CPM) — Scheduling analysis for VF plans.
 *
 * From algorithms/critical-path.md (quoting Wikipedia CPM):
 *   "CPM calculates the longest path of planned activities to logical end points
 *    or to the end of the project, and the earliest and latest that each activity
 *    can start and finish without making the project longer."
 *
 * In ValueFlows:
 *   - Activities = Processes
 *   - Dependencies = when Process A outputs a resource that Process B needs as input
 *     (determined by matching resourceConformsTo across commitments and intents)
 *   - Duration = process.hasEnd - process.hasBeginning
 *
 * The result identifies:
 *   - The critical path: processes where float = 0 (any delay → project delay)
 *   - Float for non-critical processes (how much they can slip)
 *   - Total project duration
 */

import type { Process } from '../schemas';
import type { ProcessRegistry } from '../process-registry';
import type { PlanStore } from '../planning/planning';

// =============================================================================
// TYPES
// =============================================================================

export interface CriticalPathNode {
    processId: string;
    name: string;
    /** Duration in milliseconds */
    duration: number;
    /** Earliest this process can start (ms from project start) */
    earliestStart: number;
    /** Earliest this process can finish */
    earliestFinish: number;
    /** Latest it can start without delaying the project */
    latestStart: number;
    /** Latest it can finish without delaying the project */
    latestFinish: number;
    /** Total float (slack). 0 = on the critical path. */
    float: number;
    isCritical: boolean;
    /** Process IDs this one depends on (must complete first) */
    predecessors: string[];
    /** Process IDs that depend on this one */
    successors: string[];
}

export interface CriticalPathResult {
    nodes: CriticalPathNode[];
    /** Process IDs in order from start to end of the critical path */
    criticalPath: string[];
    /** Total project duration in milliseconds */
    projectDuration: number;
    /** Absolute start date of the project */
    projectStart: Date;
    /** Absolute end date of the project */
    projectEnd: Date;
}

// =============================================================================
// CRITICAL PATH
// =============================================================================

/**
 * Compute the critical path for all processes in a plan.
 *
 * @param planId - Plan to analyze
 * @param planStore - Has commitments (used to determine process dependencies)
 * @param processReg - Registry with Process instances (hasBeginning/hasEnd)
 * @param defaultDurationMs - Duration to use when a process has no timestamps (default: 1 hour)
 */
export function criticalPath(
    planId: string,
    planStore: PlanStore,
    processReg: ProcessRegistry,
    defaultDurationMs = 3_600_000,
): CriticalPathResult {
    const planProcesses = processReg.forPlan(planId);
    if (planProcesses.length === 0) {
        return {
            nodes: [],
            criticalPath: [],
            projectDuration: 0,
            projectStart: new Date(),
            projectEnd: new Date(),
        };
    }

    // Build dependency graph from plan commitments + intents
    const deps = buildDependencies(planId, planProcesses, planStore);

    // Compute durations for each process
    const durationMap = new Map<string, number>();
    for (const proc of planProcesses) {
        durationMap.set(proc.id, processDuration(proc, defaultDurationMs));
    }

    // Topological sort (Kahn's algorithm on predecessors)
    const order = topoSort(planProcesses.map(p => p.id), deps.predecessors);

    // --- Forward Pass ---
    // ES[i] = max(EF of all predecessors), EF[i] = ES[i] + duration
    const ES = new Map<string, number>();
    const EF = new Map<string, number>();

    for (const id of order) {
        const preds = deps.predecessors.get(id) ?? [];
        const es = preds.length === 0 ? 0 : Math.max(...preds.map(p => EF.get(p) ?? 0));
        const ef = es + (durationMap.get(id) ?? defaultDurationMs);
        ES.set(id, es);
        EF.set(id, ef);
    }

    const projectDurationMs = Math.max(0, ...Array.from(EF.values()));

    // --- Backward Pass ---
    // LF[i] = min(LS of all successors), LS[i] = LF[i] - duration
    const LF = new Map<string, number>();
    const LS = new Map<string, number>();

    for (const id of [...order].reverse()) {
        const succs = deps.successors.get(id) ?? [];
        const lf = succs.length === 0
            ? projectDurationMs
            : Math.min(...succs.map(s => LS.get(s) ?? projectDurationMs));
        const ls = lf - (durationMap.get(id) ?? defaultDurationMs);
        LF.set(id, lf);
        LS.set(id, ls);
    }

    // --- Compute project absolute start ---
    let projectStartMs = Infinity;
    for (const proc of planProcesses) {
        if (proc.hasBeginning) {
            const t = new Date(proc.hasBeginning).getTime();
            if (t < projectStartMs) projectStartMs = t;
        }
    }
    if (!isFinite(projectStartMs)) projectStartMs = Date.now();
    const projectStart = new Date(projectStartMs);
    const projectEnd = new Date(projectStartMs + projectDurationMs);

    // --- Build result nodes ---
    const nodes: CriticalPathNode[] = planProcesses.map(proc => {
        const es = ES.get(proc.id) ?? 0;
        const ef = EF.get(proc.id) ?? 0;
        const lf = LF.get(proc.id) ?? ef;
        const ls = LS.get(proc.id) ?? es;
        // Round to avoid floating-point drift
        const float = Math.round(lf - ef);
        return {
            processId: proc.id,
            name: proc.name,
            duration: durationMap.get(proc.id) ?? defaultDurationMs,
            earliestStart: es,
            earliestFinish: ef,
            latestStart: ls,
            latestFinish: lf,
            float,
            isCritical: float === 0,
            predecessors: deps.predecessors.get(proc.id) ?? [],
            successors: deps.successors.get(proc.id) ?? [],
        };
    });

    // --- Extract critical path in dependency order ---
    const criticalNodes = nodes.filter(n => n.isCritical);
    const critPath = orderCriticalPath(criticalNodes);

    return { nodes, criticalPath: critPath, projectDuration: projectDurationMs, projectStart, projectEnd };
}

// =============================================================================
// INTERNAL — Dependency Graph
// =============================================================================

interface DependencyGraph {
    predecessors: Map<string, string[]>; // processId → [predecessorIds]
    successors: Map<string, string[]>;   // processId → [successorIds]
}

/**
 * Determine process dependencies from plan commitments and intents.
 *
 * A process B depends on A if:
 *   - A has an output flow with resourceConformsTo = X
 *   - B has an input flow with resourceConformsTo = X
 */
function buildDependencies(
    planId: string,
    planProcesses: Process[],
    planStore: PlanStore,
): DependencyGraph {
    const predecessors = new Map<string, string[]>();
    const successors = new Map<string, string[]>();
    for (const proc of planProcesses) {
        predecessors.set(proc.id, []);
        successors.set(proc.id, []);
    }

    const processIds = new Set(planProcesses.map(p => p.id));

    // spec → process IDs that output it / input it
    const outputsBySpec = new Map<string, string[]>();
    const inputsBySpec = new Map<string, string[]>();

    function indexFlow(
        spec: string | undefined,
        outputOf: string | undefined,
        inputOf: string | undefined,
    ): void {
        if (!spec) return;
        if (outputOf && processIds.has(outputOf)) {
            const list = outputsBySpec.get(spec) ?? [];
            if (!list.includes(outputOf)) list.push(outputOf);
            outputsBySpec.set(spec, list);
        }
        if (inputOf && processIds.has(inputOf)) {
            const list = inputsBySpec.get(spec) ?? [];
            if (!list.includes(inputOf)) list.push(inputOf);
            inputsBySpec.set(spec, list);
        }
    }

    for (const c of planStore.allCommitments().filter(c => c.plannedWithin === planId)) {
        indexFlow(c.resourceConformsTo, c.outputOf, c.inputOf);
    }
    for (const i of planStore.allIntents().filter(i => i.plannedWithin === planId)) {
        indexFlow(i.resourceConformsTo, i.outputOf, i.inputOf);
    }

    // Connect producers → consumers via matching spec
    for (const [spec, consumers] of inputsBySpec) {
        const prods = outputsBySpec.get(spec) ?? [];
        for (const producer of prods) {
            for (const consumer of consumers) {
                if (producer === consumer) continue;
                const preds = predecessors.get(consumer);
                const succs = successors.get(producer);
                if (!preds || !succs) continue;
                if (!preds.includes(producer)) preds.push(producer);
                if (!succs.includes(consumer)) succs.push(consumer);
            }
        }
    }

    return { predecessors, successors };
}

function processDuration(proc: Process, defaultMs: number): number {
    if (proc.hasBeginning && proc.hasEnd) {
        const diff = new Date(proc.hasEnd).getTime() - new Date(proc.hasBeginning).getTime();
        return diff > 0 ? diff : defaultMs;
    }
    return defaultMs;
}

function topoSort(ids: string[], predecessors: Map<string, string[]>): string[] {
    const inDegree = new Map<string, number>();
    for (const id of ids) {
        const count = (predecessors.get(id) ?? []).filter(p => ids.includes(p)).length;
        inDegree.set(id, count);
    }

    const queue = ids.filter(id => (inDegree.get(id) ?? 0) === 0);
    const order: string[] = [];

    while (queue.length > 0) {
        const current = queue.shift()!;
        order.push(current);
        for (const id of ids) {
            const preds = predecessors.get(id) ?? [];
            if (!preds.includes(current)) continue;
            const newDeg = (inDegree.get(id) ?? 1) - 1;
            inDegree.set(id, newDeg);
            if (newDeg === 0) queue.push(id);
        }
    }

    if (order.length < ids.length) {
        // Cycle detected: return the nodes we could sort, CPM will still work on the acyclic portion.
        // The cyclic nodes will have float=0 by default, which is conservatively correct.
        console.warn(
            `criticalPath: cycle detected among process dependencies. ` +
            `${ids.length - order.length} process(es) excluded from CPM analysis.`,
        );
    }

    return order;
}

function orderCriticalPath(criticalNodes: CriticalPathNode[]): string[] {
    if (criticalNodes.length === 0) return [];

    const criticalIds = new Set(criticalNodes.map(n => n.processId));
    const starts = criticalNodes.filter(n =>
        n.predecessors.every(p => !criticalIds.has(p))
    );

    const result: string[] = [];
    const visited = new Set<string>();

    function walk(node: CriticalPathNode): void {
        if (visited.has(node.processId)) return;
        visited.add(node.processId);
        result.push(node.processId);
        for (const sid of node.successors.filter(s => criticalIds.has(s))) {
            const next = criticalNodes.find(n => n.processId === sid);
            if (next) walk(next);
        }
    }

    for (const start of starts) walk(start);
    for (const node of criticalNodes) {
        if (!visited.has(node.processId)) result.push(node.processId);
    }

    return result;
}
