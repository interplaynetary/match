
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import * as h3 from 'h3-js';
import { Person, PersonWithAvailability } from '../src/lib/core/person';
import { buildLaborIndex, queryLaborByHex } from '../src/lib/core/plan/labor';
import { Resource } from '../src/lib/core/plan/process';
import { buildResourceIndex, queryResourcesByHex } from '../src/lib/core/plan/resource';
import { Need, buildNeedIndex, queryNeedsByHex } from '../src/lib/core/plan/need';

describe('Hex Index Integration', () => {
    // Berlin Alexanderplatz
    const lat = 52.5219;
    const lon = 13.4132;
    // Res 9 cell for this location
    const leafCell = h3.latLngToCell(lat, lon, 9);
    // Res 7 cell (parent)
    const parentCell = h3.cellToParent(leafCell, 7);

    it('should integrate with LaborIndex', () => {
        const person: PersonWithAvailability = {
            id: 'p1',
            location: { latitude: lat, longitude: lon, city: 'Berlin', country: 'Germany' },
            skills: [{ id: 's1', level: 1 }],
            availability: { hours_per_week: 40 }, // Using simplified availability for test
            // @ts-ignore - Mocking simplified person structure
        };
        
        // Mock computeAvailableHours behavior or assume default 40
        const index = buildLaborIndex([person]);
        
        // Query at leaf
        const leafNode = queryLaborByHex(index, leafCell);
        expect(leafNode).toBeDefined();
        expect(leafNode?.stats.sum_hours).toBe(40);
        
        // Check Temporal Binning
        if (leafNode?.by_time) {
             // Since we didn't specify availability window, it should default to a signature
             // logic in matching.ts. 
             // Let's just check that *some* bin exists and has the stats
             expect(leafNode.by_time.size).toBeGreaterThan(0);
             const bins = Array.from(leafNode.by_time.values());
             // Expect total hours to match
             const totalBinHours = bins.reduce((sum, b) => sum + b.stats.sum_hours, 0);
             expect(totalBinHours).toBe(40);
        }

        // Query at parent (Res 7)
        const parentNode = queryLaborByHex(index, parentCell);
        expect(parentNode).toBeDefined();
        expect(parentNode?.resolution).toBe(7);
        expect(parentNode?.stats.sum_hours).toBe(40);
    });

    it('should integrate with ResourceIndex', () => {
        const resource: z.infer<typeof Resource> = {
            id: 'r1', type_id: 'bread', quantity: 100,
            latitude: lat, longitude: lon,
            city: 'Berlin', country: 'Germany'
        };
        
        const index = buildResourceIndex([resource]);
        
        const parentNode = queryResourcesByHex(index, parentCell);
        expect(parentNode).toBeDefined();
        expect(parentNode?.stats.sum_quantity).toBe(100);
        expect(parentNode?.items.has('r1')).toBe(true);
    });

    it('should integrate with NeedIndex', () => {
        const need: Need = {
            id: 'n1', type_id: 'bread', quantity: 50,
            latitude: lat, longitude: lon,
            city: 'Berlin', country: 'Germany',
            priority: 0.5
        };
        
        const index = buildNeedIndex([need]);
        
        const parentNode = queryNeedsByHex(index, parentCell);
        expect(parentNode).toBeDefined();
        expect(parentNode?.stats.sum_quantity).toBe(50);
        expect(parentNode?.items.has('n1')).toBe(true);
    });
});
