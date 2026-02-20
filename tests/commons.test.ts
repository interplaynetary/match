import { describe, expect, it, test } from 'bun:test';
import {
    // Schemas
    Score,
    TimeScore,
    SpaceScore,
    QuantityScore,
    SkillsScore,
    TravelScore,
    AffinityScore,
    Breakdown,
    MatchRecord,
    BlockReason,
    RiskFactor,
    Overlap,
    SkillCheck,
    CategoryMatch,
    SemanticScore,
    // Utilities
    scoreValues,
    aggregateScore,
    isBlocked,
    getBlockReasons,
    getRiskFactors,
    buildMatchRecord,
    DIMENSIONS,
} from '$lib/core/plan/process';

// =============================================================================
// SCHEMA VALIDATION TESTS
// =============================================================================

describe('Score Schema', () => {
    it('accepts valid score', () => {
        const result = Score.safeParse({ value: 0.5, reason: 'test' });
        expect(result.success).toBe(true);
    });

    it('rejects value < 0', () => {
        const result = Score.safeParse({ value: -0.1, reason: 'test' });
        expect(result.success).toBe(false);
    });

    it('rejects value > 1', () => {
        const result = Score.safeParse({ value: 1.1, reason: 'test' });
        expect(result.success).toBe(false);
    });

    it('requires reason', () => {
        const result = Score.safeParse({ value: 0.5 });
        expect(result.success).toBe(false);
    });
});

describe('TimeScore Schema', () => {
    it('extends Score with time-specific fields', () => {
        const result = TimeScore.safeParse({
            value: 1,
            reason: 'Full overlap',
            overlaps: [
                { day: 'monday', ranges: [{ start_time: '09:00', end_time: '17:00' }], minutes: 480 }
            ],
            total_hours: 8,
            blocks: 1,
            max_block_min: 480,
        });
        expect(result.success).toBe(true);
    });

    it('validates day enum', () => {
        const result = TimeScore.safeParse({
            value: 1,
            reason: 'test',
            overlaps: [{ day: 'invalid_day', ranges: [], minutes: 0 }],
        });
        expect(result.success).toBe(false);
    });
});

describe('SpaceScore Schema', () => {
    it('accepts valid space score with distance', () => {
        const result = SpaceScore.safeParse({
            value: 0.8,
            reason: '10km away',
            distance_km: 10,
            radius_km: 50,
            remote: false,
        });
        expect(result.success).toBe(true);
    });

    it('accepts remote flag', () => {
        const result = SpaceScore.safeParse({
            value: 1,
            reason: 'Remote possible',
            remote: true,
        });
        expect(result.success).toBe(true);
    });
});

describe('QuantityScore Schema', () => {
    it('requires need, available, allocatable', () => {
        const result = QuantityScore.safeParse({
            value: 0.75,
            reason: 'Partial',
            need: 100,
            available: 75,
            allocatable: 75,
        });
        expect(result.success).toBe(true);
    });

    it('rejects negative quantities', () => {
        const result = QuantityScore.safeParse({
            value: 1,
            reason: 'test',
            need: -10,
            available: 10,
            allocatable: 10,
        });
        expect(result.success).toBe(false);
    });
});

describe('SkillsScore Schema', () => {
    it('accepts skill checks', () => {
        const result = SkillsScore.safeParse({
            value: 1,
            reason: 'All met',
            checks: [
                { id: 'skill1', required: 3, actual: 5, met: true },
                { id: 'skill2', met: true },
            ],
        });
        expect(result.success).toBe(true);
    });
});

describe('Breakdown Schema', () => {
    it('accepts partial breakdown', () => {
        const result = Breakdown.safeParse({
            time: { value: 1, reason: 'ok' },
            space: { value: 0.9, reason: 'near' },
        });
        expect(result.success).toBe(true);
    });

    it('accepts full breakdown', () => {
        const result = Breakdown.safeParse({
            time: { value: 1, reason: 'ok' },
            space: { value: 1, reason: 'ok' },
            quantity: { value: 1, reason: 'ok', need: 10, available: 10, allocatable: 10 },
            skills: { value: 1, reason: 'ok' },
            travel: { value: 1, reason: 'ok' },
            affinity: { value: 1, reason: 'ok' },
            continuity: { value: 1, reason: 'ok' },
        });
        expect(result.success).toBe(true);
    });
});

describe('MatchRecord Schema (Discriminated Union)', () => {
    const baseFields = {
        id: 'match-1',
        capacity_id: 'cap-1',
        need_id: 'need-1',
        score: 0.85,
    };

    it('accepts possible match with risks', () => {
        const result = MatchRecord.safeParse({
            ...baseFields,
            status: 'possible',
            risks: ['FRAGMENTED_TIME', 'PARTIAL_QUANTITY'],
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.status === 'possible') {
            expect(result.data.risks).toContain('FRAGMENTED_TIME');
        }
    });

    it('accepts impossible match with block reasons', () => {
        const result = MatchRecord.safeParse({
            ...baseFields,
            status: 'impossible',
            blocked_by: ['TIME_MISMATCH'],
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.status === 'impossible') {
            expect(result.data.blocked_by).toContain('TIME_MISMATCH');
        }
    });

    it('rejects impossible match without blocked_by', () => {
        const result = MatchRecord.safeParse({
            ...baseFields,
            status: 'impossible',
            blocked_by: [], // min 1 required
        });
        expect(result.success).toBe(false);
    });

    it('accepts optional semantic and breakdown', () => {
        const result = MatchRecord.safeParse({
            ...baseFields,
            status: 'possible',
            risks: [],
            semantic: {
                similarity: 0.9,
                blended: 0.85,
                weight: 1,
                need_expr: 'pizza',
                capacity_expr: 'italian food',
            },
            breakdown: {
                time: { value: 1, reason: 'ok' },
            },
        });
        expect(result.success).toBe(true);
    });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('scoreValues', () => {
    it('extracts numeric values from breakdown', () => {
        const breakdown: Breakdown = {
            time: { value: 0.9, reason: 'ok' },
            space: { value: 1, reason: 'ok' },
            quantity: { value: 0.75, reason: 'partial', need: 100, available: 75, allocatable: 75 },
        };
        const values = scoreValues(breakdown);
        expect(values.time).toBe(0.9);
        expect(values.space).toBe(1);
        expect(values.quantity).toBe(0.75);
        expect(values.skills).toBeUndefined();
    });

    it('returns undefined for missing dimensions', () => {
        const breakdown: Breakdown = {};
        const values = scoreValues(breakdown);
        DIMENSIONS.forEach(d => expect(values[d]).toBeUndefined());
    });
});

describe('aggregateScore', () => {
    it('computes geometric mean of scores', () => {
        const breakdown: Breakdown = {
            time: { value: 1, reason: 'ok' },
            space: { value: 1, reason: 'ok' },
        };
        expect(aggregateScore(breakdown)).toBeCloseTo(1);
    });

    it('returns 0 if any score is 0', () => {
        const breakdown: Breakdown = {
            time: { value: 0, reason: 'blocked' },
            space: { value: 1, reason: 'ok' },
        };
        expect(aggregateScore(breakdown)).toBe(0);
    });

    it('computes correct geometric mean', () => {
        const breakdown: Breakdown = {
            time: { value: 0.81, reason: 'ok' },  // 0.81^0.5 = 0.9
            space: { value: 1, reason: 'ok' },
        };
        // geometric mean of [0.81, 1] = (0.81 * 1)^(1/2) = 0.9
        expect(aggregateScore(breakdown)).toBeCloseTo(0.9);
    });

    it('returns 1 for empty breakdown', () => {
        expect(aggregateScore({})).toBe(1);
    });
});

describe('isBlocked', () => {
    it('returns true if any score is 0', () => {
        const breakdown: Breakdown = {
            time: { value: 0, reason: 'no overlap' },
            space: { value: 1, reason: 'ok' },
        };
        expect(isBlocked(breakdown)).toBe(true);
    });

    it('returns false if all scores > 0', () => {
        const breakdown: Breakdown = {
            time: { value: 0.5, reason: 'partial' },
            space: { value: 1, reason: 'ok' },
        };
        expect(isBlocked(breakdown)).toBe(false);
    });

    it('returns false for empty breakdown', () => {
        expect(isBlocked({})).toBe(false);
    });
});

describe('getBlockReasons', () => {
    it('returns TIME_MISMATCH when time is 0', () => {
        const breakdown: Breakdown = {
            time: { value: 0, reason: 'no overlap' },
        };
        expect(getBlockReasons(breakdown)).toContain('TIME_MISMATCH');
    });

    it('returns LOCATION_MISMATCH when space is 0', () => {
        const breakdown: Breakdown = {
            space: { value: 0, reason: 'too far' },
        };
        expect(getBlockReasons(breakdown)).toContain('LOCATION_MISMATCH');
    });

    it('returns multiple reasons', () => {
        const breakdown: Breakdown = {
            time: { value: 0, reason: 'x' },
            skills: { value: 0, reason: 'x' },
            quantity: { value: 0, reason: 'x', need: 10, available: 0, allocatable: 0 },
        };
        const reasons = getBlockReasons(breakdown);
        expect(reasons).toContain('TIME_MISMATCH');
        expect(reasons).toContain('SKILL_MISMATCH');
        expect(reasons).toContain('QUANTITY_MISMATCH');
    });

    it('returns empty array when no blocks', () => {
        const breakdown: Breakdown = {
            time: { value: 1, reason: 'ok' },
            space: { value: 0.5, reason: 'ok' },
        };
        expect(getBlockReasons(breakdown)).toEqual([]);
    });
});

describe('getRiskFactors', () => {
    it('returns FRAGMENTED_TIME when continuity < 1', () => {
        const breakdown: Breakdown = {
            continuity: { value: 0.5, reason: 'fragmented' },
        };
        expect(getRiskFactors(breakdown)).toContain('FRAGMENTED_TIME');
    });

    it('returns TIGHT_TRAVEL when travel < 1 but > 0', () => {
        const breakdown: Breakdown = {
            travel: { value: 0.7, reason: 'rush' },
        };
        expect(getRiskFactors(breakdown)).toContain('TIGHT_TRAVEL');
    });

    it('does not include travel risk when travel is 0 (blocked)', () => {
        const breakdown: Breakdown = {
            travel: { value: 0, reason: 'impossible' },
        };
        expect(getRiskFactors(breakdown)).not.toContain('TIGHT_TRAVEL');
    });

    it('returns PARTIAL_QUANTITY when quantity < 1 but > 0', () => {
        const breakdown: Breakdown = {
            quantity: { value: 0.75, reason: 'partial', need: 100, available: 75, allocatable: 75 },
        };
        expect(getRiskFactors(breakdown)).toContain('PARTIAL_QUANTITY');
    });

    it('returns LOW_TRUST when affinity < 0.5 but > 0', () => {
        const breakdown: Breakdown = {
            affinity: { value: 0.3, reason: 'low trust' },
        };
        expect(getRiskFactors(breakdown)).toContain('LOW_TRUST');
    });
});

describe('buildMatchRecord', () => {
    const ids = { id: 'match-1', need_id: 'n1', capacity_id: 'c1' };

    it('builds possible match when no blocks', () => {
        const breakdown: Breakdown = {
            time: { value: 1, reason: 'ok' },
            quantity: { value: 1, reason: 'ok', need: 10, available: 10, allocatable: 10 },
        };
        const record = buildMatchRecord(ids, breakdown);
        expect(record.status).toBe('possible');
        expect(record.score).toBeCloseTo(1);
    });

    it('builds impossible match when blocked', () => {
        const breakdown: Breakdown = {
            time: { value: 0, reason: 'no overlap' },
        };
        const record = buildMatchRecord(ids, breakdown);
        expect(record.status).toBe('impossible');
        if (record.status === 'impossible') {
            expect(record.blocked_by).toContain('TIME_MISMATCH');
        }
    });

    it('includes allocatable from quantity score', () => {
        const breakdown: Breakdown = {
            quantity: { value: 0.5, reason: 'partial', need: 100, available: 50, allocatable: 50 },
        };
        const record = buildMatchRecord(ids, breakdown);
        expect(record.allocatable).toBe(50);
    });

    it('includes semantic when provided', () => {
        const breakdown: Breakdown = { time: { value: 1, reason: 'ok' } };
        const semantic: SemanticScore = {
            similarity: 0.9,
            blended: 0.85,
            weight: 1,
            need_expr: 'pizza',
            capacity_expr: 'food',
        };
        const record = buildMatchRecord(ids, breakdown, { semantic });
        expect(record.semantic?.similarity).toBe(0.9);
    });

    it('includes breakdown in record', () => {
        const breakdown: Breakdown = {
            time: { value: 0.8, reason: '2 blocks' },
            space: { value: 1, reason: 'remote' },
        };
        const record = buildMatchRecord(ids, breakdown);
        expect(record.breakdown?.time?.value).toBe(0.8);
        expect(record.breakdown?.space?.reason).toBe('remote');
    });

    it('computes risks for possible matches', () => {
        const breakdown: Breakdown = {
            time: { value: 1, reason: 'ok' },
            continuity: { value: 0.5, reason: 'fragmented' },
            quantity: { value: 0.8, reason: 'partial', need: 100, available: 80, allocatable: 80 },
        };
        const record = buildMatchRecord(ids, breakdown);
        expect(record.status).toBe('possible');
        if (record.status === 'possible') {
            expect(record.risks).toContain('FRAGMENTED_TIME');
            expect(record.risks).toContain('PARTIAL_QUANTITY');
        }
    });
});

// =============================================================================
// ENUM TESTS
// =============================================================================

describe('BlockReason Enum', () => {
    it('contains all expected values', () => {
        const expected = [
            'TIME_MISMATCH',
            'LOCATION_MISMATCH',
            'SKILL_MISMATCH',
            'QUANTITY_MISMATCH',
            'CATEGORY_CONFLICT',
            'TRAVEL_TIME_VIOLATION',
            'EXCLUSION_RULE',
            'ALREADY_COMMITTED',
        ];
        expected.forEach(reason => {
            expect(BlockReason.safeParse(reason).success).toBe(true);
        });
    });

    it('rejects invalid values', () => {
        expect(BlockReason.safeParse('INVALID_REASON').success).toBe(false);
    });
});

describe('RiskFactor Enum', () => {
    it('contains all expected values', () => {
        const expected = [
            'FRAGMENTED_TIME',
            'TIGHT_TRAVEL',
            'PARTIAL_QUANTITY',
            'LOW_TRUST',
            'MARGINAL_SKILL',
            'NEAR_BOUNDARY',
        ];
        expected.forEach(risk => {
            expect(RiskFactor.safeParse(risk).success).toBe(true);
        });
    });
});

describe('DIMENSIONS constant', () => {
    it('lists all 7 dimensions', () => {
        expect(DIMENSIONS).toHaveLength(7);
        expect(DIMENSIONS).toContain('time');
        expect(DIMENSIONS).toContain('space');
        expect(DIMENSIONS).toContain('quantity');
        expect(DIMENSIONS).toContain('skills');
        expect(DIMENSIONS).toContain('travel');
        expect(DIMENSIONS).toContain('affinity');
        expect(DIMENSIONS).toContain('continuity');
    });
});
