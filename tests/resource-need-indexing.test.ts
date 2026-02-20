
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Resource } from '../src/lib/core/plan/process';
import { buildResourceIndex, queryResourcesByType, queryResourcesByLocation, queryResourcesByTypeAndLocation } from '../src/lib/core/plan/resource';
import { Need, buildNeedIndex, queryNeedsByType, queryNeedsByLocation, queryNeedsByTypeAndLocation } from '../src/lib/core/plan/need';

describe('Resource Indexing', () => {
    // Mock Resources
    const r1: z.infer<typeof Resource> = {
        id: 'r1', type_id: 'bread', quantity: 100,
        city: 'London', country: 'UK'
    };
    const r2: z.infer<typeof Resource> = {
        id: 'r2', type_id: 'bread', quantity: 50,
        city: 'Paris', country: 'France'
    };
    const r3: z.infer<typeof Resource> = {
        id: 'r3', type_id: 'water', quantity: 500,
        city: 'London', country: 'UK'
    };

    const index = buildResourceIndex([r1, r2, r3]);

    it('should index by type', () => {
        const bread = queryResourcesByType(index, 'bread');
        expect(bread.length).toBe(2);
        expect(bread.map(r => r.id).sort()).toEqual(['r1', 'r2']);

        const water = queryResourcesByType(index, 'water');
        expect(water.length).toBe(1);
        expect(water[0].id).toBe('r3');
    });

    it('should index by location', () => {
        const london = queryResourcesByLocation(index, { city: 'London' });
        expect(london.length).toBe(2);
        // r1 (bread) and r3 (water) are in London
        expect(london.map(r => r.id).sort()).toEqual(['r1', 'r3']);
    });

    it('should query by type AND location', () => {
        const londonBread = queryResourcesByTypeAndLocation(index, 'bread', { city: 'London' });
        expect(londonBread.length).toBe(1);
        expect(londonBread[0].id).toBe('r1');
    });
});

describe('Need Indexing', () => {
    // Mock Needs
    const n1: Need = {
        id: 'n1', type_id: 'bread', quantity: 10,
        city: 'Berlin', country: 'Germany', priority: 0.5
    };
    const n2: Need = {
        id: 'n2', type_id: 'bread', quantity: 20,
        city: 'Munich', country: 'Germany', priority: 0.8
    };
    const n3: Need = {
        id: 'n3', type_id: 'water', quantity: 50,
        city: 'Berlin', country: 'Germany', priority: 0.5
    };

    const index = buildNeedIndex([n1, n2, n3]);

    it('should index by type', () => {
        const bread = queryNeedsByType(index, 'bread');
        expect(bread.length).toBe(2);
        expect(bread.map(n => n.id).sort()).toEqual(['n1', 'n2']);
    });

    it('should index by location', () => {
        const berlin = queryNeedsByLocation(index, { city: 'Berlin' });
        expect(berlin.length).toBe(2);
        // n1 (bread) and n3 (water) are in Berlin
        expect(berlin.map(n => n.id).sort()).toEqual(['n1', 'n3']);
    });

    it('should query by type AND location', () => {
        const berlinBread = queryNeedsByTypeAndLocation(index, 'bread', { city: 'Berlin' });
        expect(berlinBread.length).toBe(1);
        expect(berlinBread[0].id).toBe('n1');
    });
});
