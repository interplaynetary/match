import { describe, expect, test, beforeEach } from 'bun:test';
import { distributeIncome, effortEquation, equalEquation, hybridEquation } from '../algorithms/value-equations';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';

describe('Value Equations (Income Distribution)', () => {
    let observer: Observer;
    let processReg: ProcessRegistry;

    beforeEach(() => {
        processReg = new ProcessRegistry();
        observer = new Observer(processReg);

        // Setup a scenario:
        // Alice works 8 hours.
        // Bob works 2 hours, and consumes 20 qty of resources.
        // Charlie just transfers the final good (should not get paid by default equations).
        // Then an income event of 1000 USD arrives.

        processReg.register({ id: 'proc', name: 'Production' });

        observer.record({
            id: 'e1',
            action: 'work',
            provider: 'alice',
            effortQuantity: { hasNumericalValue: 8, hasUnit: 'hours' },
            inputOf: 'proc'
        });

        observer.record({
            id: 'e2',
            action: 'work',
            provider: 'bob',
            effortQuantity: { hasNumericalValue: 2, hasUnit: 'hours' },
            inputOf: 'proc'
        });

        observer.record({
            id: 'e3',
            action: 'consume',
            provider: 'bob',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
            inputOf: 'proc'
        });

        observer.record({
            id: 'e-out',
            action: 'produce',
            resourceInventoriedAs: 'res-1',
            outputOf: 'proc'
        });

        // The sale event brings in income. It originated from the resource.
        // We'll record a transfer representing a sale that yields 1000 USD.
        // We link it by saying it's for 'res-1'
        observer.record({
            id: 'e-sale',
            action: 'transfer',
            provider: 'charlie',
            resourceInventoriedAs: 'res-1',
            resourceQuantity: { hasNumericalValue: 1000, hasUnit: 'USD' }
        });
    });

    test('effortEquation distributes strictly by time worked', () => {
        const result = distributeIncome('e-sale', observer, processReg, effortEquation);
        
        expect(result.totalIncome).toBe(1000);
        expect(result.shares.length).toBe(2);
        
        const aliceShare = result.shares.find(s => s.agentId === 'alice')!;
        const bobShare = result.shares.find(s => s.agentId === 'bob')!;
        
        // total effort = 10, alice = 8 (80%), bob = 2 (20%)
        expect(aliceShare.amount).toBe(800);
        expect(bobShare.amount).toBe(200);
        expect(result.zeroScoreAgents).not.toContain('alice');
        expect(result.zeroScoreAgents).not.toContain('bob');
    });

    test('equalEquation distributes evenly among contributors', () => {
        const result = distributeIncome('e-sale', observer, processReg, equalEquation);
        
        expect(result.shares.length).toBe(2);
        
        const aliceShare = result.shares.find(s => s.agentId === 'alice')!;
        const bobShare = result.shares.find(s => s.agentId === 'bob')!;
        
        // 1 event for Alice, 2 events for Bob -> 1/3 and 2/3 of 1000
        expect(aliceShare.amount).toBeCloseTo(333.33, 1);
        expect(bobShare.amount).toBeCloseTo(666.67, 1);
    });

    test('hybridEquation distributes by weighted components (70% effort, 30% resource)', () => {
        const result = distributeIncome('e-sale', observer, processReg, hybridEquation);
        
        // Alice: 8 hours * 0.7 = 5.6
        // Bob: 2 hours * 0.7 = 1.4, plus 20 resources * 0.3 = 6.0
        // Total score = 5.6 + 7.4 = 13.0
        
        const aliceShare = result.shares.find(s => s.agentId === 'alice')!;
        const bobShare = result.shares.find(s => s.agentId === 'bob')!;
        
        const aliceExpected = (5.6 / 13.0) * 1000;
        const bobExpected = (7.4 / 13.0) * 1000;
        
        expect(aliceShare.amount).toBeCloseTo(aliceExpected, 5);
        expect(bobShare.amount).toBeCloseTo(bobExpected, 5);
        
        // Bob gets more because of his massive resource contribution
        expect(bobShare.amount).toBeGreaterThan(aliceShare.amount);
    });

    test('agents with zero score are excluded', () => {
        // Add a cite event for Dave
        observer.record({
            id: 'e4',
            action: 'cite',
            provider: 'dave', // cite usually isn't an "effort", though our resourceScorer checks 'cite' now.
            // But let's set quantity to 0 so Dave gets a score of 0.
            resourceQuantity: { hasNumericalValue: 0, hasUnit: 'docs' },
            inputOf: 'proc'
        });

        const result = distributeIncome('e-sale', observer, processReg, effortEquation); // Effort eqn doesn't count cite
        
        expect(result.shares.find(s => s.agentId === 'dave')).toBeUndefined();
        expect(result.zeroScoreAgents).toContain('dave');
    });
});
