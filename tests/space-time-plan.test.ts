import { describe, expect, it } from 'bun:test';
import {
    makePlanNode,
    makePlan,
    emptyPlan,
    computePlanId,
    mergePlans,
    planDominates,
    paretoFront,
    selectFromParetoFront,
    serialisePlan,
    deserialisePlan,
    getPlanKey,
    type PlanScore,
} from '../src/lib/core/commons/space-time-plan';

// =============================================================================
// HELPERS
// =============================================================================

const baseScore = (overrides: Partial<PlanScore> = {}): PlanScore => ({
    total_snlt: 10,
    needs_covered: 0.8,
    deficits: [],
    surpluses: [],
    resolution_depth: 1,
    ...overrides,
});

const makeNode = (
    strategy_type_key: string,
    h3_cell: string,
    executions: number = 1,
    snlt_per_execution: number = 5,
) =>
    makePlanNode({
        strategy_type_key,
        h3_cell,
        resolution: 9,
        time_signature: 'recurring|Days:(monday)@(09:00-17:00)',
        executions,
        snlt_per_execution,
        inputs_required:  [{ product_id: 'wheat', quantity: 10 }],
        outputs_produced: [{ product_id: 'bread', quantity:  5 }],
    });

// =============================================================================
// TESTS
// =============================================================================

describe('getPlanKey', () => {
    it('returns a deterministic key with three parts', () => {
        const key = getPlanKey(
            { h3_index: '87283472bffffff' },
            { recurrence: 'weekly' },
            'bread-baking',
        );
        expect(key).toContain('::');
        expect(key.split('::').length).toBeGreaterThanOrEqual(2);
        expect(key).toContain('bread-baking');
    });

    it('produces identical keys for identical inputs', () => {
        const loc = { latitude: 52.52, longitude: 13.405 };
        const time = { recurrence: 'weekly' as const };
        const k1 = getPlanKey(loc, time, 'milling');
        const k2 = getPlanKey(loc, time, 'milling');
        expect(k1).toBe(k2);
    });
});

describe('computePlanId', () => {
    it('is stable for the same node set regardless of insertion order', () => {
        const node1 = makeNode('bread', 'cellA');
        const node2 = makeNode('milling', 'cellB');
        const id1 = computePlanId([node1, node2]);
        const id2 = computePlanId([node2, node1]);
        expect(id1).toBe(id2);
    });

    it('differs for different node sets', () => {
        const node1 = makeNode('bread', 'cellA');
        const node2 = makeNode('milling', 'cellB');
        expect(computePlanId([node1])).not.toBe(computePlanId([node2]));
    });

    it('empty plan has consistent id', () => {
        expect(computePlanId([])).toBe(computePlanId([]));
    });
});

describe('makePlan', () => {
    it('builds covered_cells from node h3_cells', () => {
        const n1 = makeNode('bread', 'cellA');
        const n2 = makeNode('milling', 'cellB');
        const plan = makePlan([n1, n2], baseScore());
        expect(plan.covered_cells.has('cellA')).toBe(true);
        expect(plan.covered_cells.has('cellB')).toBe(true);
    });
});

describe('mergePlans', () => {
    it('merges two compatible plans and sums SNLT', () => {
        const nodeA = makeNode('bread', 'cellA', 2, 3);
        const nodeB = makeNode('milling', 'cellB', 1, 4);
        const planA = makePlan([nodeA], baseScore({ total_snlt: 6, needs_covered: 1 }));
        const planB = makePlan([nodeB], baseScore({ total_snlt: 4, needs_covered: 0.5 }));

        const stocks = new Map([['wheat', 999]]);
        const merged = mergePlans(planA, planB, [], stocks);
        expect(Array.isArray(merged)).toBe(false);

        if (!Array.isArray(merged)) {
            expect(merged.nodes.length).toBe(2);
            expect(merged.score.total_snlt).toBe(6 + 4); // 2×3 + 1×4
            expect(merged.covered_cells.has('cellA')).toBe(true);
            expect(merged.covered_cells.has('cellB')).toBe(true);
        }
    });

    it('detects strategy clash on same key', () => {
        // Same h3_cell + time_signature → same key, different strategy_type_key
        const nodeA = makeNode('bread', 'cellA');
        const nodeB = makeNode('milling', 'cellA'); // same cell, different strategy
        // Override time_signature to be identical so keys collide
        const nodeB2 = { ...nodeB, time_signature: nodeA.time_signature, key: nodeA.key };

        const planA = makePlan([nodeA], baseScore());
        const planB = makePlan([nodeB2], baseScore());
        const result = mergePlans(planA, planB);
        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result[0].type).toBe('double_commitment');
        }
    });

    it('detects material imbalance', () => {
        const nodeA = makeNode('bread', 'cellA', 1, 5); // needs 10 wheat
        const planA = makePlan([nodeA], baseScore());
        const empty = emptyPlan();
        // No stocks → wheat shortfall
        const result = mergePlans(planA, empty, [], new Map());
        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
            expect(result[0].type).toBe('material_imbalance');
        }
    });

    it('sums executions for identical keys from both plans', () => {
        const nodeA = makeNode('bread', 'cellA', 2, 3);
        const nodeB = { ...nodeA, executions: 3, total_snlt: 9 };
        const planA = makePlan([nodeA], baseScore({ total_snlt: 6 }));
        const planB = makePlan([nodeB], baseScore({ total_snlt: 9 }));

        const stocks = new Map([['wheat', 999]]);
        const merged = mergePlans(planA, planB, [], stocks);
        if (!Array.isArray(merged)) {
            expect(merged.nodes.length).toBe(1);
            expect(merged.nodes[0].executions).toBe(5);
            expect(merged.score.total_snlt).toBe(15);
        }
    });
});

describe('planDominates', () => {
    it('A dominates B when A covers more needs at same SNLT', () => {
        const a = makePlan([], baseScore({ needs_covered: 1.0,  total_snlt: 10 }));
        const b = makePlan([], baseScore({ needs_covered: 0.8,  total_snlt: 10 }));
        expect(planDominates(a, b)).toBe(true);
        expect(planDominates(b, a)).toBe(false);
    });

    it('A dominates B when A uses less SNLT at same coverage', () => {
        const a = makePlan([], baseScore({ needs_covered: 0.8, total_snlt: 8  }));
        const b = makePlan([], baseScore({ needs_covered: 0.8, total_snlt: 12 }));
        expect(planDominates(a, b)).toBe(true);
        expect(planDominates(b, a)).toBe(false);
    });

    it('neither dominates when tradeoffs differ', () => {
        const a = makePlan([], baseScore({ needs_covered: 1.0, total_snlt: 20 }));
        const b = makePlan([], baseScore({ needs_covered: 0.6, total_snlt: 5  }));
        expect(planDominates(a, b)).toBe(false);
        expect(planDominates(b, a)).toBe(false);
    });

    it('identical plans do not dominate each other', () => {
        const a = makePlan([], baseScore());
        const b = makePlan([], baseScore());
        expect(planDominates(a, b)).toBe(false);
    });
});

describe('paretoFront', () => {
    it('retains only non-dominated plans', () => {
        const best    = makePlan([], baseScore({ needs_covered: 1.0, total_snlt: 8  }));
        const middle  = makePlan([], baseScore({ needs_covered: 0.8, total_snlt: 10 }));
        const worst   = makePlan([], baseScore({ needs_covered: 0.5, total_snlt: 15 }));
        const front = paretoFront([best, middle, worst]);
        // `best` dominates both others; `middle` dominates `worst`
        expect(front).toContain(best);
        expect(front).not.toContain(worst);
    });

    it('keeps both when plans are incomparable', () => {
        const a = makePlan([], baseScore({ needs_covered: 1.0, total_snlt: 20 }));
        const b = makePlan([], baseScore({ needs_covered: 0.5, total_snlt: 5  }));
        const front = paretoFront([a, b]);
        expect(front).toContain(a);
        expect(front).toContain(b);
    });
});

describe('selectFromParetoFront', () => {
    const high   = makePlan([], baseScore({ needs_covered: 1.0, total_snlt: 20 }));
    const cheap  = makePlan([], baseScore({ needs_covered: 0.5, total_snlt: 5  }));

    it('min_snlt picks cheapest plan', () => {
        expect(selectFromParetoFront([high, cheap], 'min_snlt')).toBe(cheap);
    });

    it('max_coverage picks highest coverage plan', () => {
        expect(selectFromParetoFront([high, cheap], 'max_coverage')).toBe(high);
    });

    it('balanced picks a plan (does not throw)', () => {
        const selected = selectFromParetoFront([high, cheap], 'balanced');
        expect(selected).not.toBeNull();
    });

    it('returns null for empty input', () => {
        expect(selectFromParetoFront([])).toBeNull();
    });
});

describe('serialisePlan / deserialisePlan', () => {
    it('round-trips a Plan through JSON', () => {
        const node = makeNode('bread', 'cellA', 2, 5);
        const plan = makePlan([node], baseScore());
        const blob = serialisePlan(plan);
        const json = JSON.stringify(blob);
        const restored = deserialisePlan(JSON.parse(json));

        expect(restored.id).toBe(plan.id);
        expect(restored.nodes.length).toBe(1);
        expect(restored.nodes[0].key).toBe(node.key);
        expect(restored.nodes[0].executions).toBe(2);
        expect(restored.score.total_snlt).toBe(plan.score.total_snlt);
    });
});
