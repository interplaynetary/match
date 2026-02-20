
import { describe, expect, it } from 'bun:test';
import * as h3 from 'h3-js';
import { createHexIndex, addItemToHexIndex, queryHexIndex, getItemsInCell } from '../src/lib/core/plan/hex';

describe('Hierarchical Hex Indexing', () => {
    
    // Coordinates for Alexanderplatz, Berlin
    const lat = 52.5219;
    const lon = 13.4132;
    
    // Create index
    const index = createHexIndex<{ id: string, name: string }>(9, 0);

    it('should aggregate stats up the hierarchy', () => {
        const item1 = { id: 'p1', name: 'Alice' };
        // Add item with 10 hours
        addItemToHexIndex(index, item1, 'p1', { lat, lon }, { hours: 10 });
        
        // 1. Check Leaf Node (Res 9)
        const leafCell = h3.latLngToCell(lat, lon, 9);
        const leafNode = queryHexIndex(index, leafCell);
        
        expect(leafNode).toBeDefined();
        expect(leafNode?.stats.count).toBe(1);
        expect(leafNode?.stats.sum_hours).toBe(10);
        expect(leafNode?.items.has('p1')).toBe(true);
        
        // 2. Check Parent Node (Res 7 - Neighborhood/City scale)
        const parentCell = h3.cellToParent(leafCell, 7);
        const parentNode = queryHexIndex(index, parentCell);
        
        expect(parentNode).toBeDefined();
        expect(parentNode?.resolution).toBe(7);
        expect(parentNode?.stats.count).toBe(1); // Should have aggregated
        expect(parentNode?.stats.sum_hours).toBe(10);
        expect(parentNode?.items.has('p1')).toBe(true);
    });

    it('should sum multiple items correctly', () => {
        // Add another person in same location
        const item2 = { id: 'p2', name: 'Bob' };
        addItemToHexIndex(index, item2, 'p2', { lat, lon }, { hours: 5, quantity: 2 });
        
        // Re-check Parent Node (Res 7)
        const leafCell = h3.latLngToCell(lat, lon, 9);
        const parentCell = h3.cellToParent(leafCell, 7);
        const parentNode = queryHexIndex(index, parentCell);
        
        expect(parentNode).toBeDefined();
        expect(parentNode?.stats.count).toBe(2); // Alice + Bob
        expect(parentNode?.stats.sum_hours).toBe(15); // 10 + 5
        expect(parentNode?.stats.sum_quantity).toBe(2); // 0 + 2
        
        // Check items retrieval
        const items = getItemsInCell(index, parentCell);
        expect(items.length).toBe(2);
        expect(items.map(i => i.name).sort()).toEqual(['Alice', 'Bob']);
    });
});
