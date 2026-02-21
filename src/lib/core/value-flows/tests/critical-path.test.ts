import { describe, expect, test, beforeEach } from 'bun:test';
import { criticalPath } from '../algorithms/critical-path';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';

describe('Critical Path Method (CPM)', () => {
    let planStore: PlanStore;
    let processReg: ProcessRegistry;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        planStore = new PlanStore();
    });

    test('computes critical path and floats for a series of dependent processes', () => {
        const plan = planStore.addPlan({ name: 'Construction' });

        // A -> B -> D
        // A -> C -> D
        // B takes 5 hours, C takes 2 hours -> path ABD is critical
        
        const pA = processReg.register({ id: 'pA', name: 'Start', plannedWithin: plan.id, hasBeginning: '2026-01-01T00:00:00Z', hasEnd: '2026-01-01T01:00:00Z' });
        const pB = processReg.register({ id: 'pB', name: 'Slow', plannedWithin: plan.id, hasBeginning: '2026-01-01T01:00:00Z', hasEnd: '2026-01-01T06:00:00Z' });
        const pC = processReg.register({ id: 'pC', name: 'Fast', plannedWithin: plan.id, hasBeginning: '2026-01-01T01:00:00Z', hasEnd: '2026-01-01T03:00:00Z' });
        const pD = processReg.register({ id: 'pD', name: 'End', plannedWithin: plan.id, hasBeginning: '2026-01-01T06:00:00Z', hasEnd: '2026-01-01T07:00:00Z' });
        
        // Wire dependencies via commitments
        // pA outputs X -> pB inputs X
        // pA outputs Y -> pC inputs Y
        // pB outputs Z -> pD inputs Z
        // pC outputs W -> pD inputs W

        const addComm = (outputOf: string | undefined, inputOf: string | undefined, spec: string) => {
            planStore.addCommitment({
                action: outputOf ? 'produce' : 'consume',
                outputOf,
                inputOf,
                resourceConformsTo: spec,
                plannedWithin: plan.id,
                finished: false
            });
        };

        addComm('pA', 'pB', 'spec:X');
        addComm('pA', 'pC', 'spec:Y');
        addComm('pB', 'pD', 'spec:Z');
        addComm('pC', 'pD', 'spec:W');

        const result = criticalPath(plan.id, planStore, processReg);

        // Path duration: A(1h) + max(B(5h), C(2h)) + D(1h) = 7h. In ms: 7 * 3.6e6
        const HOUR_MS = 3600000;
        expect(result.projectDuration).toBe(7 * HOUR_MS);
        
        // Critical path processes: A, B, D
        const critNodes = result.nodes.filter(n => n.isCritical).map(n => n.processId);
        expect(critNodes).toContain('pA');
        expect(critNodes).toContain('pB');
        expect(critNodes).toContain('pD');
        expect(critNodes).not.toContain('pC');

        // Verify float of C = 3 hours = 3 * 3.6e6
        const nC = result.nodes.find(n => n.processId === 'pC')!;
        expect(nC.float).toBe(3 * HOUR_MS);
        expect(nC.earliestStart).toBe(1 * HOUR_MS); // After A
        expect(nC.earliestFinish).toBe(3 * HOUR_MS); // ES + 2h duration
        expect(nC.latestStart).toBe(4 * HOUR_MS); // B takes 5h, D starts at 6h. C takes 2h so it MUST start by 4h.
        expect(nC.latestFinish).toBe(6 * HOUR_MS);
    });
});
