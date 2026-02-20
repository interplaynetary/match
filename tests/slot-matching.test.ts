
import { describe, expect, it } from 'bun:test';
import { slotsCompatible, skillsCompatible, timeRangesOverlap, locationsCompatible, checkFlowConstraints } from '$lib/core/matching';
import type { Resource, Contact } from '$lib/core/plan/process';
import type { AvailabilityWindow } from '$lib/core/plan/time';

describe('Slot Matching Logic', () => {

    describe('slotsCompatible', () => {
        it('should return true for perfectly matching slots', () => {
            const need: Resource = {
                id: 'n1', type_id: 't1', quantity: 10,
                start_date: '2024-01-01', end_date: '2024-01-31',
                location_type: 'online'
            };
            const capacity: Resource = {
                id: 'c1', type_id: 't1', quantity: 10,
                start_date: '2024-01-01', end_date: '2024-01-31',
                location_type: 'online'
            };
            expect(slotsCompatible(need, capacity)).toBe(true);
        });

        it('should fail if type_id mismatches', () => {
            const need: Resource = { id: 'n1', type_id: 't1', quantity: 1 };
            const capacity: Resource = { id: 'c1', type_id: 't2', quantity: 1 };
            expect(slotsCompatible(need, capacity)).toBe(false);
        });
    });

    describe('timeRangesOverlap', () => {
        it('should detect simple date overlap', () => {
            const s1 = { start_date: '2024-01-01', end_date: '2024-01-10' };
            const s2 = { start_date: '2024-01-05', end_date: '2024-01-15' };
            expect(timeRangesOverlap(s1, s2)).toBe(true);
        });

        it('should detect non-overlap', () => {
            const s1 = { start_date: '2024-01-01', end_date: '2024-01-10' };
            const s2 = { start_date: '2024-01-11', end_date: '2024-01-20' };
            expect(timeRangesOverlap(s1, s2)).toBe(false);
        });

        it('should handle availability windows', () => {
            const w1: AvailabilityWindow = { time_ranges: [{ start_time: '09:00', end_time: '12:00' }] };
            const w2: AvailabilityWindow = { time_ranges: [{ start_time: '11:00', end_time: '14:00' }] };

            const s1 = { recurrence: 'daily', availability_window: w1 };
            const s2 = { recurrence: 'daily', availability_window: w2 };

            expect(timeRangesOverlap(s1, s2)).toBe(true);
        });
    });

    describe('locationsCompatible', () => {
        it('should match same cities', () => {
            const l1 = { city: 'London', country: 'UK' };
            const l2 = { city: 'London', country: 'UK' };
            expect(locationsCompatible(l1, l2)).toBe(true);
        });

        it('should match any with remote', () => {
            const l1 = { location_type: 'remote' };
            const l2 = { city: 'London' };
            expect(locationsCompatible(l1, l2)).toBe(true);
        });
    });

    describe('skillsCompatible', () => {
        it('should return true if no skills required', () => {
            const need: Resource = { id: 'n1', type_id: 't1', quantity: 1 };
            const cap: Resource = { id: 'c1', type_id: 't1', quantity: 1 };
            expect(skillsCompatible(need, undefined, cap, undefined)).toBe(true);
        });

        it('should check provider skills for need', () => {
            const need: Resource = { id: 'n1', type_id: 't1', quantity: 1, required_skills: [{ id: 's1', level: 1 }] };
            const cap: Resource = { id: 'c1', type_id: 't1', quantity: 1 };
            const provider: Contact = { id: 'p1', skills: [{ id: 's1', level: 1 }] };

            expect(skillsCompatible(need, provider, cap, undefined)).toBe(true);
        });

        it('should fail if provider lacks skill', () => {
            const need: Resource = { id: 'n1', type_id: 't1', quantity: 1, required_skills: [{ id: 's1', level: 1 }] };
            const cap: Resource = { id: 'c1', type_id: 't1', quantity: 1 };
            const provider: Contact = { id: 'p1', skills: [] };

            expect(skillsCompatible(need, provider, cap, undefined)).toBe(false);
        });
    });

});
