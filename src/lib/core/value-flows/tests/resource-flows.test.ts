import { describe, expect, test, beforeEach } from 'bun:test';
import { cashFlowReport } from '../algorithms/resource-flows';
import { Observer } from '../observation/observer';
import { PlanStore } from '../planning/planning';
import { ProcessRegistry } from '../process-registry';

describe('Cash Flow Report', () => {
    let observer: Observer;
    let planStore: PlanStore;

    beforeEach(() => {
        const reg = new ProcessRegistry();
        observer = new Observer(reg);
        planStore = new PlanStore(reg);
    });

    test('separates actual inflows and outflows into correct monthly buckets', () => {
        // Alice receives 100 kg wheat in March (inflow)
        observer.record({
            id: 'e1',
            action: 'transfer',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            provider: 'bob',
            receiver: 'alice',
            hasPointInTime: '2026-03-10T10:00:00Z',
        });

        // Alice sends 40 kg to Carol in March (outflow)
        observer.record({
            id: 'e2',
            action: 'transfer',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 40, hasUnit: 'kg' },
            provider: 'alice',
            receiver: 'carol',
            hasPointInTime: '2026-03-20T10:00:00Z',
        });

        // Alice receives 50 kg in April (different period)
        observer.record({
            id: 'e3',
            action: 'transfer',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            provider: 'carol',
            receiver: 'alice',
            hasPointInTime: '2026-04-05T10:00:00Z',
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-03-01'),
            reportEnd: new Date('2026-05-01'),
            observer,
            planStore,
            granularity: 'month',
        });

        expect(report.entries.length).toBe(2);

        const march = report.entries.find(e => e.period === '2026-03')!;
        expect(march.actualInflows).toBe(100);
        expect(march.actualOutflows).toBe(40);
        expect(march.netActual).toBe(60);
        expect(march.actualEventIds).toContain('e1');
        expect(march.actualEventIds).toContain('e2');

        const april = report.entries.find(e => e.period === '2026-04')!;
        expect(april.actualInflows).toBe(50);
        expect(april.actualOutflows).toBe(0);
        expect(april.netActual).toBe(50);
    });

    test('computes running cumulative net across periods', () => {
        observer.record({
            id: 'e1', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-01-15T10:00:00Z',
        });
        observer.record({
            id: 'e2', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
            provider: 'alice',
            hasPointInTime: '2026-02-10T10:00:00Z',
        });
        observer.record({
            id: 'e3', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-03-05T10:00:00Z',
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-01-01'),
            reportEnd: new Date('2026-04-01'),
            observer,
            planStore,
            granularity: 'month',
        });

        const jan = report.entries.find(e => e.period === '2026-01')!;
        const feb = report.entries.find(e => e.period === '2026-02')!;
        const mar = report.entries.find(e => e.period === '2026-03')!;

        expect(jan.cumulativeNet).toBe(100);           // 100
        expect(feb.cumulativeNet).toBe(70);            // 100 - 30
        expect(mar.cumulativeNet).toBe(120);           // 70 + 50
    });

    test('includes forecasted Commitments and open Intents', () => {
        // Past actual
        observer.record({
            id: 'e1', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 20, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-03-05T10:00:00Z',
        });

        // Future: bilateral Commitment — alice receives 100 kg in April
        planStore.addCommitment({
            action: 'transfer',
            provider: 'bob',
            receiver: 'alice',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            due: '2026-04-15T10:00:00Z',
            finished: false,
        });

        // Future: open Intent — alice will send 30 kg in May (no receiver yet)
        planStore.addIntent({
            action: 'transfer',
            provider: 'alice',
            resourceQuantity: { hasNumericalValue: 30, hasUnit: 'kg' },
            due: '2026-05-10T10:00:00Z',
            finished: false,
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-03-01'),
            reportEnd: new Date('2026-06-01'),
            observer,
            planStore,
            granularity: 'month',
        });

        const march = report.entries.find(e => e.period === '2026-03')!;
        expect(march.actualInflows).toBe(20);
        expect(march.forecastedInflows).toBe(0);

        const april = report.entries.find(e => e.period === '2026-04')!;
        expect(april.forecastedInflows).toBe(100);
        expect(april.forecastedFlowIds.length).toBe(1);

        const may = report.entries.find(e => e.period === '2026-05')!;
        expect(may.forecastedOutflows).toBe(30);

        expect(report.totalActualInflows).toBe(20);
        expect(report.totalForecastedInflows).toBe(100);
        expect(report.totalForecastedOutflows).toBe(30);
    });

    test('filters flows by resource spec', () => {
        observer.record({
            id: 'e-wheat', action: 'transfer',
            resourceConformsTo: 'spec:wheat',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-03-10T10:00:00Z',
        });
        observer.record({
            id: 'e-corn', action: 'transfer',
            resourceConformsTo: 'spec:corn',
            resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-03-15T10:00:00Z',
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-03-01'),
            reportEnd: new Date('2026-04-01'),
            observer,
            planStore,
            granularity: 'month',
            resourceSpecId: 'spec:wheat',
        });

        // Only wheat counted
        expect(report.totalActualInflows).toBe(100);
        expect(report.entries[0].actualEventIds).toEqual(['e-wheat']);
    });

    test('events outside the report range are excluded', () => {
        observer.record({
            id: 'before', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 999, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-01-31T23:59:59Z', // before range
        });
        observer.record({
            id: 'inside', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-03-15T10:00:00Z', // inside range
        });
        observer.record({
            id: 'after', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 999, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-05-01T00:00:00Z', // at/after range end (exclusive)
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-02-01'),
            reportEnd: new Date('2026-05-01'),
            observer,
            planStore,
            granularity: 'month',
        });

        expect(report.totalActualInflows).toBe(50);
    });

    test('weekly granularity creates period keys in ISO week format', () => {
        // 2026-02-23 is a Monday (ISO week 9)
        observer.record({
            id: 'e1', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-02-23T10:00:00Z',
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-02-22'), // Sunday (week start)
            reportEnd: new Date('2026-03-01'),   // next Sunday
            observer,
            planStore,
            granularity: 'week',
        });

        expect(report.entries.length).toBe(1);
        expect(report.entries[0].period).toBe('2026-W09');
        expect(report.entries[0].actualInflows).toBe(50);
    });

    test('quarterly granularity groups three months together', () => {
        observer.record({
            id: 'jan', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 100, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-01-15T10:00:00Z',
        });
        observer.record({
            id: 'feb', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 200, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-02-15T10:00:00Z',
        });
        observer.record({
            id: 'apr', action: 'transfer',
            resourceQuantity: { hasNumericalValue: 50, hasUnit: 'kg' },
            receiver: 'alice',
            hasPointInTime: '2026-04-15T10:00:00Z',
        });

        const report = cashFlowReport({
            agentId: 'alice',
            reportStart: new Date('2026-01-01'),
            reportEnd: new Date('2026-07-01'),
            observer,
            planStore,
            granularity: 'quarter',
        });

        const q1 = report.entries.find(e => e.period === '2026-Q1')!;
        const q2 = report.entries.find(e => e.period === '2026-Q2')!;
        expect(q1.actualInflows).toBe(300); // jan + feb
        expect(q2.actualInflows).toBe(50);  // apr only
    });
});
