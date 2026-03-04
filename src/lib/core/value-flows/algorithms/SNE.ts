/**
 * SNE — Socially Necessary Effort.
 *
 * SNE(spec) = total direct + embodied labor hours required to produce one unit,
 * including:
 *   - Direct work flows (work actions: effortQuantity per process run)
 *   - Embodied labor of consumed inputs (recursive: qty × SNE(input_spec))
 *   - Equipment depreciation from use flows:
 *       (duration_per_run / equipment_lifespan) × SNE(equipment_spec)
 *     Requires caller-supplied lifespan data; contributes 0 when absent.
 *   - cite flows: near-zero amortized contribution, skipped.
 *
 * Used for recipe ranking — extends SNLT (direct-labor-only) to include
 * embodied labor and equipment costs.
 *
 * Two computation modes:
 *   a) Recipe metadata (planning estimate) — computeRecipeSNE / buildSNEIndex
 *   b) Observed actuals (EMA update) — updateSNEFromActuals
 *
 * The SNEIndex (Map<specId, number>) is optional in all callers.
 * When absent, dependent-demand falls back to the existing SNLT ranking.
 */

import type { EconomicEvent } from '../schemas';
import type { RecipeStore } from '../knowledge/recipes';
import type { Observer } from '../observation/observer';

// =============================================================================
// TYPES
// =============================================================================

/** specId → SNE in effort hours per unit of that spec. */
export type SNEIndex = Map<string, number>;

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Compute SNE for a single specific recipe (not the best across all recipes).
 * Recursively resolves embodied labor for consumed/used inputs via specSNE.
 * Returns Infinity when the recipe has no valid primary output quantity.
 */
function recipeSNE(
    recipeId: string,
    outputSpecId: string,
    recipeStore: RecipeStore,
    sneIndex: SNEIndex,
    lifespans: Map<string, number> | undefined,
    computing: Set<string>,
): number {
    const chain = recipeStore.getProcessChain(recipeId);
    if (chain.length === 0) return Infinity;

    // Find total output quantity (denominator for SNE per unit).
    // Sum ALL flows matching outputSpecId to handle co-product recipes correctly.
    const lastProcess = chain[chain.length - 1];
    const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
    const outputQty = outputs
        .filter(f => f.resourceConformsTo === outputSpecId)
        .reduce((sum, f) => sum + (f.resourceQuantity?.hasNumericalValue ?? 0), 0);
    if (outputQty <= 0) return Infinity;

    let totalEffort = 0;

    for (const rp of chain) {
        const { inputs } = recipeStore.flowsForProcess(rp.id);
        for (const flow of inputs) {
            if (!flow.resourceConformsTo) continue;

            if (flow.action === 'work') {
                // Direct labor: effort hours per process run
                totalEffort += flow.effortQuantity?.hasNumericalValue ?? 0;

            } else if (flow.action === 'consume') {
                // Embodied labor: qty_consumed × SNE(input_spec)
                const inputQty = flow.resourceQuantity?.hasNumericalValue ?? 0;
                const inputSNE = specSNE(flow.resourceConformsTo, recipeStore, sneIndex, lifespans, computing);
                totalEffort += inputQty * inputSNE;

            } else if (flow.action === 'use') {
                // Equipment depreciation: (duration / lifespan) × SNE(equipment_spec)
                // Contributes 0 when no lifespan data is available (graceful degradation).
                const lifespan = lifespans?.get(flow.resourceConformsTo);
                if (lifespan && lifespan > 0) {
                    const duration = flow.effortQuantity?.hasNumericalValue ?? 0;
                    const equipSNE = specSNE(flow.resourceConformsTo, recipeStore, sneIndex, lifespans, computing);
                    totalEffort += (duration / lifespan) * equipSNE;
                }
            }
            // 'cite': knowledge/IP — amortized near 0, skip.
        }
    }

    return totalEffort / outputQty;
}

/**
 * Compute best (minimum) SNE across all recipes for a given spec.
 * Populates sneIndex as a side effect (memoization across calls).
 * Detects circular recipe dependencies via the `computing` set; breaks cycles with 0.
 * Returns 0 for leaf specs (raw materials with no recipe).
 */
function specSNE(
    specId: string,
    recipeStore: RecipeStore,
    sneIndex: SNEIndex,
    lifespans: Map<string, number> | undefined,
    computing: Set<string>,
): number {
    if (sneIndex.has(specId)) return sneIndex.get(specId)!;
    if (computing.has(specId)) return 0; // cycle detected — break with 0

    computing.add(specId);

    const recipes = recipeStore.recipesForOutput(specId);
    let minSNE = recipes.length === 0 ? 0 : Infinity;

    for (const recipe of recipes) {
        const sne = recipeSNE(recipe.id, specId, recipeStore, sneIndex, lifespans, computing);
        if (sne < minSNE) minSNE = sne;
    }

    const result = minSNE === Infinity ? 0 : minSNE;
    sneIndex.set(specId, result);
    computing.delete(specId);
    return result;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Compute SNE per unit for a single recipe.
 *
 * Use this when ranking multiple recipes that all produce the same output spec.
 * A fresh `computing` set is created per call, so cycles within this recipe's
 * dependency graph are safely broken.
 *
 * If the sneIndex is missing entries for consumed inputs, they are computed
 * on demand (and memoized into sneIndex for reuse).
 *
 * @param recipeId      Recipe to score
 * @param outputSpecId  Primary output spec of this recipe
 * @param recipeStore   Knowledge layer
 * @param sneIndex      Index used for input lookups (mutated as side effect)
 * @param lifespans     Optional map of specId → lifespan in effort hours (enables
 *                      equipment depreciation for 'use' flows; omit to skip)
 * @returns SNE in effort hours per unit, or Infinity if recipe has no valid output
 */
export function computeSNEForRecipe(
    recipeId: string,
    outputSpecId: string,
    recipeStore: RecipeStore,
    sneIndex: SNEIndex,
    lifespans?: Map<string, number>,
): number {
    return recipeSNE(recipeId, outputSpecId, recipeStore, sneIndex, lifespans, new Set());
}

/**
 * Compute the best (minimum) SNE across all recipes for a spec.
 * Populates sneIndex as a side effect (memoization).
 *
 * Suitable for building a complete index in one pass or for ad-hoc spec queries.
 * Returns 0 for raw materials (no recipe) — their SNE is externally determined
 * (e.g. supplied via updateSNEFromActuals).
 *
 * @param outputSpecId  Spec to compute SNE for
 * @param recipeStore   Knowledge layer
 * @param sneIndex      Mutable index (pre-populated entries are used as-is)
 * @param lifespans     Optional equipment lifespan map (specId → effort hours)
 */
export function computeRecipeSNE(
    outputSpecId: string,
    recipeStore: RecipeStore,
    sneIndex: SNEIndex,
    lifespans?: Map<string, number>,
): number {
    return specSNE(outputSpecId, recipeStore, sneIndex, lifespans, new Set());
}

/**
 * Build a complete SNE index from recipe metadata for all registered specs.
 *
 * Calls computeRecipeSNE for every ResourceSpecification in recipeStore.
 * Memoization ensures each spec is only traversed once even when called
 * for all specs.
 *
 * @param recipeStore  Knowledge layer
 * @param lifespans    Optional equipment lifespan map (specId → effort hours)
 * @returns Complete SNEIndex ready for use in planning
 */
export function buildSNEIndex(
    recipeStore: RecipeStore,
    lifespans?: Map<string, number>,
): SNEIndex {
    const sneIndex: SNEIndex = new Map();
    for (const spec of recipeStore.allResourceSpecs()) {
        computeRecipeSNE(spec.id, recipeStore, sneIndex, lifespans);
    }
    return sneIndex;
}

/**
 * Update SNE for a spec from actual EconomicEvents using exponential moving average.
 *
 * Computes observed labor-per-unit from events and blends with the prior estimate:
 *   actualSNE = Σ(effortQuantity of workEvents) / Σ(resourceQuantity of outputEvents)
 *   new SNE   = alpha × actualSNE + (1 - alpha) × prior
 *
 * No-op when total output quantity is zero (prevents division-by-zero).
 * When sneIndex has no prior entry, the observed actualSNE is used as the initial value.
 *
 * @param specId       The output spec to update
 * @param workEvents   EconomicEvents with action='work' from processes producing specId
 * @param outputEvents EconomicEvents with action='produce'|'modify' outputting specId
 * @param sneIndex     Index to update in-place
 * @param alpha        EMA weight for new observation — default 0.1 (slow-moving average)
 */
export function updateSNEFromActuals(
    specId: string,
    workEvents: EconomicEvent[],
    outputEvents: EconomicEvent[],
    sneIndex: SNEIndex,
    alpha = 0.1,
): void {
    const totalWork = workEvents.reduce(
        (sum, e) => sum + (e.effortQuantity?.hasNumericalValue ?? 0),
        0,
    );
    const totalOutput = outputEvents.reduce(
        (sum, e) => sum + (e.resourceQuantity?.hasNumericalValue ?? 0),
        0,
    );
    if (totalOutput <= 0) return;

    const actualSNE = totalWork / totalOutput;
    const prior = sneIndex.get(specId) ?? actualSNE;
    sneIndex.set(specId, alpha * actualSNE + (1 - alpha) * prior);
}

/**
 * Update SNE for a spec from a completed plan run by querying the Observer directly.
 *
 * For each process ID in the plan, collects:
 *   - `work` events → direct labor denominator (effortQuantity)
 *   - `produce` / `modify` events conforming to outputSpecId → output denominator (resourceQuantity)
 *
 * Then delegates to updateSNEFromActuals for the EMA blend.
 * No-op when total output quantity is zero (no events found or division-by-zero guard).
 *
 * **Event linkage requirement**: `observer.eventsForProcess` indexes events by their
 * `inputOf` / `outputOf` fields. Events recorded without these links are invisible here:
 *   - `work` events must have `inputOf` set (they are inputs to the process)
 *   - `produce` / `modify` events must have `outputOf` set (they are outputs of the process)
 * Omitting these links silently excludes the event and underestimates SNE.
 *
 * @param processIds   All process IDs in the plan that produced outputSpecId
 * @param outputSpecId ResourceSpecification ID of the plan's primary output
 * @param observer     Observer holding the recorded events
 * @param sneIndex     Index to update in-place
 * @param alpha        EMA weight for new observation — default 0.1 (slow-moving average)
 */
export function updateSNEFromPlan(
    processIds: string[],
    outputSpecId: string,
    observer: Observer,
    sneIndex: SNEIndex,
    alpha = 0.1,
): void {
    const workEvents: EconomicEvent[] = [];
    const outputEvents: EconomicEvent[] = [];

    for (const processId of processIds) {
        for (const event of observer.eventsForProcess(processId)) {
            if (event.action === 'work') {
                workEvents.push(event);
            } else if (
                (event.action === 'produce' || event.action === 'modify') &&
                event.resourceConformsTo === outputSpecId
            ) {
                outputEvents.push(event);
            }
        }
    }

    updateSNEFromActuals(outputSpecId, workEvents, outputEvents, sneIndex, alpha);
}
