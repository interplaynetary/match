import { describe, expect, it, test } from 'bun:test';
import {
    computeBreakdown,
    computeMatchRecord,
    calculateFeasibility,
    computeTimeScore,
    computeSpaceScore,
    computeQuantityScore,
    computeSkillsScore,
    computeTravelScore,
    computeAffinityScore,
    computeContinuityScore,
    type FeasibilityContext,
} from '$lib/core/plan/feasibility';
import type { Resource } from '$lib/core/plan/process';
import type { Contact } from '$lib/core/types';
import type { AvailabilityWindow } from '$lib/core/plan/time';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const makeResource = (overrides: Partial<Resource> = {}): Resource => ({
    id: 'r1',
    type_id: 'type1',
    quantity: 10,
    ...overrides,
});

const makeWindow = (days: string[], startTime: string, endTime: string): AvailabilityWindow => ({
    day_schedules: [{
        days: days as any,
        time_ranges: [{ start_time: startTime, end_time: endTime }],
    }],
});

// =============================================================================
// INDIVIDUAL SCORE FUNCTION TESTS
// =============================================================================

describe('computeTimeScore', () => {
    it('returns 1 when both have no time constraints', () => {
        const need = makeResource();
        const capacity = makeResource({ id: 'c1' });
        const score = computeTimeScore(need, capacity);
        expect(score.value).toBe(1);
        expect(score.reason).toContain('No specific time constraints');
    });

    it('returns 0 when no time overlap', () => {
        const need = makeResource({
            recurrence: 'weekly',
            availability_window: makeWindow(['monday'], '09:00', '12:00'),
        });
        const capacity = makeResource({
            id: 'c1',
            recurrence: 'weekly',
            availability_window: makeWindow(['tuesday'], '09:00', '12:00'), // Different day
        });
        const score = computeTimeScore(need, capacity);
        expect(score.value).toBe(0);
        expect(score.reason).toContain('No time overlap');
    });

    it('computes overlap details with availability windows', () => {
        const window = makeWindow(['monday', 'wednesday'], '09:00', '12:00');
        const need = makeResource({
            recurrence: 'weekly',
            availability_window: window,
        });
        const capacity = makeResource({
            id: 'c1',
            recurrence: 'weekly',
            availability_window: window,
        });
        const score = computeTimeScore(need, capacity);
        expect(score.value).toBe(1);
        expect(score.overlaps).toBeDefined();
        expect(score.total_hours).toBeGreaterThan(0);
        expect(score.blocks).toBeGreaterThan(0);
    });

    it('returns 0 when max block < min_atomic_size', () => {
        const window = makeWindow(['monday'], '09:00', '09:30'); // 30 min block
        const need = makeResource({
            recurrence: 'weekly',
            availability_window: window,
            min_atomic_size: 60, // requires 60 min
        });
        const capacity = makeResource({
            id: 'c1',
            recurrence: 'weekly',
            availability_window: window,
        });
        const score = computeTimeScore(need, capacity);
        expect(score.value).toBe(0);
        expect(score.reason).toContain('min_atomic_size');
    });
});

describe('computeSpaceScore', () => {
    it('returns 1 for remote/online', () => {
        const need = makeResource({ online_link: 'https://zoom.us/123' });
        const capacity = makeResource({ id: 'c1', latitude: 51.5, longitude: -0.1 });
        const score = computeSpaceScore(need, capacity);
        expect(score.value).toBe(1);
        expect(score.remote).toBe(true);
    });

    it('returns 1 when no location constraints', () => {
        const need = makeResource();
        const capacity = makeResource({ id: 'c1' });
        const score = computeSpaceScore(need, capacity);
        expect(score.value).toBe(1);
        expect(score.reason).toContain('No location constraints');
    });

    it('returns 0 when distance exceeds radius', () => {
        const need = makeResource({
            latitude: 51.5,
            longitude: -0.1,
            search_radius_km: 10,
        });
        const capacity = makeResource({
            id: 'c1',
            latitude: 52.5, // ~111km away
            longitude: -0.1,
        });
        const score = computeSpaceScore(need, capacity);
        expect(score.value).toBe(0);
        expect(score.distance_km).toBeGreaterThan(10);
    });

    it('decays linearly with distance', () => {
        const need = makeResource({
            latitude: 51.5,
            longitude: -0.1,
            search_radius_km: 100,
        });
        const capacity = makeResource({
            id: 'c1',
            latitude: 51.95, // ~50km away
            longitude: -0.1,
        });
        const score = computeSpaceScore(need, capacity);
        expect(score.value).toBeGreaterThan(0);
        expect(score.value).toBeLessThan(1);
        expect(score.distance_km).toBeDefined();
    });
});

describe('computeQuantityScore', () => {
    it('returns 1 when capacity >= need', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 15 });
        const score = computeQuantityScore(need, capacity);
        expect(score.value).toBe(1);
        expect(score.allocatable).toBe(10);
    });

    it('returns ratio when capacity < need', () => {
        const need = makeResource({ quantity: 100 });
        const capacity = makeResource({ id: 'c1', quantity: 75 });
        const score = computeQuantityScore(need, capacity);
        expect(score.value).toBeCloseTo(0.75);
        expect(score.allocatable).toBe(75);
        expect(score.need).toBe(100);
        expect(score.available).toBe(75);
    });

    it('returns 0 when no capacity', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 0 });
        const score = computeQuantityScore(need, capacity);
        expect(score.value).toBe(0);
        expect(score.allocatable).toBe(0);
    });

    it('includes unit when provided', () => {
        const need = makeResource({ quantity: 10, unit: 'hours' });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const score = computeQuantityScore(need, capacity);
        expect(score.unit).toBe('hours');
    });
});

describe('computeSkillsScore', () => {
    it('returns 1 when no skills required', () => {
        const need = makeResource();
        const capacity = makeResource({ id: 'c1' });
        const score = computeSkillsScore(need, capacity);
        expect(score.value).toBe(1);
    });

    it('returns 1 when all skills met', () => {
        const need = makeResource({
            required_skills: [{ id: 'skill1', level: 3 }],
        });
        const capacity = makeResource({ id: 'c1' });
        const provider: Contact = {
            id: 'p1',
            skills: [{ id: 'skill1', level: 5 }],
        };
        const score = computeSkillsScore(need, capacity, provider);
        expect(score.value).toBe(1);
        expect(score.checks?.[0]?.met).toBe(true);
    });

    it('returns 0 when skill missing', () => {
        const need = makeResource({
            required_skills: [{ id: 'skill1' }],
        });
        const capacity = makeResource({ id: 'c1' });
        const provider: Contact = { id: 'p1', skills: [] };
        const score = computeSkillsScore(need, capacity, provider);
        expect(score.value).toBe(0);
        expect(score.reason).toContain('Missing');
    });

    it('returns 0 when skill level insufficient', () => {
        const need = makeResource({
            required_skills: [{ id: 'skill1', level: 5 }],
        });
        const capacity = makeResource({ id: 'c1' });
        const provider: Contact = {
            id: 'p1',
            skills: [{ id: 'skill1', level: 3 }],
        };
        const score = computeSkillsScore(need, capacity, provider);
        expect(score.value).toBe(0);
    });

    it('checks seeker skills for capacity requirements', () => {
        const need = makeResource();
        const capacity = makeResource({
            id: 'c1',
            required_skills: [{ id: 'certification' }],
        });
        const seeker: Contact = { id: 's1', skills: [] };
        const score = computeSkillsScore(need, capacity, undefined, seeker);
        expect(score.value).toBe(0);
    });
});

describe('computeTravelScore', () => {
    it('returns 1 when no previous commitment', () => {
        const capacity = makeResource({ id: 'c1' });
        const score = computeTravelScore(capacity);
        expect(score.value).toBe(1);
        expect(score.reason).toContain('No prior commitment');
    });

    it('returns 1 when same location', () => {
        const capacity = makeResource({
            id: 'c1',
            latitude: 51.5,
            longitude: -0.1,
            availability_window: { time_ranges: [{ start_time: '10:00', end_time: '12:00' }] },
        });
        const prev = { latitude: 51.5, longitude: -0.1, end_time: '09:00' };
        const score = computeTravelScore(capacity, prev);
        expect(score.value).toBe(1);
    });

    it('returns 0 when impossible travel speed required', () => {
        const capacity = makeResource({
            id: 'c1',
            latitude: 52.5, // ~111km from prev
            longitude: -0.1,
            availability_window: { time_ranges: [{ start_time: '09:30', end_time: '12:00' }] },
        });
        const prev = { latitude: 51.5, longitude: -0.1, end_time: '09:00' }; // 30 min for 111km
        const score = computeTravelScore(capacity, prev);
        expect(score.value).toBe(0);
        expect(score.speed_kmh).toBeGreaterThan(80);
    });

    it('returns partial score for tight but possible travel', () => {
        const capacity = makeResource({
            id: 'c1',
            latitude: 51.6, // ~11km from prev
            longitude: -0.1,
            availability_window: { time_ranges: [{ start_time: '09:30', end_time: '12:00' }] },
        });
        const prev = { latitude: 51.5, longitude: -0.1, end_time: '09:00' };
        const score = computeTravelScore(capacity, prev);
        expect(score.value).toBeGreaterThan(0);
        expect(score.value).toBeLessThanOrEqual(1);
    });
});

describe('computeAffinityScore', () => {
    it('returns 1 when no weights defined', () => {
        const score = computeAffinityScore('owner1', 'owner2');
        expect(score.value).toBe(1);
        expect(score.reason).toContain('Default trust');
    });

    it('returns 0 when blocked', () => {
        const seekerWeights = { owner1: 0 };
        const score = computeAffinityScore('owner1', 'owner2', null, seekerWeights);
        expect(score.value).toBe(0);
        expect(score.reason).toContain('Blocked');
    });

    it('returns minimum of bidirectional trust', () => {
        const providerWeights = { owner2: 0.8 };
        const seekerWeights = { owner1: 0.6 };
        const score = computeAffinityScore('owner1', 'owner2', providerWeights, seekerWeights);
        expect(score.value).toBe(0.6);
    });
});

describe('computeContinuityScore', () => {
    it('returns 1 for single block', () => {
        const timeScore = { value: 1, reason: 'ok', blocks: 1, total_hours: 4 };
        const need = makeResource();
        const score = computeContinuityScore(timeScore, need);
        expect(score.value).toBe(1);
    });

    it('penalizes fragmentation', () => {
        const timeScore = { value: 1, reason: 'ok', blocks: 4, total_hours: 4 };
        const need = makeResource();
        const score = computeContinuityScore(timeScore, need);
        expect(score.value).toBeLessThan(1);
    });

    it('penalizes small blocks below min_atomic_size', () => {
        const timeScore = { value: 1, reason: 'ok', blocks: 4, total_hours: 2 }; // 30min avg
        const need = makeResource({ min_atomic_size: 60 }); // wants 60min
        const score = computeContinuityScore(timeScore, need);
        expect(score.value).toBeLessThan(0.25); // base penalty * size penalty
    });
});

// =============================================================================
// COMPOSITE FUNCTION TESTS
// =============================================================================

describe('computeBreakdown', () => {
    it('computes all dimensions', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const breakdown = computeBreakdown(need, capacity);

        expect(breakdown.time).toBeDefined();
        expect(breakdown.space).toBeDefined();
        expect(breakdown.quantity).toBeDefined();
        expect(breakdown.skills).toBeDefined();
        expect(breakdown.travel).toBeDefined();
        expect(breakdown.affinity).toBeDefined();
        expect(breakdown.continuity).toBeDefined();
    });

    it('passes context to relevant scorers', () => {
        const need = makeResource({
            quantity: 10,
            required_skills: [{ id: 'skill1' }],
        });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const provider: Contact = { id: 'p1', skills: [{ id: 'skill1' }] };

        const breakdown = computeBreakdown(need, capacity, { provider });
        expect(breakdown.skills?.value).toBe(1);
    });
});

describe('computeMatchRecord', () => {
    it('returns possible match for compatible resources', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const record = computeMatchRecord(need, capacity);

        expect(record.status).toBe('possible');
        expect(record.score).toBeGreaterThan(0);
        expect(record.need_id).toBe('r1');
        expect(record.capacity_id).toBe('c1');
    });

    it('returns impossible match when blocked', () => {
        const need = makeResource({
            quantity: 10,
            recurrence: 'weekly',
            availability_window: makeWindow(['monday'], '09:00', '12:00'),
        });
        const capacity = makeResource({
            id: 'c1',
            quantity: 10,
            recurrence: 'weekly',
            availability_window: makeWindow(['tuesday'], '09:00', '12:00'), // Different day
        });
        const record = computeMatchRecord(need, capacity);

        expect(record.status).toBe('impossible');
        if (record.status === 'impossible') {
            expect(record.blocked_by).toContain('TIME_MISMATCH');
        }
    });

    it('includes breakdown', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const record = computeMatchRecord(need, capacity);

        expect(record.breakdown).toBeDefined();
        expect(record.breakdown?.time).toBeDefined();
    });

    it('includes allocatable quantity', () => {
        const need = makeResource({ quantity: 100 });
        const capacity = makeResource({ id: 'c1', quantity: 75 });
        const record = computeMatchRecord(need, capacity);

        expect(record.allocatable).toBe(75);
    });

    it('includes semantic when provided', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const record = computeMatchRecord(need, capacity, {
            semantic: {
                similarity: 0.9,
                blended: 0.85,
                weight: 1,
                need_expr: 'test',
                capacity_expr: 'test',
            },
        });

        expect(record.semantic?.similarity).toBe(0.9);
    });

    it('generates unique id', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const record1 = computeMatchRecord(need, capacity);
        const record2 = computeMatchRecord(need, capacity);

        expect(record1.id).not.toBe(record2.id);
    });
});

describe('calculateFeasibility', () => {
    it('returns possible status for compatible resources', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const result = calculateFeasibility(need, capacity);

        expect(result.type).toBe('possible');
        if (result.type === 'possible') {
            expect(result.confidence).toBeGreaterThan(0);
        }
    });

    it('returns impossible status with reasons', () => {
        const need = makeResource({
            quantity: 10,
            recurrence: 'weekly',
            availability_window: makeWindow(['monday'], '09:00', '12:00'),
        });
        const capacity = makeResource({
            id: 'c1',
            quantity: 10,
            recurrence: 'weekly',
            availability_window: makeWindow(['tuesday'], '09:00', '12:00'), // Different day
        });
        const result = calculateFeasibility(need, capacity);

        expect(result.type).toBe('impossible');
        if (result.type === 'impossible') {
            expect(result.reasons).toContain('TIME_MISMATCH');
        }
    });

    it('includes legacy scores format', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const result = calculateFeasibility(need, capacity);

        expect(result.scores.time).toBeDefined();
        expect(result.scores.location).toBeDefined();
        expect(result.scores.skills).toBeDefined();
        expect(result.scores.travel).toBeDefined();
        expect(result.scores.resources).toBeDefined();
        expect(result.scores.affinity).toBeDefined();
        expect(result.scores.continuity).toBeDefined();
    });

    it('includes breakdown when requested', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const result = calculateFeasibility(need, capacity, { includeBreakdown: true });

        expect(result.breakdown).toBeDefined();
    });

    it('excludes breakdown by default', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const result = calculateFeasibility(need, capacity);

        expect(result.breakdown).toBeUndefined();
    });

    it('identifies risk factors', () => {
        const need = makeResource({ quantity: 100 });
        const capacity = makeResource({ id: 'c1', quantity: 75 });
        const result = calculateFeasibility(need, capacity);

        expect(result.type).toBe('possible');
        if (result.type === 'possible') {
            expect(result.risk_factors).toContain('PARTIAL_QUANTITY');
        }
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
    it('handles zero quantity need', () => {
        const need = makeResource({ quantity: 0 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const score = computeQuantityScore(need, capacity);
        expect(score.value).toBe(1); // 0/0 defaults to 1
    });

    it('handles missing provider for skill check', () => {
        const need = makeResource({ required_skills: [{ id: 's1' }] });
        const capacity = makeResource({ id: 'c1' });
        // No provider passed - should fail skill check
        const score = computeSkillsScore(need, capacity);
        expect(score.value).toBe(0);
    });

    it('handles undefined availability windows gracefully', () => {
        const need = makeResource();
        const capacity = makeResource({ id: 'c1' });
        const score = computeTimeScore(need, capacity);
        expect(score.value).toBe(1);
    });

    it('handles empty breakdown', () => {
        const need = makeResource({ quantity: 10 });
        const capacity = makeResource({ id: 'c1', quantity: 10 });
        const breakdown = computeBreakdown(need, capacity);
        const record = computeMatchRecord(need, capacity);

        // Should not throw
        expect(record.status).toBe('possible');
    });
});
