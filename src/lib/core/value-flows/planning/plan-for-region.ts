/**
 * planForRegion — top-level planning orchestrator.
 *
 * Ties together dependentDemand, dependentSupply, PlanNetter, and the
 * independent demand/supply indexes into a two-pass planning loop:
 *
 *   Phase 0: Normalise H3 cells (deduplicate, drop dominated children)
 *   Phase 1: Extract demand/supply slots for the canonical cell cover
 *   Phase 2: Classify each demand slot
 *   Phase 3: Formulate
 *     Pass 1: Explode primary independent demands (highest-priority first)
 *     Derived: Compute replenishment demands from Pass 1 allocations
 *     Pass 2: Explode derived replenishment demands; collect metabolicDebt
 *     Backtrack: Retract low-criticality Pass 1 demands to free capacity
 *   Phase B: Forward-schedule unabsorbed supply (dependentSupply)
 *   Phase 4: Collect result
 *
 * Merge-planner path: when subStores are provided, merges leaf stores first,
 * runs conflict detection, and resolves inter-region contention surgically.
 */

import * as h3 from 'h3-js';
import { nanoid } from 'nanoid';

import type { Intent, Commitment, Process } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import { PlanStore } from './planning';
import { ProcessRegistry } from '../process-registry';
import { PlanNetter } from './netting';
import { dependentDemand, type DependentDemandResult } from '../algorithms/dependent-demand';
import { dependentSupply } from '../algorithms/dependent-supply';
import {
    type IndependentDemandIndex,
    type DemandSlot,
    queryDemandByLocation,
} from '../indexes/independent-demand';
import {
    type IndependentSupplyIndex,
    type SupplySlot,
    querySupplyByLocation,
    querySupplyBySpec,
} from '../indexes/independent-supply';

// =============================================================================
// TYPES
// =============================================================================

export interface RegionPlanContext {
    recipeStore: RecipeStore;
    observer: Observer;
    demandIndex: IndependentDemandIndex;
    supplyIndex: IndependentSupplyIndex;
    generateId?: () => string;
    agents?: { provider?: string; receiver?: string };
    config?: {
        insuranceFactor?: number;   // default 0.10 (currently unused — placeholder)
    };
}

export interface MetabolicDebt {
    specId: string;
    shortfall: number;
}

export interface RegionPlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    surplus: Array<{ specId: string; quantity: number }>;
    unmetDemand: DemandSlot[];
    metabolicDebt: MetabolicDebt[];
    laborGaps: Intent[];
}

export type DemandSlotClass =
    | 'locally-satisfiable'
    | 'transport-candidate'
    | 'producible-with-imports'
    | 'external-dependency';

export interface Conflict {
    type: 'inventory-overclaim' | 'capacity-contention';
    resourceOrAgentId: string;
    overclaimed: number;
    candidates: string[];
}

// Internal record for per-slot tracking across passes
interface SlotRecord {
    slot: DemandSlot;
    classifiedAs: string[];
    result: DependentDemandResult;
}

// =============================================================================
// HELPERS
// =============================================================================

const CLASS_ORDER: Record<DemandSlotClass, number> = {
    'locally-satisfiable':     0,
    'transport-candidate':     1,
    'producible-with-imports': 2,
    'external-dependency':     3,
};

/**
 * Criticality: lower number = higher priority = planned first, retracted last.
 * Derived from resourceClassifiedAs tags on the demand's ResourceSpecification.
 */
export function criticality(classifiedAs: string[]): number {
    if (classifiedAs.includes('tag:plan:MeansOfProduction')) return 0;
    if (classifiedAs.includes('tag:plan:Administration')) return 1;
    if (classifiedAs.includes('tag:plan:Support')) return 3;
    return 2; // Consumption default
}

// =============================================================================
// PHASE 0 — NORMALISE CELLS
// =============================================================================

/**
 * Deduplicate and drop any H3 cell that is dominated by an ancestor already
 * present in the set. E.g. if both a parent and a child cell are in cells[],
 * the child is redundant for coverage purposes.
 */
export function normalizeCells(cells: string[]): string[] {
    const unique = [...new Set(cells)];
    return unique.filter(cell => {
        const res = h3.getResolution(cell);
        for (let r = 0; r < res; r++) {
            if (unique.includes(h3.cellToParent(cell, r))) return false;
        }
        return true;
    });
}

// =============================================================================
// PHASE 1 — EXTRACT
// =============================================================================

function extractSlots(
    canonical: string[],
    horizon: { from: Date; to: Date },
    demandIndex: IndependentDemandIndex,
    supplyIndex: IndependentSupplyIndex,
): { demands: DemandSlot[]; supply: SupplySlot[] } {
    const seenDemand = new Set<string>();
    const seenSupply = new Set<string>();
    const demands: DemandSlot[] = [];
    const supply: SupplySlot[] = [];

    for (const cell of canonical) {
        for (const s of queryDemandByLocation(demandIndex, { h3_index: cell })) {
            if (seenDemand.has(s.intent_id)) continue;
            seenDemand.add(s.intent_id);
            if (s.due) {
                const due = new Date(s.due);
                if (due < horizon.from || due > horizon.to) continue;
            }
            if (s.remaining_quantity > 0) {
                demands.push(s);
            }
        }
        for (const s of querySupplyByLocation(supplyIndex, { h3_index: cell })) {
            if (seenSupply.has(s.id)) continue;
            seenSupply.add(s.id);
            supply.push(s);
        }
    }

    return { demands, supply };
}

// =============================================================================
// PHASE 2 — CLASSIFY
// =============================================================================

export function classifySlot(
    slot: DemandSlot,
    canonical: string[],
    supplyIndex: IndependentSupplyIndex,
    recipeStore: RecipeStore,
): DemandSlotClass {
    const specId = slot.spec_id ?? '';

    // Is there supply of this spec within the canonical cells?
    const localSupply = canonical.some(cell =>
        querySupplyByLocation(supplyIndex, { h3_index: cell })
            .some(s => s.spec_id === specId && s.quantity > 0)
    );
    if (localSupply) return 'locally-satisfiable';

    // Is there supply elsewhere in the region?
    const allSupply = querySupplyBySpec(supplyIndex, specId);
    if (allSupply.length > 0) return 'transport-candidate';

    // Is there a recipe that could produce it?
    const recipes = recipeStore.recipesForOutput(specId);
    if (recipes.length > 0) return 'producible-with-imports';

    return 'external-dependency';
}

// =============================================================================
// RETRACTION — findRetractableSubgraph
// =============================================================================

/**
 * Given a DependentDemandResult, find the full process sub-DAG that can be
 * safely retracted without affecting any other processes in the planStore.
 *
 * Start from result.processes. For each process P, traverse inputOf links on
 * Commitments/Intents to find upstream processes whose outputs are consumed
 * exclusively within this subtree (i.e. no other processes in the planStore
 * depend on their output flows outside this subtree).
 *
 * Returns the IDs of all processes, commitments, and intents in the subgraph.
 */
export function findRetractableSubgraph(
    result: DependentDemandResult,
    planStore: PlanStore,
): { processIds: string[]; commitmentIds: string[]; intentIds: string[] } {
    const subgraphProcessIds = new Set<string>(result.processes.map(p => p.id));
    const allCommitments = planStore.allCommitments();
    const allIntents = planStore.allIntents();

    // BFS: expand upstream until we find processes with external consumers
    const queue = [...result.processes.map(p => p.id)];
    while (queue.length > 0) {
        const procId = queue.shift()!;

        // Find all input flows for this process
        const inputFlows = [
            ...allCommitments.filter(c => c.inputOf === procId),
            ...allIntents.filter(i => i.inputOf === procId),
        ];

        for (const flow of inputFlows) {
            // Find the upstream process that produces this input (outputOf)
            const producingProc = findProducingProcess(flow, allCommitments, allIntents);
            if (!producingProc || subgraphProcessIds.has(producingProc)) continue;

            // Include this upstream process only if ALL its output flows are
            // consumed exclusively within our subgraph (or are the root output)
            const outputFlows = [
                ...allCommitments.filter(c => c.outputOf === producingProc),
                ...allIntents.filter(i => i.outputOf === producingProc),
            ];

            const allOutputsInternal = outputFlows.every(outFlow => {
                // The consuming process for this output flow
                const consumer = findConsumingProcess(outFlow, allCommitments, allIntents);
                return consumer === undefined || subgraphProcessIds.has(consumer);
            });

            if (allOutputsInternal) {
                subgraphProcessIds.add(producingProc);
                queue.push(producingProc);
            }
        }
    }

    // Collect all commitments and intents belonging to subgraph processes
    const subgraphCommitmentIds = new Set<string>();
    const subgraphIntentIds = new Set<string>();

    for (const c of allCommitments) {
        if (
            (c.inputOf && subgraphProcessIds.has(c.inputOf)) ||
            (c.outputOf && subgraphProcessIds.has(c.outputOf))
        ) {
            subgraphCommitmentIds.add(c.id);
        }
    }
    for (const i of allIntents) {
        if (
            (i.inputOf && subgraphProcessIds.has(i.inputOf)) ||
            (i.outputOf && subgraphProcessIds.has(i.outputOf))
        ) {
            subgraphIntentIds.add(i.id);
        }
    }

    // Also include purchase intents from the result (they have no process link)
    for (const pi of result.purchaseIntents) {
        subgraphIntentIds.add(pi.id);
    }

    return {
        processIds: [...subgraphProcessIds],
        commitmentIds: [...subgraphCommitmentIds],
        intentIds: [...subgraphIntentIds],
    };
}

/**
 * Find the process ID that produces the given flow (i.e. another flow's outputOf
 * produces the resource that this flow consumes). We look for a flow whose
 * outputOf = some process, where that output flow's resourceConformsTo matches
 * this input flow's resourceConformsTo.
 *
 * Simplified: we look for a process P such that some outputOf:P flow has the
 * same resourceConformsTo as this input flow, AND P feeds into the consuming
 * process. Actually, we just look at what process the input flow comes from by
 * finding a matching output flow.
 */
function findProducingProcess(
    inputFlow: Commitment | Intent,
    allCommitments: Commitment[],
    allIntents: Intent[],
): string | undefined {
    const specId = inputFlow.resourceConformsTo;
    if (!specId) return undefined;

    // Find an output flow with the same spec that feeds into the same process context
    for (const c of allCommitments) {
        if (c.outputOf && c.resourceConformsTo === specId) return c.outputOf;
    }
    for (const i of allIntents) {
        if (i.outputOf && i.resourceConformsTo === specId) return i.outputOf;
    }
    return undefined;
}

/**
 * Find the consuming process of an output flow.
 * An output flow (outputOf=P) is consumed by a process Q when another flow
 * has inputOf=Q and the same resourceConformsTo.
 */
function findConsumingProcess(
    outputFlow: Commitment | Intent,
    allCommitments: Commitment[],
    allIntents: Intent[],
): string | undefined {
    const specId = outputFlow.resourceConformsTo;
    if (!specId) return undefined;

    for (const c of allCommitments) {
        if (c.inputOf && c.resourceConformsTo === specId) return c.inputOf;
    }
    for (const i of allIntents) {
        if (i.inputOf && i.resourceConformsTo === specId) return i.inputOf;
    }
    return undefined;
}

// =============================================================================
// CONFLICT DETECTION (merge planner)
// =============================================================================

const NON_CONSUMING_ACTIONS = new Set(['use', 'work', 'cite', 'deliverService']);

/**
 * Detect inventory-overclaim and capacity-contention conflicts in a merged
 * PlanStore. Called after the merge planner combines leaf sub-stores.
 */
export function detectConflicts(planStore: PlanStore, observer: Observer): Conflict[] {
    const conflicts: Conflict[] = [];

    // --- Inventory overclaim ---
    // Sum committed qty per resourceInventoriedAs across all consuming commitments
    const committedByResource = new Map<string, { total: number; candidates: string[] }>();
    for (const c of planStore.allCommitments()) {
        if (!c.resourceInventoriedAs) continue;
        if (NON_CONSUMING_ACTIONS.has(c.action)) continue;
        const rid = c.resourceInventoriedAs;
        const qty = c.resourceQuantity?.hasNumericalValue ?? 0;
        const entry = committedByResource.get(rid) ?? { total: 0, candidates: [] };
        entry.total += qty;
        entry.candidates.push(c.inputOf ?? c.id);
        committedByResource.set(rid, entry);
    }
    for (const [rid, { total, candidates }] of committedByResource) {
        const res = observer.getResource(rid);
        const onhand = res?.onhandQuantity?.hasNumericalValue ?? 0;
        if (total > onhand) {
            conflicts.push({
                type: 'inventory-overclaim',
                resourceOrAgentId: rid,
                overclaimed: total,
                candidates,
            });
        }
    }

    // --- Capacity contention ---
    // Sum committed work effort per provider across all work commitments
    const workByAgent = new Map<string, { total: number; candidates: string[] }>();
    for (const c of planStore.allCommitments()) {
        if (c.action !== 'work') continue;
        if (!c.provider) continue;
        const agentId = c.provider;
        const hrs = c.effortQuantity?.hasNumericalValue ?? 0;
        const entry = workByAgent.get(agentId) ?? { total: 0, candidates: [] };
        entry.total += hrs;
        entry.candidates.push(c.inputOf ?? c.id);
        workByAgent.set(agentId, entry);
    }
    // Also check intents (unilateral offers)
    for (const i of planStore.allIntents()) {
        if (i.action !== 'work') continue;
        if (!i.provider) continue;
        const agentId = i.provider;
        const hrs = i.effortQuantity?.hasNumericalValue ?? 0;
        const entry = workByAgent.get(agentId) ?? { total: 0, candidates: [] };
        entry.total += hrs;
        entry.candidates.push(i.inputOf ?? i.id);
        workByAgent.set(agentId, entry);
    }
    for (const [agentId, { total, candidates }] of workByAgent) {
        // Try to get agent capacity from observer if available
        const agentResources = observer.conformingResources
            ? observer.conformingResources('skill')
            : [];
        // Simple heuristic: flag if more than one candidate is competing
        // (full capacity check would require AgentIndex, which isn't in ctx here)
        if (candidates.length > 1 && total > 0) {
            // Only emit if there are multiple processes competing (not a real overclaim check
            // without capacity data, but flagged for merge resolution)
            // Skip — capacity contention requires AgentIndex; not available here.
            // Left as extension point.
        }
    }

    return conflicts;
}

// =============================================================================
// MERGE PLAN STORES
// =============================================================================

function mergePlanStores(subStores: PlanStore[], generateId?: () => string): PlanStore {
    const gen = generateId ?? (() => nanoid());
    // Use a fresh ProcessRegistry so we can merge all processes from sub-stores
    const processes = new ProcessRegistry(gen);
    const merged = new PlanStore(processes, gen);
    for (const sub of subStores) {
        merged.merge(sub);
    }
    return merged;
}

// (allocatedQtyForSlot removed — dependentSupply handles netting internally via netter.netSupply)

// =============================================================================
// PLAN FOR REGION
// =============================================================================

/**
 * Top-level planning orchestrator for an H3 cell region.
 *
 * @param cells     H3 cell indices that define the region
 * @param horizon   Planning window (from/to dates)
 * @param ctx       Context (recipes, observer, indexes, etc.)
 * @param subStores Optional leaf sub-stores for the merge planner path
 */
export function planForRegion(
    cells: string[],
    horizon: { from: Date; to: Date },
    ctx: RegionPlanContext,
    subStores?: PlanStore[],
): RegionPlanResult {
    const generateId = ctx.generateId ?? (() => nanoid());

    // -------------------------------------------------------------------------
    // Phase 0 — Normalise cells
    // -------------------------------------------------------------------------
    const canonical = normalizeCells(cells);

    // -------------------------------------------------------------------------
    // Phase 1 — Extract demand and supply slots
    // -------------------------------------------------------------------------
    const { demands: rawDemands, supply: extractedSupply } = extractSlots(
        canonical,
        horizon,
        ctx.demandIndex,
        ctx.supplyIndex,
    );

    // -------------------------------------------------------------------------
    // Phase 2 — Classify demand slots
    // -------------------------------------------------------------------------
    const classified = rawDemands.map(slot => ({
        slot,
        slotClass: classifySlot(slot, canonical, ctx.supplyIndex, ctx.recipeStore),
    }));

    // -------------------------------------------------------------------------
    // Phase 3 — Formulate
    // -------------------------------------------------------------------------

    // Setup: plan store + netter
    let planStore: PlanStore;
    if (subStores && subStores.length > 0) {
        planStore = mergePlanStores(subStores, generateId);
    } else {
        planStore = new PlanStore(new ProcessRegistry(generateId), generateId);
    }

    const processes = planStore.processes;
    const netter = new PlanNetter(planStore, ctx.observer);
    const pass1Records: SlotRecord[] = [];
    const allPurchaseIntents: Intent[] = [];
    const unmetDemand: DemandSlot[] = [];
    const metabolicDebt: MetabolicDebt[] = [];

    // Sort: classification order → criticality (ascending) → due date ascending
    const sortedSlots = [...classified].sort((a, b) => {
        const classDiff = CLASS_ORDER[a.slotClass] - CLASS_ORDER[b.slotClass];
        if (classDiff !== 0) return classDiff;
        const specA = ctx.recipeStore.getResourceSpec(a.slot.spec_id ?? '')?.resourceClassifiedAs ?? [];
        const specB = ctx.recipeStore.getResourceSpec(b.slot.spec_id ?? '')?.resourceClassifiedAs ?? [];
        const critDiff = criticality(specA) - criticality(specB);
        if (critDiff !== 0) return critDiff;
        const dueA = new Date(a.slot.due ?? 0).getTime();
        const dueB = new Date(b.slot.due ?? 0).getTime();
        return dueA - dueB;
    });

    // --- Pass 1: primary independent demands ---
    for (const { slot } of sortedSlots) {
        if (!slot.spec_id) continue;

        const specClassifiedAs =
            ctx.recipeStore.getResourceSpec(slot.spec_id)?.resourceClassifiedAs ?? [];

        const planId = `plan-${generateId()}`;
        planStore.addPlan({ id: planId, name: `Demand plan for ${slot.spec_id}` });

        const result = dependentDemand({
            planId,
            demandSpecId: slot.spec_id,
            demandQuantity: slot.remaining_quantity,
            dueDate: slot.due ? new Date(slot.due) : horizon.to,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: ctx.observer,
            netter,
            atLocation: slot.h3_cell,
            agents: ctx.agents,
            generateId,
        });

        pass1Records.push({ slot, classifiedAs: specClassifiedAs, result });
        allPurchaseIntents.push(...result.purchaseIntents);
    }

    // --- Compute derived replenishment demands ---
    const consumedBySpec = new Map<string, number>();
    for (const { result } of pass1Records) {
        for (const alloc of result.allocated) {
            consumedBySpec.set(
                alloc.specId,
                (consumedBySpec.get(alloc.specId) ?? 0) + alloc.quantity,
            );
        }
    }
    const derivedDemands: Array<{ specId: string; qty: number }> = [];
    for (const [specId, qty] of consumedBySpec) {
        const spec = ctx.recipeStore.getResourceSpec(specId);
        if (spec?.resourceClassifiedAs?.includes('tag:plan:replenishment-required')) {
            derivedDemands.push({ specId, qty });
        }
    }

    // --- Pass 2: derived replenishment demands ---
    // Use a production-only netter (no observer) so replenishment demands trigger
    // recipe production rather than re-sourcing from existing inventory.
    // The inventory was already consumed (or will be) by Pass 1 processes.
    const replenNetter = new PlanNetter(planStore, undefined);
    // Copy allocated scheduled flows from Pass 1 so we don't double-book
    for (const id of netter.allocated) replenNetter.allocated.add(id);

    const pass2Records: SlotRecord[] = [];

    for (const { specId, qty } of derivedDemands) {
        const replenPlanId = `replenish-${generateId()}`;
        planStore.addPlan({ id: replenPlanId, name: `Replenishment for ${specId}` });
        const result = dependentDemand({
            planId: replenPlanId,
            demandSpecId: specId,
            demandQuantity: qty,
            dueDate: horizon.to,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: undefined,   // no inventory netting — force production
            netter: replenNetter,
            agents: ctx.agents,
            generateId,
        });

        const syntheticSlot: DemandSlot = {
            intent_id: `synthetic:${specId}`,
            spec_id: specId,
            action: 'produce',
            fulfilled_quantity: 0,
            fulfilled_hours: 0,
            required_quantity: qty,
            required_hours: 0,
            remaining_quantity: qty,
            remaining_hours: 0,
        };

        pass2Records.push({
            slot: syntheticSlot,
            classifiedAs: ['tag:plan:replenishment-required'],
            result,
        });
        allPurchaseIntents.push(...result.purchaseIntents);

        // MetabolicDebt: the portion of the replenishment spec that could not be
        // produced by any recipe (i.e., dependentDemand created a purchaseIntent
        // for specId itself — meaning no recipe exists for specId).
        // We filter to purchaseIntents conforming to specId; other purchaseIntents
        // are for sub-inputs (e.g. compost-material) and are NOT metabolic debt
        // for the replenishment spec.
        const purchasedQty = result.purchaseIntents
            .filter(i => i.resourceConformsTo === specId)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (purchasedQty > 1e-9) {
            metabolicDebt.push({ specId, shortfall: purchasedQty });
        }
    }

    // --- Backtracking: if metabolicDebt remains, retract low-criticality Pass 1 ---
    if (metabolicDebt.length > 0) {
        // Retract order: lowest criticality first (highest weight), latest due date first
        const retractOrder = [...pass1Records].sort(
            (a, b) =>
                criticality(b.classifiedAs) - criticality(a.classifiedAs) ||
                new Date(b.slot.due ?? 0).getTime() - new Date(a.slot.due ?? 0).getTime(),
        );

        for (const candidate of retractOrder) {
            if (metabolicDebt.length === 0) break;

            // Find and retract the process subgraph
            const subgraph = findRetractableSubgraph(candidate.result, planStore);
            planStore.removeRecords(subgraph);

            // Rebuild netter from updated planStore
            const newNetter = new PlanNetter(planStore, ctx.observer);
            // Copy over existing allocations that are still valid (flows still in planStore)
            const stillAllocated = [...netter.allocated].filter(id => {
                // Keep if the flow still exists in planStore
                return planStore.allIntents().some(i => i.id === id) ||
                    planStore.allCommitments().some(c => c.id === id);
            });
            for (const id of stillAllocated) newNetter.allocated.add(id);

            // Production-only netter for the replenishment retry: no observer so we
            // do not re-net from inventory (the replenishment question is whether a
            // production recipe exists, not whether inventory happens to still be around).
            const retryReplenNetter = new PlanNetter(planStore, undefined);
            for (const id of newNetter.allocated) retryReplenNetter.allocated.add(id);

            // Re-run Pass 2 with freed capacity to see if debt is resolved
            const resolvedDebt: string[] = [];
            for (const debt of metabolicDebt) {
                const retryPlanId = `replenish-retry-${generateId()}`;
                planStore.addPlan({ id: retryPlanId, name: `Retry replenishment for ${debt.specId}` });
                const reResult = dependentDemand({
                    planId: retryPlanId,
                    demandSpecId: debt.specId,
                    demandQuantity: debt.shortfall,
                    dueDate: horizon.to,
                    recipeStore: ctx.recipeStore,
                    planStore,
                    processes,
                    observer: undefined,  // no inventory netting for replenishment
                    netter: retryReplenNetter,
                    agents: ctx.agents,
                    generateId,
                });
                allPurchaseIntents.push(...reResult.purchaseIntents);

                const newPurchasedQty = reResult.purchaseIntents
                    .filter(i => i.resourceConformsTo === debt.specId)
                    .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
                if (newPurchasedQty < debt.shortfall - 1e-9) {
                    // Debt partially resolved (some locally produced now)
                    debt.shortfall = newPurchasedQty;
                }
                if (newPurchasedQty <= 1e-9) {
                    resolvedDebt.push(debt.specId);
                }
            }

            // Remove resolved debts
            metabolicDebt.splice(0, metabolicDebt.length, ...metabolicDebt.filter(
                d => !resolvedDebt.includes(d.specId),
            ));

            // Mark retracted demand as unmet
            unmetDemand.push(candidate.slot);

            // Remove from pass1Records so we don't re-retract
            const idx = pass1Records.indexOf(candidate);
            if (idx >= 0) pass1Records.splice(idx, 1);
        }
    }

    // -------------------------------------------------------------------------
    // Phase B — Forward-schedule unabsorbed supply
    // -------------------------------------------------------------------------
    const allSurplus: Array<{ specId: string; quantity: number }> = [];

    for (const supplySlot of extractedSupply) {
        if (!supplySlot.spec_id) continue;
        if (supplySlot.slot_type === 'labor') continue; // labor handled by work intents

        const supplyPlanId = `supply-${generateId()}`;
        planStore.addPlan({ id: supplyPlanId, name: `Supply plan for ${supplySlot.spec_id}` });
        const result = dependentSupply({
            planId: supplyPlanId,
            supplySpecId: supplySlot.spec_id,
            supplyQuantity: supplySlot.quantity,  // netter handles internal absorption
            availableFrom: supplySlot.available_from
                ? new Date(supplySlot.available_from)
                : horizon.from,
            recipeStore: ctx.recipeStore,
            planStore,
            processes,
            observer: ctx.observer,
            netter,
            agents: ctx.agents,
            generateId,
        });

        allSurplus.push(...result.surplus);
        allPurchaseIntents.push(...result.purchaseIntents);
    }

    // -------------------------------------------------------------------------
    // Merge planner: conflict detection and surgical resolution
    // -------------------------------------------------------------------------
    if (subStores && subStores.length > 0) {
        let conflicts = detectConflicts(planStore, ctx.observer);
        let iterations = 0;
        const MAX_ITERATIONS = 10;

        while (conflicts.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;

            for (const conflict of conflicts) {
                if (conflict.type !== 'inventory-overclaim') continue;

                // Find all processes competing for the contested resource
                // Retract the lowest-criticality, latest-due candidate processes
                const competingProcessIds = conflict.candidates.filter(Boolean);

                // Score each competing process by its classification tags
                // (proxy: scan Pass 1 records for a matching process)
                const scored = competingProcessIds.map(procId => {
                    const record = pass1Records.find(r =>
                        r.result.processes.some(p => p.id === procId),
                    );
                    const crit = record ? criticality(record.classifiedAs) : 2;
                    const due = record?.slot.due ? new Date(record.slot.due).getTime() : 0;
                    return { procId, crit, due, record };
                });

                // Sort: highest criticality number = retract first, latest due first
                scored.sort((a, b) => b.crit - a.crit || b.due - a.due);

                for (const { record } of scored) {
                    if (!record) continue;
                    const subgraph = findRetractableSubgraph(record.result, planStore);
                    planStore.removeRecords(subgraph);
                    unmetDemand.push(record.slot);

                    // Re-explode at merge scope
                    const { slot } = record;
                    if (slot.spec_id) {
                        const mergeReplanId = `merge-replan-${generateId()}`;
                        planStore.addPlan({ id: mergeReplanId, name: `Merge replan for ${slot.spec_id}` });
                        const reResult = dependentDemand({
                            planId: mergeReplanId,
                            demandSpecId: slot.spec_id,
                            demandQuantity: slot.remaining_quantity,
                            dueDate: slot.due ? new Date(slot.due) : horizon.to,
                            recipeStore: ctx.recipeStore,
                            planStore,
                            processes,
                            observer: ctx.observer,
                            netter,
                            agents: ctx.agents,
                            generateId,
                        });
                        allPurchaseIntents.push(...reResult.purchaseIntents);
                    }

                    // Check if conflict is resolved
                    const newConflicts = detectConflicts(planStore, ctx.observer);
                    const stillConflicted = newConflicts.some(
                        nc => nc.resourceOrAgentId === conflict.resourceOrAgentId,
                    );
                    if (!stillConflicted) break;
                }
            }

            conflicts = detectConflicts(planStore, ctx.observer);
        }
    }

    // -------------------------------------------------------------------------
    // Phase 4 — Collect
    // -------------------------------------------------------------------------
    const laborGaps = planStore.allIntents().filter(
        i => i.action === 'work' && i.provider === undefined,
    );

    return {
        planStore,
        purchaseIntents: allPurchaseIntents,
        surplus: allSurplus,
        unmetDemand,
        metabolicDebt,
        laborGaps,
    };
}
