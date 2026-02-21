/**
 * Value Rollup — Summarize total input values for a recipe or resource.
 *
 * From algorithms/rollup.md:
 *   "Value rollups can be done on recipes as well as on reported events.
 *    They summarize the values of all of the inputs to all of the processes
 *    that go into the creation of a Resource Category or an Economic Resource."
 *
 * Two modes:
 *
 *   1. Standard Cost Rollup (from recipe)
 *      Traverse the recipe process chain. For each process, collect all input
 *      flows and their quantities. Multiply by a unit cost to get total value.
 *      This is analogous to Standard Cost in manufacturing (BOM + routing).
 *
 *   2. Actual Cost Rollup (from events)
 *      Trace backwards from a resource or event using the Observer.
 *      Collect all input events (work, consume, use, cite) and sum their
 *      quantities. Compare against standard cost to find variances.
 *
 * All values are converted into a common unit (often money, hours, or credits).
 * A UnitConverter function is provided to map unit labels to a numeric rate.
 */

import type { EconomicEvent, RecipeFlow } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';
import type { ProcessRegistry } from '../process-registry';
import { trace } from './track-trace';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Unit converter: maps (quantity, unit) → value in the common unit.
 *
 * Example: (5, 'hours') → 150  (at $30/hr)
 *          (2, 'kg') → 10      (at $5/kg)
 */
export type UnitConverter = (quantity: number, unit: string) => number;

/** A named line item in a rollup — one input flow or event. */
export interface RollupLineItem {
    /** Human-readable label */
    label: string;
    /** ResourceSpecification ID or event action */
    specId?: string;
    action?: string;
    /** Quantity and unit as measured */
    quantity: number;
    unit: string;
    /** Converted value in the common unit */
    value: number;
}

/** Rollup result for one process in the chain */
export interface RollupStage {
    processId?: string;
    processName: string;
    inputs: RollupLineItem[];
    stageTotalValue: number;
}

export interface RollupResult {
    /** Source: 'recipe' for standard cost, 'events' for actual cost */
    source: 'recipe' | 'events';
    /** Per-stage breakdown */
    stages: RollupStage[];
    /** Grand total in the common unit */
    totalValue: number;
    /** The common unit label */
    commonUnit: string;
}

// =============================================================================
// STANDARD COST ROLLUP — From recipe
// =============================================================================

/**
 * Compute standard cost by traversing a recipe's process chain.
 *
 * @param recipeId - Recipe to roll up
 * @param recipeStore - Knowledge layer
 * @param converter - Maps (quantity, unit) → value in common unit
 * @param commonUnit - Label for the common unit (e.g. 'USD', 'hours', 'credits')
 * @param scaleFactor - Multiplier for the recipe output quantity (default 1)
 */
export function rollupStandardCost(
    recipeId: string,
    recipeStore: RecipeStore,
    converter: UnitConverter,
    commonUnit = 'USD',
    scaleFactor = 1,
): RollupResult {
    const recipe = recipeStore.getRecipe(recipeId);
    if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

    const chain = recipeStore.getProcessChain(recipeId);
    const stages: RollupStage[] = [];
    let totalValue = 0;

    for (const rp of chain) {
        const { inputs } = recipeStore.flowsForProcess(rp.id);
        const lineItems = inputs.map(flow => toLineItem(flow, scaleFactor, converter));
        const stageTotalValue = lineItems.reduce((s, l) => s + l.value, 0);
        stages.push({ processName: rp.name, inputs: lineItems, stageTotalValue });
        totalValue += stageTotalValue;
    }

    return { source: 'recipe', stages, totalValue, commonUnit };
}

// =============================================================================
// ACTUAL COST ROLLUP — From observed events
// =============================================================================

/**
 * Compute actual cost by tracing backwards from a resource or event.
 *
 * Traces the causal graph (same DFS as track-trace.ts) and collects
 * all input-type events (consume, use, work, cite). Sums their quantities
 * through the converter to get total actual cost.
 *
 * @param startId - Resource ID or EconomicEvent ID to trace from
 * @param observer - Observation layer
 * @param processReg - Process registry
 * @param converter - Maps (quantity, unit) → value in common unit
 * @param commonUnit - Label for the common unit
 */
export function rollupActualCost(
    startId: string,
    observer: Observer,
    processReg: ProcessRegistry,
    converter: UnitConverter,
    commonUnit = 'USD',
): RollupResult {
    // Trace backwards to get all causal nodes
    const nodes = trace(startId, observer, processReg);

    // Group event nodes by process (or 'unprocessed' for standalone events)
    const stageMap = new Map<string, { name: string; events: EconomicEvent[] }>();

    for (const node of nodes) {
        if (node.kind !== 'event') continue;
        const event = node.data as EconomicEvent;

        // Only count input-type events (resource consumption, effort)
        if (!isInputEvent(event)) continue;

        const processId = event.inputOf ?? 'unprocessed';
        if (!stageMap.has(processId)) {
            const proc = processId !== 'unprocessed' ? processReg.get(processId) : undefined;
            stageMap.set(processId, { name: proc?.name ?? 'Unprocessed', events: [] });
        }
        stageMap.get(processId)!.events.push(event);
    }

    const stages: RollupStage[] = [];
    let totalValue = 0;

    for (const [, stage] of stageMap) {
        const lineItems: RollupLineItem[] = stage.events.map(event => {
            const qty = event.resourceQuantity ?? event.effortQuantity;
            const quantity = qty?.hasNumericalValue ?? 0;
            const unit = qty?.hasUnit ?? 'each';
            const value = converter(quantity, unit);
            return {
                label: `${event.action} by ${event.provider}`,
                specId: event.resourceConformsTo,
                action: event.action,
                quantity,
                unit,
                value,
            };
        });

        const stageTotalValue = lineItems.reduce((s, l) => s + l.value, 0);
        stages.push({ processName: stage.name, inputs: lineItems, stageTotalValue });
        totalValue += stageTotalValue;
    }

    return { source: 'events', stages, totalValue, commonUnit };
}

// =============================================================================
// VARIANCE — Standard vs Actual
// =============================================================================

export interface CostVariance {
    standardCost: number;
    actualCost: number;
    /** positive = under budget, negative = over budget */
    variance: number;
    variancePct: number;
    commonUnit: string;
}

/**
 * Compare standard cost (recipe) against actual cost (events).
 */
export function costVariance(standard: RollupResult, actual: RollupResult): CostVariance {
    const variance = standard.totalValue - actual.totalValue;
    const variancePct = standard.totalValue === 0 ? 0 : (variance / standard.totalValue) * 100;
    return {
        standardCost: standard.totalValue,
        actualCost: actual.totalValue,
        variance,
        variancePct,
        commonUnit: standard.commonUnit,
    };
}

// =============================================================================
// INTERNAL
// =============================================================================

function toLineItem(flow: RecipeFlow, scaleFactor: number, converter: UnitConverter): RollupLineItem {
    const qty = flow.resourceQuantity ?? flow.effortQuantity;
    const quantity = (qty?.hasNumericalValue ?? 0) * scaleFactor;
    const unit = qty?.hasUnit ?? 'each';
    const specId = flow.resourceConformsTo;
    return {
        label: `${flow.action}${specId ? ` of ${specId}` : ''}`,
        specId,
        action: flow.action,
        quantity,
        unit,
        value: converter(quantity, unit),
    };
}

/** Input-type events are those that consume resources or record effort. */
const INPUT_ACTIONS = new Set(['consume', 'use', 'work', 'cite', 'accept', 'pickup', 'combine']);

function isInputEvent(event: EconomicEvent): boolean {
    return INPUT_ACTIONS.has(event.action) || !!event.inputOf;
}
