import { describe, expect, test, beforeEach } from 'bun:test';
import { trace, track, type FlowNode } from '../algorithms/track-trace';
import { Observer } from '../observation/observer';
import { ProcessRegistry } from '../process-registry';
import type { EconomicEvent } from '../schemas';

describe('Track & Trace (Provenance)', () => {
    let observer: Observer;
    let processes: ProcessRegistry;

    beforeEach(() => {
        processes = new ProcessRegistry();
        observer = new Observer(processes);
    });

    /**
     * Set up a supply chain graph:
     * 1. e1(consume) wood -> process A
     * 2. e2(produce) -> wooden-toy (resource 1) from process A
     * 3. e3(transfer) -> moves wooden-toy from agent X to agent Y (resource 2)
     * 4. e4(consume) wooden-toy -> process B
     * 5. e5(produce) -> painted-toy (resource 3) from process B
     */
    function setupSupplyChain() {
        // Register processes
        processes.register({ id: 'procA', name: 'Wood Workshop' });
        processes.register({ id: 'procB', name: 'Painting Workshop' });

        // Seed initial resource
        observer.seedResource({
            id: 'res-wood',
            conformsTo: 'spec:wood',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });

        // 1. Consume wood
        observer.record({
            id: 'e1',
            action: 'consume',
            resourceInventoriedAs: 'res-wood',
            resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' },
            inputOf: 'procA',
        });

        // 2. Produce wooden toy
        observer.record({
            id: 'e2',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
            outputOf: 'procA',
            resourceInventoriedAs: 'res-wooden-toy-1', // created
        });

        // 3. Transfer toy
        observer.record({
            id: 'e3',
            action: 'transfer',
            resourceInventoriedAs: 'res-wooden-toy-1',
            toResourceInventoriedAs: 'res-wooden-toy-2', // created
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
        });

        // 4. Consume toy
        observer.record({
            id: 'e4',
            action: 'consume',
            resourceInventoriedAs: 'res-wooden-toy-2',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
            inputOf: 'procB',
        });

        // 5. Produce painted toy
        observer.record({
            id: 'e5',
            action: 'produce',
            resourceQuantity: { hasNumericalValue: 1, hasUnit: 'unit' },
            outputOf: 'procB',
            resourceInventoriedAs: 'res-painted-toy', // created
        });
    }

    test('trace backwards from final product (provenance)', () => {
        setupSupplyChain();

        const nodes = trace('res-painted-toy', observer, processes);
        const ids = nodes.map(n => n.id);

        // Expected backwards path:
        // res-painted-toy -> e5 -> procB -> e4 -> res-wooden-toy-2 -> e3 -> res-wooden-toy-1 -> e2 -> procA -> e1 -> res-wood
        expect(ids).toEqual([
            'res-painted-toy',
            'e5',
            'procB',
            'e4',
            'res-wooden-toy-2',
            'e3',
            'res-wooden-toy-1',
            'e2',
            'procA',
            'e1',
            'res-wood'
        ]);
        
        // Check parent pointers
        const e5Node = nodes.find(n => n.id === 'e5')!;
        expect(e5Node.parent).toBe('res-painted-toy');
        
        const procBNode = nodes.find(n => n.id === 'procB')!;
        expect(procBNode.parent).toBe('e5');
    });

    test('track forwards from raw material (destination)', () => {
        setupSupplyChain();

        const nodes = track('res-wood', observer, processes);
        const ids = nodes.map(n => n.id);

        // Expected forwards path:
        // res-wood -> e1 -> procA -> e2 -> res-wooden-toy-1 -> e3 -> res-wooden-toy-2 -> e4 -> procB -> e5 -> res-painted-toy
        expect(ids).toEqual([
            'res-wood',
            'e1',
            'procA',
            'e2',
            'res-wooden-toy-1',
            'e3',
            'res-wooden-toy-2',
            'e4',
            'procB',
            'e5',
            'res-painted-toy'
        ]);
    });

    test('track from a mid-point (event)', () => {
        setupSupplyChain();
        const nodes = track('e3', observer, processes); // start from transfer event
        const ids = nodes.map(n => n.id);

        expect(ids).toEqual([
            'e3',
            'res-wooden-toy-2',
            'e4',
            'procB',
            'e5',
            'res-painted-toy'
        ]);
    });

    test('trace handles raise/lower with previousEvent breadcrumbs', () => {
        observer.seedResource({
            id: 'res-base',
            conformsTo: 'spec:base',
            accountingQuantity: { hasNumericalValue: 10, hasUnit: 'kg' },
        });

        observer.record({ id: 'ra1', action: 'raise', resourceInventoriedAs: 'res-base', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } });
        observer.record({ id: 'ra2', action: 'raise', resourceInventoriedAs: 'res-base', resourceQuantity: { hasNumericalValue: 5, hasUnit: 'kg' } });
        
        // The resource's previousEvent will point to ra2
        const resource = observer.getResource('res-base')!;
        expect(resource.previousEvent).toBe('ra2');
        
        const nodes = trace('res-base', observer, processes);
        const ids = nodes.map(n => n.id);
        
        // Should trace backwards through the correction chain via previousEvent
        expect(ids).toContain('res-base');
        expect(ids).toContain('ra1');
        expect(ids).toContain('ra2');
    });
});
