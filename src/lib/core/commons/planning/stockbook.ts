/**
 * Commons: Core data structures for communal production accounting
 * 
 * Based on:
 * - stockbook.md: Recording layer (what actually happened)
 * - allocation-planning.md: Planning layer (what should happen)
 * 
 * Two-tier resource model:
 * - ProductType: Generic catalog (ALT, lifespan, no space-time)
 * - ResourceInstance: Specific instances (from matching/slot.ts, with space-time constraints)
 * - Stock: Inventory aggregation by ProductType
 * 
 * Key principles:
 * - Just record operations (who, what, how long, inputs, outputs)
 * - Everything else (intensity, efficiency, categories) emerges from analysis
 */

import { z } from "zod";
import { Resource as ResourceInstance } from '../matching/slot';

// ============================================================================
// CORE PRIMITIVES
// ============================================================================

/**
 * ProductType: Generic catalog entry for what can be produced
 * 
 * Represents the TYPE of product, not specific instances.
 * Contains production metrics (ALT, lifespan) but no space-time constraints.
 * 
 * Examples:
 * - "Bread (generic): ALT=2h, lifespan=72h"
 * - "Steel beam: ALT=10h, lifespan=50 years"
 * 
 * For specific instances with space-time constraints, see ResourceInstance
 * from src/lib/core/process.ts
 */
export const ProductTypeSchema = z.object({
    id: z.string(),
    name: z.string(),
    unit: z.string(),
    
    /** Average Labor Time embodied (computed from operations) */
    alt: z.number().nonnegative().optional(),
    
    /** Lifespan in hours (for depreciation), undefined for consumables */
    lifespan: z.number().positive().optional(),
    
    /** Category for grouping (e.g., "food", "equipment", "materials") */
    category: z.string().optional(),
    
    /** Physical properties */
    is_consumable: z.boolean().default(true),
    is_durable: z.boolean().default(false),
});

export type ProductType = z.infer<typeof ProductTypeSchema>;

/**
 * @deprecated Use ProductType instead. Kept for backward compatibility.
 */
export const ProductSchema = ProductTypeSchema;
export type Product = ProductType;

/**
 * Individual (worker/consumer)
 */
export const IndividualSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** System 1: Daily Capacity */
    laborPowers: z.array(z.object({
        skill_id: z.string(),
        hoursPerDay: z.number().positive(),
    })),
    /** System 2: Long-term Skill Inventory (Remaining Hours) */
    skillsInventory: z.record(z.string(), z.number().nonnegative()),
});

export type Individual = z.infer<typeof IndividualSchema>;

// ============================================================================
// OPERATIONS (Recording Layer - Stock-Book)
// ============================================================================

/**
 * Operation: The fundamental unit of recording
 * 
 * Records what actually happened:
 * - Who participated
 * - What was consumed (inputs)
 * - What was produced (outputs)
 * - How long it took (total social time)
 * 
 * NO categorization, NO intensity tracking during recording
 */
export const OperationSchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    /** Total social time spent (sum of all participant hours) */
    totalSocialTime: z.number().nonnegative(),
    description: z.string().optional(),

    /** Product inputs consumed */
    inputsProducts: z.array(z.object({
        productId: z.string(),
        quantity: z.number().nonnegative(),
        /** ALT at time of consumption */
        alt: z.number().nonnegative().optional(),
    })),

    /** Labor inputs (participants) */
    inputsLabor: z.array(z.object({
        individualId: z.string(),
        hours: z.number().nonnegative(),
        /** Type of work performed */
        workType: z.string().optional(),
    })),

    /** Effects (State Changes/VCs produced) */
    effects: z.array(z.object({
        productId: z.string(),
        quantity: z.number().nonnegative(),
        /** Optional: specific attribute changed if not stock quantity */
        attribute: z.string().optional(),
    })),
});

export type Operation = z.infer<typeof OperationSchema>;

/**
 * Stock: Current inventory of a ProductType
 * 
 * Aggregates quantities of generic products (not specific instances).
 * For bookable/allocatable instances with space-time constraints,
 * use ResourceInstance from process.ts
 */
export const StockSchema = z.object({
    /** References ProductType.id */
    product_type_id: z.string(),
    
    quantity: z.number().nonnegative(),
    
    /** Remaining life for durable goods (total hours) */
    remainingLife: z.number().nonnegative().optional(),
    
    /** Last updated timestamp */
    lastUpdated: z.date(),
    
    /** Optional: location where stock is held */
    location_id: z.string().optional(),
});

export type Stock = z.infer<typeof StockSchema>;

/**
 * @deprecated Use product_type_id instead of productId
 */
export const LegacyStockSchema = StockSchema.extend({
    productId: z.string(),
}).omit({ product_type_id: true });

// ============================================================================
// EMERGENT STATISTICS (Computed from Operations)
// ============================================================================

/**
 * Work-type statistics (computed retrospectively from operations)
 * 
 * NOT stored during operations, computed from historical data
 */
export const WorkTypeStatsSchema = z.object({
    workType: z.string(),
    /** Average reproduction time per work hour (emergent intensity) */
    avgReproductionPerHour: z.number().nonnegative(),
    /** Average output per clock hour */
    avgOutputPerHour: z.number().nonnegative(),
    /** Sample size */
    sampleSize: z.number().int().nonnegative(),
    /** Last computed */
    computedAt: z.date(),
});

export type WorkTypeStats = z.infer<typeof WorkTypeStatsSchema>;

/**
 * ALT (Average Labor Time) computation result
 */
export const ALTComputationSchema = z.object({
    productId: z.string(),
    /** Current ALT (hours per unit) */
    alt: z.number().nonnegative(),
    /** Total quantity in sample */
    totalQuantity: z.number().nonnegative(),
    /** Total labor-time embodied */
    totalLaborTime: z.number().nonnegative(),
    /** Last updated */
    computedAt: z.date(),
});

export type ALTComputation = z.infer<typeof ALTComputationSchema>;

// ============================================================================
// ALLOCATION & PLANNING (Planning Layer)
// ============================================================================

/**
 * Allocation Plan: What we expect to happen
 * 
 * This is a hypothesis to be tested against reality (operations)
 */
export const AllocationPlanSchema = z.object({
    id: z.string(),
    period: z.string(), // e.g., "2024-W10"
    createdAt: z.date(),

    /** Product allocations */
    productAllocations: z.array(z.object({
        productId: z.string(),
        operationId: z.string().optional(),
        plannedQty: z.number().nonnegative(),
        minQty: z.number().nonnegative(),
        maxQty: z.number().nonnegative(),
        /** Uncertainty bounds (95% CI) */
        uncertaintyBounds: z.string().optional(), // e.g., "±5kg"
    })),

    /** Labor allocations */
    laborAllocations: z.array(z.object({
        individualId: z.string(),
        operationId: z.string().optional(),
        plannedHours: z.number().nonnegative(),
        workType: z.string(),
    })),

    /** Status */
    status: z.enum(["planned", "in_progress", "completed", "adjusted"]),
});

export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;

/**
 * Reserve allocation
 */
export const ReserveSchema = z.object({
    id: z.string(),
    productId: z.string(),
    reserveType: z.enum([
        "production_contingency",
        "natural_disaster",
        "epidemic_reserve",
        "general_buffer",
    ]),
    /** Allocation rule (e.g., "10% of monthly usage") */
    allocationRule: z.string(),
    targetLevel: z.number().nonnegative(),
    currentLevel: z.number().nonnegative(),
    reorderPoint: z.number().nonnegative().optional(),
});

export type Reserve = z.infer<typeof ReserveSchema>;

/**
 * Allocation variance (planned vs actual)
 */
export const AllocationVarianceSchema = z.object({
    period: z.string(),
    productId: z.string(),
    operationId: z.string().optional(),
    planned: z.number().nonnegative(),
    actual: z.number().nonnegative(),
    variance: z.number(),
    variancePct: z.number(),
    adjustmentMade: z.string().optional(),
    reason: z.string().optional(),
});

export type AllocationVariance = z.infer<typeof AllocationVarianceSchema>;

// ============================================================================
// PLANNING OPTIMIZATION
// ============================================================================

/**
 * Planning constraints
 */
export const PlanningConstraintsSchema = z.object({
    /** Material balance: produced_i ≥ final_need_i + intermediate_need_i + reproduction_need_i */
    materialBalance: z.array(z.object({
        productId: z.string(),
        minProduction: z.number().nonnegative(),
    })),

    /** Labor-time balance: available_τ ≥ required_τ */
    laborTimeBalance: z.array(z.object({
        workType: z.string(),
        maxAvailable: z.number().nonnegative(),
    })),

    /** Risk constraints: reserves_i ≥ risk_factor_i × usage_i */
    riskConstraints: z.array(z.object({
        productId: z.string(),
        riskFactor: z.number().nonnegative(),
    })),
});

export type PlanningConstraints = z.infer<typeof PlanningConstraintsSchema>;

/**
 * Planning objective: Maximize free time
 * 
 * T_free = T_total - T_necessary
 * T_necessary = T_direct + T_inefficiency
 * T_inefficiency = α × Variance + β × Shortage_cost
 */
export const PlanningObjectiveSchema = z.object({
    /** Total time available */
    totalTime: z.number().nonnegative(),
    /** Direct necessary time (actual labor) */
    directTime: z.number().nonnegative(),
    /** Inefficiency time (variance + shortage costs) */
    inefficiencyTime: z.number().nonnegative(),
    /** Free time (what remains) */
    freeTime: z.number().nonnegative(),

    /** Variance penalty weight */
    alpha: z.number().nonnegative().default(1.0),
    /** Shortage penalty weight */
    beta: z.number().nonnegative().default(1.0),

    /** Variance cost (planning inefficiency) */
    varianceCost: z.number().nonnegative(),
    /** Shortage cost */
    shortageCost: z.number().nonnegative(),
});

export type PlanningObjective = z.infer<typeof PlanningObjectiveSchema>;

// ============================================================================
// COMPLETE SYSTEM STATE
// ============================================================================

/**
 * Stock-Book: The recording system
 * 
 * Just records what happened - no planning, no forecasting
 */
export const StockBookSchema = z.object({
    /** All products */
    products: z.record(z.string(), ProductSchema),
    /** All individuals */
    individuals: z.record(z.string(), IndividualSchema),
    /** Current stocks */
    stocks: z.record(z.string(), StockSchema),
    /** Historical operations */
    operations: z.array(OperationSchema),
    /** Computed ALTs (updated periodically) */
    alts: z.record(z.string(), ALTComputationSchema).optional(),
    /** Work-type statistics (computed periodically) */
    workTypeStats: z.record(z.string(), WorkTypeStatsSchema).optional(),
});

export type StockBook = z.infer<typeof StockBookSchema>;

/**
 * Planning System: The intelligence layer
 * 
 * Plans what should happen, learns from variances
 */
export const PlanningSystemSchema = z.object({
    /** Current allocation plan */
    currentPlan: AllocationPlanSchema.optional(),
    /** Historical plans */
    historicalPlans: z.array(AllocationPlanSchema),
    /** Reserve management */
    reserves: z.array(ReserveSchema),
    /** Variance tracking */
    variances: z.array(AllocationVarianceSchema),
    /** Planning constraints */
    constraints: PlanningConstraintsSchema.optional(),
    /** Current objective state */
    objective: PlanningObjectiveSchema.optional(),
});

export type PlanningSystem = z.infer<typeof PlanningSystemSchema>;

/**
 * Complete system state
 */
export const CommunalProductionSystemSchema = z.object({
    /** Recording layer */
    stockBook: StockBookSchema,
    /** Planning layer */
    planning: PlanningSystemSchema,
    /** Last updated */
    lastUpdated: z.date(),
});

export type CommunalProductionSystem = z.infer<typeof CommunalProductionSystemSchema>;

// ============================================================================
// CORE FUNCTIONS - Stock-Book Operations
// ============================================================================

/**
 * Record an operation in the stock-book
 * 
 * This is the fundamental action - just record what happened
 */
export function recordOperation(
    stockBook: StockBook,
    operation: Operation
): StockBook {
    // Add operation to history
    const operations = [...stockBook.operations, operation];

    // Update stocks based on inputs/outputs
    const stocks = { ...stockBook.stocks };

    // Consume inputs
    for (const input of operation.inputsProducts) {
        const stock = stocks[input.productId];
        if (stock) {
            stocks[input.productId] = {
                ...stock,
                quantity: stock.quantity - input.quantity,
                lastUpdated: operation.timestamp,
            };
        }
    }

    // Process Effects (Output VCs)
    for (const effect of operation.effects) {
        const stock = stocks[effect.productId];
        if (stock) {
            stocks[effect.productId] = {
                ...stock,
                quantity: stock.quantity + effect.quantity,
                lastUpdated: operation.timestamp,
            };
        } else {
            stocks[effect.productId] = {
                product_type_id: effect.productId,
                quantity: effect.quantity,
                lastUpdated: operation.timestamp,
            };
        }
    }

    return {
        ...stockBook,
        operations,
        stocks,
    };
}

/**
 * Compute ALT for a product from historical operations
 * 
 * ALT = Total labor-time embodied / Total quantity produced
 */
export function computeALT(
    productId: string,
    operations: Operation[]
): ALTComputation | null {
    const relevantOps = operations.filter(op =>
        op.effects.some(out => out.productId === productId)
    );

    if (relevantOps.length === 0) return null;

    let totalQuantity = 0;
    let totalLaborTime = 0;

    for (const op of relevantOps) {
        // Find output quantity
        const output = op.effects.find(out => out.productId === productId);
        if (!output) continue;

        totalQuantity += output.quantity;

        // Sum labor inputs
        const laborTime = op.inputsLabor.reduce((sum, labor) => sum + labor.hours, 0);
        totalLaborTime += laborTime;

        // Add embodied labor from product inputs
        for (const input of op.inputsProducts) {
            if (input.alt) {
                totalLaborTime += input.quantity * input.alt;
            }
        }
    }

    if (totalQuantity === 0) return null;

    return {
        productId,
        alt: totalLaborTime / totalQuantity,
        totalQuantity,
        totalLaborTime,
        computedAt: new Date(),
    };
}

/**
 * Compute work-type statistics from historical operations
 * 
 * This is how "intensity" emerges - from actual reproduction costs
 */
/**
 * Compute Work Type Intensity (Statistical Solution)
 * 
 * Uses linear regression to separate mixed work types:
 * R = β₀ + Σ(β_i × H_i)
 * 
 * Solves using Normal Equation: β = (X^T X)^-1 X^T y
 */
export function computeWorkTypeIntensity(
    operations: Operation[],
    reproductionOperations: Operation[]
): Record<string, number> {
    // 1. Identify all unique work types
    const workTypes = new Set<string>();
    operations.forEach(op =>
        op.inputsLabor.forEach(l => {
            if (l.workType) workTypes.add(l.workType);
        })
    );
    const typesArray = Array.from(workTypes).sort();

    // 2. Build Design Matrix X (Rows = Time Periods/Workers, Cols = Work Types) and Vector y (Reproduction Cost)
    // Simplified: Treating each "Period" as a data point. 
    // In reality, we'd aggregate by Worker-Period (e.g., Worker A in Week 1).
    // Here we simulate aggregation by grouping operations by date/worker.

    // Group operations by (Worker + Date)
    const datapoints: Record<string, { work: Record<string, number>, reproduction: number }> = {};

    // Add work hours (X)
    operations.forEach(op => {
        const dateStr = op.timestamp.toISOString().split('T')[0];
        op.inputsLabor.forEach(labor => {
            const key = `${labor.individualId}_${dateStr}`;
            if (!datapoints[key]) datapoints[key] = { work: {}, reproduction: 0 };
            const type = labor.workType || 'general';
            datapoints[key].work[type] = (datapoints[key].work[type] || 0) + labor.hours;
        });
    });

    // Add reproduction costs (y)
    reproductionOperations.forEach(op => {
        const dateStr = op.timestamp.toISOString().split('T')[0];
        // Assuming single beneficiary for simplicity of this implementation
        // In full system, consumption operations would link to beneficiary
        const beneficiaryId = op.inputsLabor[0]?.individualId || "I001";
        const key = `${beneficiaryId}_${dateStr}`;
        if (datapoints[key]) {
            datapoints[key].reproduction += op.totalSocialTime; // Using Social Time as proxy for value consumed
        }
    });

    const samples = Object.values(datapoints).filter(d => d.reproduction > 0);

    if (samples.length < typesArray.length + 1) {
        // Not enough data for regression, return baseline 1.0
        const result: Record<string, number> = {};
        typesArray.forEach(t => result[t] = 1.0);
        return result;
    }

    // 3. Construct Matrix X and Vector y
    const X: number[][] = [];
    const y: number[] = [];

    samples.forEach(sample => {
        const row = [1]; // Intercept term (beta_0)
        typesArray.forEach(t => row.push(sample.work[t] || 0));
        X.push(row);
        y.push(sample.reproduction);
    });

    // 4. Solve Beta = (X^T X)^-1 X^T y
    try {
        const Xt = transpose(X);
        const XtX = multiply(Xt, X);
        const XtX_inv = invert(XtX);
        const XtX_inv_Xt = multiply(XtX_inv, Xt);
        const beta = multiplyVector(XtX_inv_Xt, y);

        const result: Record<string, number> = {};
        // beta[0] is intercept (base reproduction cost)
        typesArray.forEach((t, i) => {
            result[t] = beta[i + 1];
        });
        return result;
    } catch (e) {
        console.warn("Regression failed (singular matrix?), fallback to 1.0", e);
        const result: Record<string, number> = {};
        typesArray.forEach(t => result[t] = 1.0);
        return result;
    }
}

// Matrix Helpers
function transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
}

function multiply(A: number[][], B: number[][]): number[][] {
    const C = Array(A.length).fill(0).map(() => Array(B[0].length).fill(0));
    for (let i = 0; i < A.length; i++)
        for (let j = 0; j < B[0].length; j++)
            for (let k = 0; k < B.length; k++)
                C[i][j] += A[i][k] * B[k][j];
    return C;
}

function multiplyVector(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
}

// Gaussian elimination for inversion
function invert(A: number[][]): number[][] {
    const n = A.length;
    // Create augmented matrix [A | I]
    const M = A.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)]);

    for (let i = 0; i < n; i++) {
        // Field pivot
        let pivot = M[i][i];
        if (Math.abs(pivot) < 1e-10) throw new Error("Singular matrix");

        for (let j = i; j < 2 * n; j++) M[i][j] /= pivot;

        for (let k = 0; k < n; k++) {
            if (k !== i) {
                const factor = M[k][i];
                for (let j = i; j < 2 * n; j++) M[k][j] -= factor * M[i][j];
            }
        }
    }
    return M.map(row => row.slice(n));
}

// ============================================================================
// CORE FUNCTIONS - Planning Operations
// ============================================================================

/**
 * Compute variance between planned and actual
 */
export function computeVariance(
    plan: AllocationPlan,
    actualOperations: Operation[]
): AllocationVariance[] {
    const variances: AllocationVariance[] = [];

    for (const allocation of plan.productAllocations) {
        // Find actual operations for this allocation
        const relevantOps = actualOperations.filter(op =>
            allocation.operationId ? op.id === allocation.operationId : true
        );

        const actualQty = relevantOps.reduce((sum, op) => {
            const effect = op.effects.find(out => out.productId === allocation.productId);
            return sum + (effect?.quantity || 0);
        }, 0);

        const variance = actualQty - allocation.plannedQty;
        const variancePct = allocation.plannedQty > 0
            ? (variance / allocation.plannedQty) * 100
            : 0;

        variances.push({
            period: plan.period,
            productId: allocation.productId,
            operationId: allocation.operationId,
            planned: allocation.plannedQty,
            actual: actualQty,
            variance,
            variancePct,
        });
    }

    return variances;
}

/**
 * Compute planning objective (free time)
 */
export function computePlanningObjective(
    totalTime: number,
    directTime: number,
    variances: AllocationVariance[],
    shortages: number[],
    alpha: number = 1.0,
    beta: number = 1.0
): PlanningObjective {
    // Variance cost: sum of squared variances
    const varianceCost = variances.reduce(
        (sum, v) => sum + Math.pow(v.variance, 2),
        0
    );

    // Shortage cost: sum of shortages × penalty
    const shortageCost = shortages.reduce((sum, s) => sum + Math.max(0, s), 0);

    // Inefficiency time
    const inefficiencyTime = alpha * varianceCost + beta * shortageCost;

    // Free time
    const freeTime = totalTime - directTime - inefficiencyTime;

    return {
        totalTime,
        directTime,
        inefficiencyTime,
        freeTime,
        alpha,
        beta,
        varianceCost,
        shortageCost,
    };
}

