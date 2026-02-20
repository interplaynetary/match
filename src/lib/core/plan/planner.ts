/**
 * Planner: Need-driven production planning
 *
 * Replaces the flat bucket-shuffling of optimizer.ts with a pipeline that:
 * 1. Extracts strategies from historical operations (each operation is a distinct strategy)
 * 2. Builds a feasible set (forward pass: what CAN we produce?)
 * 3. Plans from needs (backward pass: what SHOULD we produce?)
 * 4. Computes labor plan (time distribution across branches)
 * 5. Assembles the final production plan
 *
 * Key principle: strategies are NOT averaged. Small-batch bread and large-batch bread
 * are different strategies with different economies of scale.
 *
 * D2 (expansion) is emergent — it's where backward needs hit forward feasibility limits.
 *
 * Based on equations.md:
 * - Material balance: produced_i >= final_need_i + intermediate_need_i + reproduction_need_i
 * - First economic law: economy of time + planned distribution of labor time
 * - Objective: maximize T_free = T_total - T_necessary
 */

import type {
    StockBook,
    Operation,
    Product,
    Stock,
    Individual,
    AllocationPlan,
} from "./stockbook";
import {
    buildLaborIndex,
    queryLaborBySkill,
    getTotalHours,
    type LaborIndex,
    type PersonCapacity,
} from "./labor";
import { type Person } from "./person";

// ============================================================================
// TYPES
// ============================================================================

/** Statistical profile of a strategy's output for a specific product */
export interface OutputDistribution {
    productId: string;
    /** Mean output quantity across observations */
    mean: number;
    /** Standard deviation of output quantity */
    stddev: number;
    /** Coefficient of variation (stddev / mean) — higher = riskier */
    cv: number;
    /** Failure rate: fraction of observations that produced 0 or near-0 */
    failureRate: number;
    /** Mean yield rate: mean / nominal (< 1 means systematic underperformance) */
    yieldRate: number;
    /** Nominal (first-observed) output quantity */
    nominal: number;
    /** Source: 'observed' from historical data, 'custom' from manual override */
    source: "observed" | "custom";
}

/**
 * Custom probability record for overriding observed distributions.
 *
 * Use when you have external knowledge that historical data doesn't capture:
 * - Seasonal forecasts ("drought this year → wheat yield will be 30% lower")
 * - New equipment ("new oven is more reliable than old one")
 * - Known defects ("this batch of seed stock is contaminated")
 * - Expert assessment for new strategies with no history
 */
export interface CustomProbability {
    /** Override mean output (absolute quantity) */
    mean?: number;
    /** Override standard deviation */
    stddev?: number;
    /** Override failure rate (0-1) */
    failureRate?: number;
    /** Optional: reason for the override (for audit trail) */
    reason?: string;
}

/**
 * Operations grouped by input signature — each group IS a strategy.
 *
 * An operation is a strategy: a specific way of producing something at a
 * specific scale with specific inputs. When the same operation pattern is
 * repeated (same inputs/labor, possibly different outputs), the group
 * captures the statistical distribution of outcomes.
 *
 * Small-batch bread (5kg wheat → 10 loaves) and large-batch bread
 * (50kg wheat → 150 loaves) are different strategies because they have
 * different input signatures.
 */
export interface Strategy {
    /** Identifier (from source operation, or generated for grouped operations) */
    id: string;
    /** Nominal outputs (from representative operation's effects) */
    outputs: Array<{ productId: string; quantity: number }>;
    /** Material inputs per execution (constant — this defines the strategy) */
    inputs: Array<{ productId: string; quantity: number }>;
    /** Labor per execution (constant — this defines the strategy) */
    labor: Array<{ skill_id: string; hours: number }>;
    /** Nominal total social time */
    totalTime: number;
    /** Source operations — each is one execution of this strategy */
    operations: Operation[];
    /** Statistical distribution per output product (computed from operations) */
    outputDistributions: Record<string, OutputDistribution>;
    /** Custom probability overrides per output product (keyed by productId) */
    customProbabilities?: Record<string, CustomProbability>;
    /** How many times this pattern has been observed (= operations.length) */
    frequency: number;

    // --- Activation model ---

    /** Whether this strategy is currently available for production.
     *  Inactive strategies require an activation operation to be executed first. */
    active: boolean;
    /** Strategy IDs that this operation activates when executed.
     *  E.g. "build bakery" activates "large-batch bread". */
    activates?: string[];
    /** Strategy IDs that must have been executed (activated) before this can run.
     *  E.g. "large-batch bread" requires "build bakery". */
    requires?: string[];
}

/** Risk-adjusted cost of an activation path */
export interface ActivationPath {
    /** The activator strategy */
    strategy: Strategy;
    /** Material inputs needed */
    materials: Array<{ productId: string; quantity: number }>;
    /** Labor needed */
    labor: Array<{ skill_id: string; hours: number }>;
    /** Base social time */
    totalTime: number;
    /** Risk-adjusted time (accounts for activator's own variance/failure rate) */
    riskAdjustedTime: number;
}

/** A feasible strategy with execution bounds */
export interface FeasibleStrategy {
    strategy: Strategy;
    /** Max times executable given current stocks */
    maxExecutionsByMaterial: number;
    /** Max times executable given labor capacity */
    maxExecutionsByLabor: number;
    /** Effective max (min of the two) */
    maxExecutions: number;
    /** If inactive: the best activation path and alternatives considered */
    activationCost?: {
        /** The selected (cheapest) activation path */
        selected: ActivationPath;
        /** All activation paths considered, sorted by risk-adjusted cost */
        alternatives: ActivationPath[];
        /** Hard requirements from `requires` (must ALL be satisfied in addition) */
        hardRequirements: Strategy[];
        /** Total material inputs needed (selected path + hard requirements) */
        materials: Array<{ productId: string; quantity: number }>;
        /** Total labor needed (selected path + hard requirements) */
        labor: Array<{ skill_id: string; hours: number }>;
        /** Total one-time social time for activation */
        totalTime: number;
    };
}

/** Forward pass result: what's possible */
export interface FeasibleSet {
    strategies: FeasibleStrategy[];
    laborIndex: LaborIndex;  // Person-level capacity tracking
    /** Surplus: products/labor with unused capacity after all strategies at max */
    surplus: {
        materials: Record<string, number>;
        labor: Record<string, number>;
    };
}

/** Per-product need breakdown */
export interface ProductNeeds {
    productId: string;
    /** D4 + D5 + D6 end-product requirements */
    finalNeed: number;
    /** Inputs needed to produce final + intermediate goods */
    intermediateNeed: number;
    /** D1: depreciation replacement */
    reproductionNeed: number;
    /** D3: risk-adjusted insurance (derived from strategy variance + failure rates) */
    insuranceNeed: number;
    /** Sum of all four */
    totalNeed: number;
}

/** A selected strategy execution in the plan */
export interface SelectedStrategy {
    strategy: Strategy;
    /** How many times to execute */
    executions: number;
    /** Which need category drove this selection */
    purpose: "final" | "intermediate" | "reproduction";
}

/** Backward pass result: what we plan to do */
export interface PlannedProduction {
    /** Selected strategies and how many times to execute each */
    selectedStrategies: SelectedStrategy[];
    /** Need breakdown per product */
    needs: Record<string, ProductNeeds>;
    /** D2: where needs exceed feasible capacity */
    expansionSignals: Array<{
        productId: string;
        needed: number;
        feasible: number;
        gap: number;
    }>;
    /** Surplus capacity available for D5 growth */
    growthOpportunities: Array<{
        productId: string;
        surplusCapacity: number;
    }>;
}

/** Labor time distribution across branches */
export interface LaborPlan {
    branches: Array<{
        laborType: string;
        totalHours: number;
        available: number;
        surplus: number;
    }>;
    totalNecessaryTime: number;
    totalAvailableTime: number;
    freeTime: number;
    /** T_free / T_total */
    freeTimeRatio: number;
    bottlenecks: Array<{ laborType: string; deficit: number }>;
}

/** Input to the planner */
export interface PlannerInput {
    stockBook: StockBook;
    period: string;
    /** Final needs targets: what D4/D5/D6 actually require as end products */
    finalTargets: {
        D4_administration: Record<string, number>;
        D5_common_needs: Record<string, number>;
        D6_support: Record<string, number>;
    };
    /** D3 minimum risk factor floor (e.g. 0.10 for 10%). Actual insurance
     *  per product may be higher based on strategy variance and failure rates. */
    insuranceFactor: number;
    /** Planning horizon in days (default: 7) */
    horizonDays?: number;
    /** Additional strategies to consider (e.g. inactive strategies that could be
     *  activated, or manually defined strategies not yet in the stock-book). */
    additionalStrategies?: Strategy[];
}

/** Complete output of the planner */
export interface ProductionPlan {
    period: string;
    strategies: Strategy[];
    feasibleSet: FeasibleSet;
    production: PlannedProduction;
    laborPlan: LaborPlan;
    /** Backward-compatible allocation plan */
    allocationPlan: AllocationPlan;
    diagnostics: {
        feasible: boolean;
        violations: string[];
        freeTimeRatio: number;
    };
}

// ============================================================================
// PHASE 1: EXTRACT STRATEGIES
// ============================================================================

/**
 * Fingerprint an operation by its INPUT signature only (material inputs + labor).
 * Operations with the same inputs but different outputs are the SAME strategy
 * with different observed outcomes.
 */
function inputFingerprint(op: Operation): string {
    const inputs = op.inputsProducts
        .map((i) => `${i.productId}:${i.quantity}`)
        .sort()
        .join(",");
    const labor = op.inputsLabor
        .map((l) => `${l.workType || "general"}:${l.hours}`)
        .sort()
        .join(",");
    return `${inputs}|${labor}`;
}

/** Compute standard deviation from an array of numbers */
function computeStddev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const sumSqDiff = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return Math.sqrt(sumSqDiff / (values.length - 1));
}

/** Compute output distributions from a set of operations (each = one execution) */
function computeDistributions(
    operations: Operation[],
    nominalOutputs: Array<{ productId: string; quantity: number }>
): Record<string, OutputDistribution> {
    const distributions: Record<string, OutputDistribution> = {};

    for (const nominal of nominalOutputs) {
        const quantities = operations.map((op) => {
            const found = op.effects.find(
                (e) => e.productId === nominal.productId
            );
            return found?.quantity ?? 0;
        });

        const mean =
            quantities.reduce((s, v) => s + v, 0) / quantities.length;
        const sd = computeStddev(quantities, mean);
        const failureCount = quantities.filter(
            (q) => q <= nominal.quantity * 0.05
        ).length;

        distributions[nominal.productId] = {
            productId: nominal.productId,
            mean,
            stddev: sd,
            cv: mean > 0 ? sd / mean : Infinity,
            failureRate: quantities.length > 0 ? failureCount / quantities.length : 0,
            yieldRate: nominal.quantity > 0 ? mean / nominal.quantity : 0,
            nominal: nominal.quantity,
            source: "observed",
        };
    }

    return distributions;
}

/**
 * Apply custom probability overrides to a strategy's distributions.
 *
 * Custom overrides take precedence over observed data. Partial overrides
 * are supported — you can override just the mean, just the failure rate, etc.
 * Derived fields (cv, yieldRate) are recomputed from the effective values.
 */
export function applyCustomProbabilities(
    strategy: Strategy,
    customProbabilities: Record<string, CustomProbability>
): Strategy {
    const newDistributions = { ...strategy.outputDistributions };

    for (const [productId, custom] of Object.entries(customProbabilities)) {
        const existing = newDistributions[productId];
        const nominal = strategy.outputs.find(
            (o) => o.productId === productId
        )?.quantity ?? 0;

        if (existing) {
            // Merge: custom overrides specific fields
            const mean = custom.mean ?? existing.mean;
            const sd = custom.stddev ?? existing.stddev;
            const failureRate = custom.failureRate ?? existing.failureRate;

            newDistributions[productId] = {
                ...existing,
                mean,
                stddev: sd,
                cv: mean > 0 ? sd / mean : Infinity,
                failureRate,
                yieldRate: nominal > 0 ? mean / nominal : 0,
                source: "custom",
            };
        } else {
            // No observed data — create from custom values + nominal
            const mean = custom.mean ?? nominal;
            const sd = custom.stddev ?? 0;
            const failureRate = custom.failureRate ?? 0;

            newDistributions[productId] = {
                productId,
                mean,
                stddev: sd,
                cv: mean > 0 ? sd / mean : Infinity,
                failureRate,
                yieldRate: nominal > 0 ? mean / nominal : 0,
                nominal,
                source: "custom",
            };
        }
    }

    return {
        ...strategy,
        outputDistributions: newDistributions,
        customProbabilities,
    };
}

/**
 * Phase 1: Extract strategies from historical operations.
 *
 * Groups operations by INPUT signature (same material inputs + same labor).
 * Different outcomes from the same inputs are observations of the same strategy,
 * giving us the statistical distribution of outputs (mean, variance, failure rate).
 *
 * Different input scales remain separate strategies — small-batch bread (5kg wheat)
 * and large-batch bread (50kg wheat) are different strategies.
 */
export function extractStrategies(operations: Operation[]): Strategy[] {
    const grouped = new Map<string, Operation[]>();

    for (const op of operations) {
        const fp = inputFingerprint(op);
        const existing = grouped.get(fp);
        if (existing) {
            existing.push(op);
        } else {
            grouped.set(fp, [op]);
        }
    }

    const strategies: Strategy[] = [];

    for (const [, ops] of grouped) {
        const representative = ops[0];

        // Nominal outputs from representative operation
        const nominalOutputs = representative.effects.map((e) => ({
            productId: e.productId,
            quantity: e.quantity,
        }));

        const distributions = computeDistributions(ops, nominalOutputs);

        strategies.push({
            id:
                ops.length === 1
                    ? representative.id
                    : `${representative.id}+${ops.length - 1}`,
            outputs: nominalOutputs,
            inputs: representative.inputsProducts.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
            })),
            labor: representative.inputsLabor.map((l) => ({
                skill_id: l.workType || "general",
                hours: l.hours,
            })),
            totalTime: representative.totalSocialTime,
            operations: ops,
            outputDistributions: distributions,
            frequency: ops.length,
            active: true, // Observed operations are active by definition
        });
    }

    return strategies;
}

// ============================================================================
// PHASE 2: BUILD FEASIBLE SET (FORWARD PASS)
// ============================================================================

/**
 * Compute the risk-adjusted cost of using a strategy as an activator.
 *
 * An activator with high failure rate or variance effectively costs more
 * because it might fail and need to be retried.
 */
function activatorRiskAdjustedTime(activator: Strategy): number {
    // Base cost is the strategy's total time
    let cost = activator.totalTime;

    // Apply risk premium from the activator's own output distributions
    // (an activator that might fail is more expensive)
    const dists = Object.values(activator.outputDistributions);
    if (dists.length > 0) {
        let maxCV = 0;
        let maxFailure = 0;
        for (const dist of dists) {
            maxCV = Math.max(maxCV, dist.cv);
            maxFailure = Math.max(maxFailure, dist.failureRate);
        }
        // Same risk formula as strategyEfficiency
        const riskPremium = 1 + maxCV;
        const failurePenalty = maxFailure < 1 ? 1 / (1 - maxFailure) : Infinity;
        cost *= riskPremium * failurePenalty;
    }

    return cost;
}

/** Build an ActivationPath from a strategy */
function toActivationPath(s: Strategy): ActivationPath {
    return {
        strategy: s,
        materials: [...s.inputs],
        labor: [...s.labor],
        totalTime: s.totalTime,
        riskAdjustedTime: activatorRiskAdjustedTime(s),
    };
}

/**
 * Compute max executions by labor using LaborIndex.
 * Queries person-level capacity for each required skill.
 */
function computeMaxByLabor(strategy: Strategy, laborIndex: LaborIndex): number {
    if (strategy.labor.length === 0) {
        return Infinity;
    }

    let maxExecutions = Infinity;

    for (const labor of strategy.labor) {
        // Query persons with this skill
        const capacities = queryLaborBySkill(laborIndex, labor.skill_id);
        const totalHours = getTotalHours(capacities);

        if (labor.hours > 0) {
            maxExecutions = Math.min(
                maxExecutions,
                Math.floor(totalHours / labor.hours)
            );
        }
    }

    return maxExecutions === Infinity ? 0 : maxExecutions;
}

// ============================================================================
// FEASIBILITY
// ============================================================================

/**
 * Phase 2: Build the feasible set — what CAN we do?
 *
 * For each strategy, compute how many times it could execute given:
 * - Current material stocks
 * - Available labor capacity over the planning horizon
 * - Whether the strategy is active or requires activation first
 *
 * Inactive strategies are included with their activation costs computed,
 * so the backward pass can decide whether activating them is worthwhile.
 */
export function buildFeasibleSet(
    strategies: Strategy[],
    stocks: Record<string, Stock>,
    persons: Person[],
    horizonDays: number = 7
): FeasibleSet {
    // Build lookup for activation resolution
    const strategyById = new Map<string, Strategy>();
    for (const s of strategies) {
        strategyById.set(s.id, s);
    }

    // Build reverse map: targetId → [activator strategies]
    // Any strategy with `activates: ["X"]` is a potential activator for X
    const activatorsFor = new Map<string, Strategy[]>();
    for (const s of strategies) {
        if (s.activates) {
            for (const targetId of s.activates) {
                const existing = activatorsFor.get(targetId);
                if (existing) {
                    existing.push(s);
                } else {
                    activatorsFor.set(targetId, [s]);
                }
            }
        }
    }

    // Build labor index (person-level capacity tracking)
    const timeWindow = {
        start: new Date(),
        end: new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000),
    };
    const laborIndex = buildLaborIndex(persons, timeWindow);

    const feasibleStrategies: FeasibleStrategy[] = [];

    for (const strategy of strategies) {
        // Max executions by material
        let maxByMaterial = Infinity;
        for (const input of strategy.inputs) {
            const available = stocks[input.productId]?.quantity ?? 0;
            if (input.quantity > 0) {
                maxByMaterial = Math.min(
                    maxByMaterial,
                    Math.floor(available / input.quantity)
                );
            }
        }
        if (strategy.inputs.length === 0) {
            maxByMaterial = Infinity;
        }

        // Max executions by labor (use LaborIndex)
        const maxByLabor = computeMaxByLabor(strategy, laborIndex);

        const effectiveMax = Math.min(maxByMaterial, maxByLabor);

        // Compute activation cost for inactive strategies
        let activationCost: FeasibleStrategy["activationCost"];
        if (!strategy.active) {
            // Discover all possible activators from the reverse map
            const possibleActivators = activatorsFor.get(strategy.id) ?? [];

            // Build activation paths, sorted by risk-adjusted cost (cheapest first)
            const alternatives = possibleActivators
                .map(toActivationPath)
                .sort((a, b) => a.riskAdjustedTime - b.riskAdjustedTime);

            // Hard requirements: strategies explicitly listed in `requires`
            // These must be satisfied IN ADDITION to the best activator path
            const hardRequirements: Strategy[] = [];
            if (strategy.requires?.length) {
                for (const reqId of strategy.requires) {
                    // Only include as hard requirement if it's not already an activator
                    const isActivator = possibleActivators.some((a) => a.id === reqId);
                    if (!isActivator) {
                        const req = strategyById.get(reqId);
                        if (req) hardRequirements.push(req);
                    }
                }
            }

            // If we have at least one activator OR hard requirements, build the cost
            if (alternatives.length > 0 || hardRequirements.length > 0) {
                const selected = alternatives[0]; // cheapest by risk-adjusted cost

                const totalMaterials: Array<{ productId: string; quantity: number }> = [];
                const totalLabor: Array<{ skill_id: string; hours: number }> = [];
                let totalTime = 0;

                // Add selected activator cost
                if (selected) {
                    totalMaterials.push(...selected.materials);
                    totalLabor.push(...selected.labor);
                    totalTime += selected.totalTime;
                }

                // Add hard requirement costs
                for (const req of hardRequirements) {
                    totalMaterials.push(...req.inputs);
                    totalLabor.push(...req.labor);
                    totalTime += req.totalTime;
                }

                activationCost = {
                    selected: selected ?? toActivationPath(hardRequirements[0]),
                    alternatives,
                    hardRequirements,
                    materials: totalMaterials,
                    labor: totalLabor,
                    totalTime,
                };
            }
        }

        feasibleStrategies.push({
            strategy,
            maxExecutionsByMaterial: maxByMaterial === Infinity ? Infinity : maxByMaterial,
            maxExecutionsByLabor: maxByLabor === Infinity ? Infinity : maxByLabor,
            maxExecutions: effectiveMax === Infinity ? 0 : effectiveMax,
            activationCost,
        });
    }

    // Compute surplus (materials and labor not used if no strategies executed)
    const materialSurplus: Record<string, number> = {};
    for (const [productId, stock] of Object.entries(stocks)) {
        materialSurplus[productId] = stock.quantity;
    }

    // Compute labor surplus by skill from LaborIndex
    const laborSurplus: Record<string, number> = {};
    for (const [skillId, capacityIds] of laborIndex.skill_index.entries()) {
        const capacities = Array.from(capacityIds).map(id => laborIndex.person_capacities.get(id)!);
        laborSurplus[skillId] = getTotalHours(capacities);
    }

    return {
        strategies: feasibleStrategies,
        laborIndex,  // Include for downstream use
        surplus: {
            materials: materialSurplus,
            labor: laborSurplus,
        },
    };
}

// ============================================================================
// PHASE 3: PLAN FROM NEEDS (BACKWARD PASS)
// ============================================================================

/**
 * Get the expected (risk-adjusted) output of a strategy for a product.
 *
 * Uses mean output from observations when available, falls back to nominal.
 * This is the real expected yield per execution — not the ideal case.
 */
function expectedOutput(strategy: Strategy, productId: string): number {
    const dist = strategy.outputDistributions[productId];
    if (dist && dist.mean > 0) return dist.mean;
    const nominal = strategy.outputs.find((o) => o.productId === productId);
    return nominal?.quantity ?? 0;
}

/**
 * Compute risk-adjusted efficiency of a strategy for producing a specific product.
 *
 * Lower total time per expected unit of output = more efficient.
 * Accounts for: mean yield (not nominal), failure rate, and output variance.
 *
 * A strategy that nominally produces 100 but averages 80 with high variance
 * is less efficient than one that nominally produces 90 but averages 88 reliably.
 */
function strategyEfficiency(
    fs: FeasibleStrategy,
    productId: string
): number {
    const expected = expectedOutput(fs.strategy, productId);
    if (expected === 0) return Infinity;

    const dist = fs.strategy.outputDistributions[productId];
    const baseEfficiency = fs.strategy.totalTime / expected;

    if (!dist || dist.cv === 0) return baseEfficiency;

    // Penalize high variance: effective cost includes risk premium
    // A strategy with CV=0.3 costs 30% more in effective time than its base rate
    // because you need to run it more times to reliably get what you need
    const riskPremium = 1 + dist.cv;

    // Penalize failure rate: if 10% of executions fail, effective cost is 1/(1-0.1) higher
    const failurePenalty = dist.failureRate < 1 ? 1 / (1 - dist.failureRate) : Infinity;

    return baseEfficiency * riskPremium * failurePenalty;
}

/**
 * Phase 3: Plan from needs — backward pass navigating the feasible set.
 *
 * 1. Start with final needs (D4 + D5 + D6)
 * 2. Find feasible strategies that produce needed products
 * 3. Select most efficient strategies
 * 4. Strategy inputs become intermediate needs → recurse
 * 5. Compute reproduction needs (D1) from depreciation
 * 6. Apply insurance (D3)
 * 7. Where needs exceed feasibility → D2 expansion signals
 * 8. Where surplus remains → D5 growth opportunities
 */
export function planFromNeeds(
    finalTargets: PlannerInput["finalTargets"],
    feasibleSet: FeasibleSet,
    stocks: Record<string, Stock>,
    products: Record<string, Product>,
    insuranceFactor: number,
    horizonDays: number = 7
): PlannedProduction {
    const selectedStrategies: SelectedStrategy[] = [];
    const needs: Record<string, ProductNeeds> = {};
    const expansionSignals: PlannedProduction["expansionSignals"] = [];

    // Track remaining capacity as we allocate strategies
    const remainingMaterials: Record<string, number> = {};
    for (const [productId, stock] of Object.entries(stocks)) {
        remainingMaterials[productId] = stock.quantity;
    }

    const remainingLabor: Record<string, number> = {
        ...feasibleSet.surplus.labor,
    };

    // Merge final targets into a single need map
    const finalNeeds: Record<string, number> = {};
    for (const targets of [
        finalTargets.D4_administration,
        finalTargets.D5_common_needs,
        finalTargets.D6_support,
    ]) {
        for (const [productId, qty] of Object.entries(targets)) {
            finalNeeds[productId] = (finalNeeds[productId] || 0) + qty;
        }
    }

    // Initialize needs
    for (const [productId, qty] of Object.entries(finalNeeds)) {
        needs[productId] = {
            productId,
            finalNeed: qty,
            intermediateNeed: 0,
            reproductionNeed: 0,
            insuranceNeed: 0,
            totalNeed: 0,
        };
    }

    // Helper: find and select strategies to produce a given quantity of a product
    function selectStrategies(
        productId: string,
        quantityNeeded: number,
        purpose: SelectedStrategy["purpose"]
    ): { produced: number; intermediateInputs: Array<{ productId: string; quantity: number }> } {
        if (quantityNeeded <= 0) return { produced: 0, intermediateInputs: [] };

        // First, use available stock
        const fromStock = Math.min(
            remainingMaterials[productId] || 0,
            quantityNeeded
        );
        remainingMaterials[productId] =
            (remainingMaterials[productId] || 0) - fromStock;
        let remaining = quantityNeeded - fromStock;

        if (remaining <= 0) return { produced: quantityNeeded, intermediateInputs: [] };

        // Find feasible strategies that produce this product
        // Include both active and inactive (inactive will have activation cost deducted)
        const candidates = feasibleSet.strategies
            .filter((fs) =>
                fs.strategy.outputs.some((o) => o.productId === productId)
            )
            .sort(
                (a, b) =>
                    strategyEfficiency(a, productId) -
                    strategyEfficiency(b, productId)
            );

        let totalProduced = fromStock;
        const allIntermediateInputs: Array<{ productId: string; quantity: number }> = [];

        for (const candidate of candidates) {
            if (remaining <= 0) break;

            // If inactive, pay activation cost first
            if (!candidate.strategy.active && candidate.activationCost) {
                const ac = candidate.activationCost;

                // Check if we can afford activation
                let canActivate = true;
                for (const mat of ac.materials) {
                    if ((remainingMaterials[mat.productId] || 0) < mat.quantity) {
                        canActivate = false;
                        break;
                    }
                }
                for (const lab of ac.labor) {
                    if (canActivate && (remainingLabor[lab.skill_id] || 0) < lab.hours) {
                        canActivate = false;
                        break;
                    }
                }

                if (!canActivate) continue; // Skip — can't afford to activate

                // Pay activation cost (one-time)
                for (const mat of ac.materials) {
                    remainingMaterials[mat.productId] =
                        (remainingMaterials[mat.productId] || 0) - mat.quantity;
                    allIntermediateInputs.push({
                        productId: mat.productId,
                        quantity: mat.quantity,
                    });
                }
                for (const lab of ac.labor) {
                    remainingLabor[lab.skill_id] =
                        (remainingLabor[lab.skill_id] || 0) - lab.hours;
                }

                // Record selected activator
                if (ac.selected) {
                    selectedStrategies.push({
                        strategy: ac.selected.strategy,
                        executions: 1,
                        purpose,
                    });
                }

                // Record hard requirements
                for (const reqStrategy of ac.hardRequirements) {
                    selectedStrategies.push({
                        strategy: reqStrategy,
                        executions: 1,
                        purpose,
                    });
                }
            }

            // Use expected (risk-adjusted) output, not nominal
            const perExecution = expectedOutput(candidate.strategy, productId);
            if (perExecution === 0) continue;

            // How many executions to EXPECT the quantity we need?
            // With variance, we need more executions to reliably hit the target.
            // Plan for mean - 1 stddev to get ~84% confidence.
            const dist = candidate.strategy.outputDistributions[productId];
            const safePerExecution = dist && dist.stddev > 0
                ? Math.max(perExecution - dist.stddev, perExecution * 0.5)
                : perExecution;
            const executionsNeeded = Math.ceil(remaining / safePerExecution);

            // How many can we actually do given remaining resources?
            let maxExec = executionsNeeded;

            // Check material constraints
            for (const input of candidate.strategy.inputs) {
                const available = remainingMaterials[input.productId] || 0;
                if (input.quantity > 0) {
                    maxExec = Math.min(
                        maxExec,
                        Math.floor(available / input.quantity)
                    );
                }
            }

            // Check labor constraints
            for (const lab of candidate.strategy.labor) {
                const available = remainingLabor[lab.skill_id] || 0;
                if (lab.hours > 0) {
                    maxExec = Math.min(
                        maxExec,
                        Math.floor(available / lab.hours)
                    );
                }
            }

            if (maxExec <= 0) continue;

            // Execute the strategy
            const executions = Math.min(maxExec, executionsNeeded);

            // Consume inputs
            for (const input of candidate.strategy.inputs) {
                remainingMaterials[input.productId] =
                    (remainingMaterials[input.productId] || 0) -
                    input.quantity * executions;
                allIntermediateInputs.push({
                    productId: input.productId,
                    quantity: input.quantity * executions,
                });
            }

            // Consume labor
            for (const lab of candidate.strategy.labor) {
                remainingLabor[lab.skill_id] =
                    (remainingLabor[lab.skill_id] || 0) - lab.hours * executions;
            }

            // Record production using EXPECTED output (not nominal)
            for (const out of candidate.strategy.outputs) {
                const expectedQty = expectedOutput(candidate.strategy, out.productId);
                if (out.productId === productId) {
                    totalProduced += expectedQty * executions;
                    remaining -= expectedQty * executions;
                } else {
                    // Co-products go to stock (at expected rate)
                    remainingMaterials[out.productId] =
                        (remainingMaterials[out.productId] || 0) +
                        expectedQty * executions;
                }
            }

            selectedStrategies.push({
                strategy: candidate.strategy,
                executions,
                purpose,
            });
        }

        return { produced: totalProduced, intermediateInputs: allIntermediateInputs };
    }

    // Step 1: Satisfy final needs
    for (const [productId, qty] of Object.entries(finalNeeds)) {
        const result = selectStrategies(productId, qty, "final");

        if (result.produced < qty) {
            expansionSignals.push({
                productId,
                needed: qty,
                feasible: result.produced,
                gap: qty - result.produced,
            });
        }

        // Record intermediate needs from strategy inputs
        for (const input of result.intermediateInputs) {
            if (!needs[input.productId]) {
                needs[input.productId] = {
                    productId: input.productId,
                    finalNeed: 0,
                    intermediateNeed: 0,
                    reproductionNeed: 0,
                    insuranceNeed: 0,
                    totalNeed: 0,
                };
            }
            needs[input.productId].intermediateNeed += input.quantity;
        }
    }

    // Step 2: Satisfy intermediate needs (may require further production)
    // Iterate to handle chains (bread needs wheat, which may need farming)
    const MAX_ITERATIONS = 10;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let newIntermediateNeeds = false;

        for (const [productId, need] of Object.entries(needs)) {
            const unsatisfied = need.intermediateNeed - (need.finalNeed > 0 ? 0 : 0);
            // Check if we already produced enough through earlier strategy selections
            // The intermediate needs were consumed from stock during strategy selection
            // Additional production is only needed if stock went negative
            if ((remainingMaterials[productId] || 0) < 0) {
                const deficit = Math.abs(remainingMaterials[productId] || 0);
                const result = selectStrategies(productId, deficit, "intermediate");

                if (result.produced < deficit) {
                    const existing = expansionSignals.find(
                        (e) => e.productId === productId
                    );
                    if (!existing) {
                        expansionSignals.push({
                            productId,
                            needed: deficit,
                            feasible: result.produced,
                            gap: deficit - result.produced,
                        });
                    }
                }

                // Record new intermediate needs
                for (const input of result.intermediateInputs) {
                    if (!needs[input.productId]) {
                        needs[input.productId] = {
                            productId: input.productId,
                            finalNeed: 0,
                            intermediateNeed: 0,
                            reproductionNeed: 0,
                            insuranceNeed: 0,
                            totalNeed: 0,
                        };
                    }
                    needs[input.productId].intermediateNeed += input.quantity;
                    newIntermediateNeeds = true;
                }
            }
        }

        if (!newIntermediateNeeds) break;
    }

    // Step 3: Compute reproduction needs (D1)
    const horizonHours = horizonDays * 24;
    for (const [productId, product] of Object.entries(products)) {
        if (!product.lifespan) continue;

        const currentStock = stocks[productId]?.quantity ?? 0;
        if (currentStock === 0) continue;

        // Depreciation over the planning horizon
        const depreciation = (currentStock * horizonHours) / product.lifespan;

        if (!needs[productId]) {
            needs[productId] = {
                productId,
                finalNeed: 0,
                intermediateNeed: 0,
                reproductionNeed: 0,
                insuranceNeed: 0,
                totalNeed: 0,
            };
        }
        needs[productId].reproductionNeed = depreciation;

        // Try to produce reproduction needs
        selectStrategies(productId, depreciation, "reproduction");
    }

    // Step 4: Apply insurance (D3)
    // Insurance is per-product, derived from the actual risk of strategies used.
    // Products produced by high-variance strategies need more insurance.
    // The base insuranceFactor acts as a floor for products with no statistical data.
    for (const need of Object.values(needs)) {
        const base = need.finalNeed + need.intermediateNeed + need.reproductionNeed;

        // Find the strategies that were selected to produce this product
        const relevantStrategies = selectedStrategies.filter((s) =>
            s.strategy.outputs.some((o) => o.productId === need.productId)
        );

        // Compute risk-weighted insurance from strategy distributions
        let productRisk = insuranceFactor; // floor
        if (relevantStrategies.length > 0) {
            // Weighted average CV across strategies used for this product
            let totalExecs = 0;
            let weightedCV = 0;
            let weightedFailure = 0;
            for (const sel of relevantStrategies) {
                const dist = sel.strategy.outputDistributions[need.productId];
                if (dist) {
                    weightedCV += dist.cv * sel.executions;
                    weightedFailure += dist.failureRate * sel.executions;
                    totalExecs += sel.executions;
                }
            }
            if (totalExecs > 0) {
                const avgCV = weightedCV / totalExecs;
                const avgFailure = weightedFailure / totalExecs;
                // Risk = max(base factor, CV + failure rate)
                // CV captures variance, failure rate captures total-loss risk
                productRisk = Math.max(insuranceFactor, avgCV + avgFailure);
            }
        }

        need.insuranceNeed = base * productRisk;
        need.totalNeed = base + need.insuranceNeed;
    }

    // Step 5: Compute growth opportunities from surplus
    const growthOpportunities: PlannedProduction["growthOpportunities"] = [];
    for (const [productId, remaining] of Object.entries(remainingMaterials)) {
        if (remaining > 0) {
            growthOpportunities.push({
                productId,
                surplusCapacity: remaining,
            });
        }
    }

    return {
        selectedStrategies,
        needs,
        expansionSignals,
        growthOpportunities,
    };
}

// ============================================================================
// PHASE 4: COMPUTE LABOR PLAN
// ============================================================================

/**
 * Phase 4: Convert selected strategies to labor time distribution.
 *
 * Computes T_free = T_total - T_necessary where T_necessary is the sum of
 * all labor hours across selected strategy executions.
 */
export function computeLaborPlan(
    production: PlannedProduction,
    laborIndex: LaborIndex,
    horizonDays: number
): LaborPlan {
    // Sum labor by type from selected strategies
    const laborByType: Record<string, number> = {};
    for (const selected of production.selectedStrategies) {
        for (const lab of selected.strategy.labor) {
            laborByType[lab.skill_id] =
                (laborByType[lab.skill_id] || 0) + lab.hours * selected.executions;
        }
    }

    // Compute available labor capacity from LaborIndex
    const laborCapacity: Record<string, number> = {};
    for (const [skillId, capacityIds] of laborIndex.skill_index.entries()) {
        const capacities = Array.from(capacityIds).map(id => laborIndex.person_capacities.get(id)!);
        laborCapacity[skillId] = getTotalHours(capacities);
    }

    // Build branches
    const allTypes = new Set([
        ...Object.keys(laborByType),
        ...Object.keys(laborCapacity),
    ]);

    const branches: LaborPlan["branches"] = [];
    const bottlenecks: LaborPlan["bottlenecks"] = [];

    let totalNecessaryTime = 0;
    let totalAvailableTime = 0;

    for (const type of allTypes) {
        const required = laborByType[type] || 0;
        const available = laborCapacity[type] || 0;
        const surplus = available - required;

        branches.push({
            laborType: type,
            totalHours: required,
            available,
            surplus,
        });

        totalNecessaryTime += required;
        totalAvailableTime += available;

        if (surplus < 0) {
            bottlenecks.push({ laborType: type, deficit: Math.abs(surplus) });
        }
    }

    const freeTime = totalAvailableTime - totalNecessaryTime;

    return {
        branches,
        totalNecessaryTime,
        totalAvailableTime,
        freeTime,
        freeTimeRatio:
            totalAvailableTime > 0 ? freeTime / totalAvailableTime : 0,
        bottlenecks,
    };
}

// ============================================================================
// PHASE 5: ASSEMBLE PLAN
// ============================================================================

/**
 * Phase 5: Assemble the final production plan.
 *
 * Generates an AllocationPlan for backward compatibility with stockbook.ts.
 */
export function assemblePlan(
    input: PlannerInput,
    strategies: Strategy[],
    feasibleSet: FeasibleSet,
    production: PlannedProduction,
    laborPlan: LaborPlan
): ProductionPlan {
    // Build AllocationPlan for backward compatibility
    const productAllocations = Object.values(production.needs).map((need) => ({
        productId: need.productId,
        plannedQty: need.totalNeed,
        minQty: need.finalNeed + need.intermediateNeed + need.reproductionNeed,
        maxQty: need.totalNeed * 1.1, // 10% buffer above insured amount
    }));

    const laborAllocations = laborPlan.branches
        .filter((b) => b.totalHours > 0)
        .map((b) => ({
            individualId: `branch_${b.laborType}`,
            plannedHours: b.totalHours,
            workType: b.laborType,
        }));

    const allocationPlan: AllocationPlan = {
        id: `PLAN_${input.period}`,
        period: input.period,
        createdAt: new Date(),
        productAllocations,
        laborAllocations,
        status:
            production.expansionSignals.length === 0 && laborPlan.bottlenecks.length === 0
                ? "planned"
                : "adjusted",
    };

    return {
        period: input.period,
        strategies,
        feasibleSet,
        production,
        laborPlan,
        allocationPlan,
        diagnostics: {
            feasible:
                production.expansionSignals.length === 0 &&
                laborPlan.bottlenecks.length === 0,
            violations: [
                ...production.expansionSignals.map(
                    (e) =>
                        `Expansion needed: ${e.productId} — need ${e.needed}, can produce ${e.feasible} (gap: ${e.gap})`
                ),
                ...laborPlan.bottlenecks.map(
                    (b) =>
                        `Labor bottleneck: ${b.laborType} — deficit ${b.deficit}h`
                ),
            ],
            freeTimeRatio: laborPlan.freeTimeRatio,
        },
    };
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Main entry point: run the complete planning pipeline.
 *
 * StockBook → Strategies → Feasible Set → Planned Production → Labor Plan → Plan
 */
export function plan(input: PlannerInput): ProductionPlan {
    const horizonDays = input.horizonDays ?? 7;

    // Phase 1: Extract strategies from operations + merge additional strategies
    const observedStrategies = extractStrategies(input.stockBook.operations);
    const strategies = [...observedStrategies, ...(input.additionalStrategies ?? [])];

    // Convert individuals to persons
    const persons: Person[] = Object.values(input.stockBook.individuals).map(ind => ({
        id: ind.id,
        name: ind.name,
        skills: ind.laborPowers.map(lp => ({ id: lp.skill_id, level: 1 })),
        hours_per_day: ind.laborPowers[0]?.hoursPerDay,
        skills_inventory: ind.skillsInventory,
    }));

    // Phase 2: Build feasible set
    const feasibleSet = buildFeasibleSet(
        strategies,
        input.stockBook.stocks,
        persons,
        horizonDays
    );

    // Phase 3: Plan from needs (backward pass)
    const production = planFromNeeds(
        input.finalTargets,
        feasibleSet,
        input.stockBook.stocks,
        input.stockBook.products,
        input.insuranceFactor,
        horizonDays
    );

    // Phase 4: Compute labor plan (use laborIndex from feasibleSet)
    const laborPlan = computeLaborPlan(
        production,
        feasibleSet.laborIndex,
        horizonDays
    );

    // Phase 5: Assemble
    return assemblePlan(input, strategies, feasibleSet, production, laborPlan);
}
