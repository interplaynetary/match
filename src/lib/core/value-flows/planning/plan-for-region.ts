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
 *     Pass 1: Explode primary independent demands (class order → due date)
 *     Derived: Compute replenishment demands from Pass 1 allocations
 *     Pass 2: Explode derived replenishment demands; collect metabolicDebt
 *     Backtrack: Retract latest-due Pass 1 demands to free capacity
 *   Phase B: Forward-schedule unabsorbed supply (dependentSupply)
 *   Phase 4: Collect result
 *
 * Merge-planner path: when subStores are provided, merges leaf stores first,
 * runs conflict detection, and resolves inter-region contention surgically.
 */

import * as h3 from 'h3-js';
import { nanoid } from 'nanoid';

import type { Intent, Process } from '../schemas';
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
    plannedWithin: string;   // replenishment planId; intentsForPlan resolves purchaseIntents
}

export interface DeficitSignal {
    /** Plan ID where this demand was attempted. After merging sub-stores,
     *  planStore.intentsForPlan(plannedWithin) → purchaseIntents showing what was missing. */
    plannedWithin: string;
    /** Stable identifier for this deficit (original intent_id or synthetic key). */
    intentId: string;
    specId: string;
    action: string;
    shortfall: number;
    due?: string;
    h3_cell?: string;
    source: 'unmet_demand' | 'metabolic_debt';
}

export interface SurplusSignal {
    /** Plan ID of the supply plan that produced this surplus.
     *  planStore.intentsForPlan(plannedWithin) → output flow intents for traceability. */
    plannedWithin: string;
    specId: string;
    quantity: number;
    availableFrom?: string;
    atLocation?: string;
}

/** Signal bundle for composition: pass from a child planForRegion call into a parent. */
export interface PlanSignals {
    deficits: DeficitSignal[];
    surplus: SurplusSignal[];
}

export interface RegionPlanResult {
    planStore: PlanStore;
    purchaseIntents: Intent[];
    surplus: SurplusSignal[];          // was { specId, quantity }[] — now with provenance
    unmetDemand: DemandSlot[];
    metabolicDebt: MetabolicDebt[];
    laborGaps: Intent[];
    deficits: DeficitSignal[];         // unified deficit view for upward composition
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
 * @param cells        H3 cell indices that define the region
 * @param horizon      Planning window (from/to dates)
 * @param ctx          Context (recipes, observer, indexes, etc.)
 * @param subStores    Optional leaf sub-stores for the merge planner path
 * @param childSignals Optional signals from sub-planners for upward composition
 */
export function planForRegion(
    cells: string[],
    horizon: { from: Date; to: Date },
    ctx: RegionPlanContext,
    subStores?: PlanStore[],
    childSignals?: PlanSignals[],
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

    // Inject child deficit signals as demand slots (composable upward routing).
    // Must happen BEFORE classification so injected demands are classified.
    if (childSignals && childSignals.length > 0) {
        const seenIntentId = new Set<string>();
        for (const signals of childSignals) {
            for (const deficit of signals.deficits) {
                if (seenIntentId.has(deficit.intentId)) continue;  // same intent from two children
                seenIntentId.add(deficit.intentId);
                rawDemands.push({
                    intent_id: deficit.intentId,
                    spec_id: deficit.specId,
                    action: deficit.action,
                    fulfilled_quantity: 0,
                    fulfilled_hours: 0,
                    required_quantity: deficit.shortfall,
                    required_hours: 0,
                    remaining_quantity: deficit.shortfall,
                    remaining_hours: 0,
                    due: deficit.due,
                    h3_cell: deficit.h3_cell,
                });
            }
        }
    }

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
    const replenDebts: MetabolicDebt[] = [];
    const allDeficits: DeficitSignal[] = [];

    // Sort: classification order → due date ascending
    const sortedSlots = [...classified].sort((a, b) => {
        const classDiff = CLASS_ORDER[a.slotClass] - CLASS_ORDER[b.slotClass];
        if (classDiff !== 0) return classDiff;
        const dueA = new Date(a.slot.due ?? 0).getTime();
        const dueB = new Date(b.slot.due ?? 0).getTime();
        return dueA - dueB;
    });

    // --- Pass 1: primary independent demands ---
    for (const { slot } of sortedSlots) {
        if (!slot.spec_id) continue;

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

        pass1Records.push({ slot, result });
        allPurchaseIntents.push(...result.purchaseIntents);
    }

    // Emit DeficitSignals for all Pass 1 demands where the demand spec itself couldn't
    // be sourced or produced (purchaseIntent for the demand spec means no recipe/inventory).
    // Covers both injected deficits being re-propagated and regular demands that are
    // unresolvable at this scope (external-dependency classification).
    for (const record of pass1Records) {
        const unresolved = record.result.purchaseIntents
            .filter(i => i.resourceConformsTo === record.slot.spec_id)
            .reduce((s, i) => s + (i.resourceQuantity?.hasNumericalValue ?? 0), 0);
        if (unresolved > 1e-9) {
            allDeficits.push({
                plannedWithin: record.result.plan.id,
                intentId: record.slot.intent_id,
                specId: record.slot.spec_id ?? '',
                action: record.slot.action,
                shortfall: unresolved,
                due: record.slot.due,
                h3_cell: record.slot.h3_cell,
                source: 'unmet_demand',
            });
        }
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
    const replenNetter = netter.fork({ observer: undefined });

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
            replenDebts.push({ specId, shortfall: purchasedQty, plannedWithin: replenPlanId });
        }
    }

    // --- Backtracking: if replenDebts remains, retract low-criticality Pass 1 ---
    if (replenDebts.length > 0) {
        // Retract order: latest due date first
        const retractOrder = [...pass1Records].sort(
            (a, b) => new Date(b.slot.due ?? 0).getTime() - new Date(a.slot.due ?? 0).getTime(),
        );

        for (const candidate of retractOrder) {
            if (replenDebts.length === 0) break;

            netter.retract(candidate.result);

            // Production-only netter for the replenishment retry: no observer so we
            // do not re-net from inventory (the replenishment question is whether a
            // production recipe exists, not whether inventory happens to still be around).
            const retryReplenNetter = netter.fork({ observer: undefined });

            // Re-run Pass 2 with freed capacity to see if debt is resolved
            const resolvedDebt: string[] = [];
            for (const debt of replenDebts) {
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
            replenDebts.splice(0, replenDebts.length, ...replenDebts.filter(
                d => !resolvedDebt.includes(d.specId),
            ));

            // Mark retracted demand as unmet
            unmetDemand.push(candidate.slot);

            allDeficits.push({
                plannedWithin: candidate.result.plan.id,
                intentId: candidate.slot.intent_id,
                specId: candidate.slot.spec_id ?? '',
                action: candidate.slot.action,
                shortfall: candidate.slot.remaining_quantity,
                due: candidate.slot.due,
                h3_cell: candidate.slot.h3_cell,
                source: 'unmet_demand',
            });

            // Remove from pass1Records so we don't re-retract
            const idx = pass1Records.indexOf(candidate);
            if (idx >= 0) pass1Records.splice(idx, 1);
        }
    }

    // Emit DeficitSignals for unresolved replenDebts (resolved entries were spliced out)
    for (const debt of replenDebts) {
        allDeficits.push({
            plannedWithin: debt.plannedWithin,
            intentId: `synthetic:debt:${debt.plannedWithin}:${debt.specId}`,
            specId: debt.specId,
            action: 'produce',
            shortfall: debt.shortfall,
            source: 'metabolic_debt',
        });
    }

    // -------------------------------------------------------------------------
    // Phase B — Forward-schedule unabsorbed supply
    // -------------------------------------------------------------------------
    const allSurplus: SurplusSignal[] = [];

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

        for (const s of result.surplus) {
            allSurplus.push({
                specId: s.specId,
                quantity: s.quantity,
                plannedWithin: supplyPlanId,
                availableFrom: supplySlot.available_from,
                atLocation: supplySlot.h3_cell,
            });
        }
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

                // Score each competing process by due date
                const scored = competingProcessIds.map(procId => {
                    const record = pass1Records.find(r =>
                        r.result.processes.some(p => p.id === procId),
                    );
                    const due = record?.slot.due ? new Date(record.slot.due).getTime() : 0;
                    return { procId, due, record };
                });

                // Sort: latest due first
                scored.sort((a, b) => b.due - a.due);

                for (const { record } of scored) {
                    if (!record) continue;
                    netter.retract(record.result);
                    unmetDemand.push(record.slot);
                    allDeficits.push({
                        plannedWithin: record.result.plan.id,
                        intentId: record.slot.intent_id,
                        specId: record.slot.spec_id ?? '',
                        action: record.slot.action,
                        shortfall: record.slot.remaining_quantity,
                        due: record.slot.due,
                        h3_cell: record.slot.h3_cell,
                        source: 'unmet_demand',
                    });

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

    // Derive metabolicDebt as a typed projection of allDeficits (deficits is the single source of truth)
    const metabolicDebt: MetabolicDebt[] = allDeficits
        .filter(d => d.source === 'metabolic_debt')
        .map(d => ({ specId: d.specId, shortfall: d.shortfall, plannedWithin: d.plannedWithin }));

    return {
        planStore,
        purchaseIntents: allPurchaseIntents,
        surplus: allSurplus,
        unmetDemand,
        metabolicDebt,
        laborGaps,
        deficits: allDeficits,
    };
}

// =============================================================================
// SIGNAL HELPERS
// =============================================================================

/** Extract PlanSignals from a completed RegionPlanResult for passing to a parent planner. */
export function buildPlanSignals(result: RegionPlanResult): PlanSignals {
    return { deficits: result.deficits, surplus: result.surplus };
}
