
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import * as h3 from 'h3-js';
import { Person } from '../src/lib/core/plan/person';
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
        const personCode = {
            id: 'p1',
            location: { latitude: lat, longitude: lon, city: 'Berlin', country: 'Germany' },
            skills: [{ id: 's1', level: 1 }],
            max_hours_per_week: 40,
        };
        const person = personCode as unknown as Person;
        
        // Mock computeAvailableHours behavior or assume default 40
        const index = buildLaborIndex([person]);
        
        // Query at leaf
        const leafNode = queryLaborByHex(index, leafCell);
        expect(leafNode).toBeDefined();
        expect(leafNode?.stats.sum_hours).toBe(40);
        
        // Check Temporal Binning
        if (leafNode?.temporal) {
             // We fallback to full_time bin for no-window person
             expect(leafNode.temporal.recurring.full_time.stats.sum_hours).toBe(40);
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
