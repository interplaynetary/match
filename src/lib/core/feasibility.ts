import * as z from 'zod';
import { nanoid } from 'nanoid';
import {
    type Resource,
    type Score,
    type TimeScore,
    type SpaceScore,
    type QuantityScore,
    type SkillsScore,
    type TravelScore,
    type AffinityScore,
    type Breakdown,
    type Overlap,
    type BlockReason,
    type RiskFactor,
    type MatchRecord,
    type SemanticScore,
    buildMatchRecord,
    getBlockReasons,
    getRiskFactors,
} from './commons';
import { type Contact } from './types';
import { type FeasibilityStatus, type FeasibilityScores } from './desire.js';
import { availabilityWindowsOverlapWithTimezone, calculateAvailabilityIntersection } from './matching.js';
import { haversineDistance, REMOTE_H3_INDEX, DEFAULT_SEARCH_RADIUS_KM } from './spatial.js';

// ═══════════════════════════════════════════════════════════════════
// SCORE CALCULATORS (7 Dimensions)
// Each returns a detailed breakdown structure for rich analysis.
// These are exported for use in matching.ts and elsewhere.
// ═══════════════════════════════════════════════════════════════════

const GlobalRecognitionWeightsSchema = z.map(z.string(), z.number());
type GlobalRecognitionWeights = z.infer<typeof GlobalRecognitionWeightsSchema>;

/** Helper to parse HH:MM to minutes */
function parseTimeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

/**
 * 1. TIME SCORE
 * Computes time overlap with detailed intersection info.
 */
function computeTimeScore(need: Resource, capacity: Resource): TimeScore {
    const hasOverlap = availabilityWindowsOverlapWithTimezone(
        need.availability_window,
        capacity.availability_window,
        need.time_zone,
        capacity.time_zone
    );

    if (!hasOverlap) {
        return { value: 0, reason: 'No time overlap between availability windows' };
    }

    if (!need.availability_window || !capacity.availability_window) {
        return { value: 1, reason: 'No specific time constraints defined' };
    }

    const intersection = calculateAvailabilityIntersection(
        need.availability_window,
        capacity.availability_window,
        need.time_zone,
        capacity.time_zone
    );

    const overlaps: Overlap[] = [];
    let totalMinutes = 0;
    let maxBlockMin = 0;
    let blocks = 0;

    if (intersection.day_schedules) {
        for (const ds of intersection.day_schedules) {
            for (const day of ds.days) {
                let dayMins = 0;
                for (const range of ds.time_ranges) {
                    const mins = parseTimeToMinutes(range.end_time) - parseTimeToMinutes(range.start_time);
                    dayMins += mins;
                    if (mins > maxBlockMin) maxBlockMin = mins;
                    blocks++;
                }
                totalMinutes += dayMins;
                overlaps.push({ day, ranges: ds.time_ranges, minutes: dayMins });
            }
        }
    }

    const minSize = need.min_atomic_size;
    if (minSize && minSize > 0 && maxBlockMin < minSize) {
        return {
            value: 0,
            reason: `Largest block (${maxBlockMin}min) < min_atomic_size (${minSize}min)`,
            overlaps,
            total_hours: totalMinutes / 60,
            blocks,
            max_block_min: maxBlockMin,
        };
    }

    return {
        value: 1,
        reason: `${blocks} block(s), ${Math.round(totalMinutes / 6) / 10}h total`,
        overlaps,
        total_hours: totalMinutes / 60,
        blocks,
        max_block_min: maxBlockMin,
    };
}

/**
 * CONTINUITY SCORE (Fragmentation analysis)
 */
function computeContinuityScore(time: TimeScore, need: Resource): Score {
    const blocks = time.blocks ?? 1;
    const totalMinutes = (time.total_hours ?? 0) * 60;

    if (blocks === 0) return { value: 0, reason: 'No time blocks' };
    if (blocks === 1) return { value: 1, reason: 'Single contiguous block' };

    const target = need.min_atomic_size ?? 60;
    const avg = totalMinutes / blocks;
    let v = 1.0 / blocks;
    if (avg < target) v *= avg / target;

    return {
        value: Math.max(0, Math.min(1, v)),
        reason: `${blocks} blocks, avg ${Math.round(avg)}min (target: ${target}min)`
    };
}

/**
 * 2. SPACE SCORE (Distance Decay)
 */
function computeSpaceScore(need: Resource, capacity: Resource): SpaceScore {
    const needRemote = need.h3_index === REMOTE_H3_INDEX || need.online_link;
    const capacityRemote = capacity.h3_index === REMOTE_H3_INDEX || capacity.online_link;

    if (needRemote || capacityRemote) {
        return { value: 1, reason: 'Remote/online possible', remote: true };
    }

    if (!need.latitude || !need.longitude || !capacity.latitude || !capacity.longitude) {
        return { value: 1, reason: 'No location constraints' };
    }

    const dist = haversineDistance(need.latitude, need.longitude, capacity.latitude, capacity.longitude);
    const radius = need.search_radius_km ?? DEFAULT_SEARCH_RADIUS_KM;

    if (dist > radius) {
        return { value: 0, reason: `${dist.toFixed(1)}km > ${radius}km radius`, distance_km: dist, radius_km: radius };
    }

    const v = Math.max(0, 1 - dist / radius);
    return { value: v, reason: `${dist.toFixed(1)}km (${Math.round(v * 100)}%)`, distance_km: dist, radius_km: radius };
}

/**
 * 3. SKILLS SCORE
 */
function computeSkillsScore(need: Resource, capacity: Resource, provider?: Contact, seeker?: Contact): SkillsScore {
    const check = (reqs: typeof need.required_skills, contact?: Contact) =>
        (reqs ?? []).map(r => {
            const s = contact?.skills.find(x => x.id === r.id);
            const met = s ? (r.level === undefined || s.level === undefined || Number(s.level) >= Number(r.level)) : false;
            return { id: r.id, required: r.level, actual: s?.level, met };
        });

    const checks = [...check(need.required_skills, provider), ...check(capacity.required_skills, seeker)];
    const unmet = checks.filter(c => !c.met);

    if (unmet.length) {
        return { value: 0, reason: `Missing: ${unmet.map(c => c.id).join(', ')}`, checks };
    }
    return { value: 1, reason: checks.length ? 'All skills met' : 'No requirements', checks: checks.length ? checks : undefined };
}

/**
 * 4. TRAVEL SCORE (Spatio-Temporal)
 */
function computeTravelScore(capacity: Resource, prev?: { latitude: number; longitude: number; end_time: string }): TravelScore {
    if (!prev) return { value: 1, reason: 'No prior commitment' };
    if (!capacity.latitude || !capacity.longitude) return { value: 1, reason: 'No location data' };

    const raw = haversineDistance(prev.latitude, prev.longitude, capacity.latitude, capacity.longitude);
    if (raw <= 0.1) return { value: 1, reason: 'Same location', distance_km: raw };

    const dist = raw * 1.5; // tortuosity
    const startStr = capacity.availability_window?.time_ranges?.[0]?.start_time;
    if (!startStr) return { value: 1, reason: 'No start time', distance_km: dist };

    const deltaMins = parseTimeToMinutes(startStr) - parseTimeToMinutes(prev.end_time);
    if (deltaMins <= 0) return { value: 0, reason: 'Starts before previous ends', distance_km: dist, time_hours: 0 };

    const hours = deltaMins / 60;
    const speed = dist / hours;

    if (speed > 80) return { value: 0, reason: `Need ${speed.toFixed(0)}km/h (max 80)`, distance_km: dist, time_hours: hours, speed_kmh: speed };

    const v = speed <= 30 ? 1 : Math.max(0.1, 1 - (speed - 30) / 50 * 0.9);
    return { value: v, reason: `${dist.toFixed(1)}km in ${hours.toFixed(1)}h`, distance_km: dist, time_hours: hours, speed_kmh: speed };
}

/**
 * 5. QUANTITY SCORE
 */
function computeQuantityScore(need: Resource, capacity: Resource): QuantityScore {
    const alloc = Math.min(need.quantity, capacity.quantity);
    const ratio = need.quantity > 0 ? alloc / need.quantity : 1;

    if (capacity.quantity >= need.quantity) {
        return { value: 1, reason: `Full (${capacity.quantity} >= ${need.quantity})`, need: need.quantity, available: capacity.quantity, allocatable: alloc, unit: need.unit };
    }
    if (capacity.quantity <= 0) {
        return { value: 0, reason: 'None available', need: need.quantity, available: 0, allocatable: 0, unit: need.unit };
    }
    return { value: ratio, reason: `${capacity.quantity}/${need.quantity} (${Math.round(ratio * 100)}%)`, need: need.quantity, available: capacity.quantity, allocatable: alloc, unit: need.unit };
}

/**
 * 6. AFFINITY SCORE (Trust)
 */
function computeAffinityScore(
    capacityOwner?: string,
    needOwner?: string,
    providerWeights?: GlobalRecognitionWeights | null,
    seekerWeights?: GlobalRecognitionWeights | null
): AffinityScore {
    const s2p = (capacityOwner && seekerWeights?.[capacityOwner]) ?? 1;
    const p2s = (needOwner && providerWeights?.[needOwner]) ?? 1;
    const v = Math.min(s2p, p2s);

    if (v === 1) return { value: 1, reason: 'Default trust', seeker_to_provider: s2p, provider_to_seeker: p2s };
    if (v === 0) return { value: 0, reason: 'Blocked', seeker_to_provider: s2p, provider_to_seeker: p2s };
    return { value: v, reason: `Trust ${Math.round(v * 100)}%`, seeker_to_provider: s2p, provider_to_seeker: p2s };
}



// ═══════════════════════════════════════════════════════════════════
// MAIN FEASIBILITY CHECKER
// ═══════════════════════════════════════════════════════════════════

export interface FeasibilityContext {
    provider?: Contact;
    seeker?: Contact;
    providerWeights?: GlobalRecognitionWeights | null;
    seekerWeights?: GlobalRecognitionWeights | null;
    previousCommitment?: {
        latitude: number;
        longitude: number;
        end_time: string;
    };
    /** Include detailed breakdowns in the result (for debugging/UI) */
    includeBreakdown?: boolean;
}

/**
 * Calculate feasibility (returns FeasibilityStatus for desire.ts compatibility).
 */
export function calculateFeasibility(
    need: Resource,
    capacity: Resource,
    ctx: FeasibilityContext = {}
): FeasibilityStatus {
    const breakdown = computeBreakdown(need, capacity, ctx);

    // Legacy scores format
    const scores: FeasibilityScores = {
        time: breakdown.time?.value ?? 1,
        location: breakdown.space?.value ?? 1,
        skills: breakdown.skills?.value ?? 1,
        travel: breakdown.travel?.value ?? 1,
        resources: breakdown.quantity?.value ?? 1,
        affinity: breakdown.affinity?.value ?? 1,
        continuity: breakdown.continuity?.value ?? 1,
    };

    const confidence = Object.values(scores).reduce((a, b) => a * b, 1);
    const reasons = getBlockReasons(breakdown);

    if (reasons.length) {
        return {
            type: 'impossible',
            reasons,
            scores,
            breakdown: ctx.includeBreakdown ? breakdown : undefined,
        };
    }

    const risk_factors = getRiskFactors(breakdown);
    return {
        type: 'possible',
        confidence,
        risk_factors: risk_factors.length ? risk_factors : undefined,
        scores,
        breakdown: ctx.includeBreakdown ? breakdown : undefined,
    };
}

// ═══════════════════════════════════════════════════════════════════
// MATCH RECORD BUILDER
// ═══════════════════════════════════════════════════════════════════

export interface MatchContext extends FeasibilityContext {
    semantic?: SemanticScore;
}

/**
 * Compute breakdown for a need-capacity pair.
 */
export function computeBreakdown(need: Resource, capacity: Resource, ctx: FeasibilityContext = {}): Breakdown {
    const time = computeTimeScore(need, capacity);
    return {
        time,
        space: computeSpaceScore(need, capacity),
        quantity: computeQuantityScore(need, capacity),
        skills: computeSkillsScore(need, capacity, ctx.provider, ctx.seeker),
        travel: computeTravelScore(capacity, ctx.previousCommitment),
        affinity: computeAffinityScore(capacity.offerer, need.offerer, ctx.providerWeights, ctx.seekerWeights),
        continuity: computeContinuityScore(time, need),
    };
}

/**
 * Compute a full MatchRecord from a need and capacity.
 */
export function computeMatchRecord(need: Resource, capacity: Resource, ctx: MatchContext = {}): MatchRecord {
    const breakdown = computeBreakdown(need, capacity, ctx);
    return buildMatchRecord(
        { id: nanoid(), need_id: need.id, capacity_id: capacity.id },
        breakdown,
        { semantic: ctx.semantic }
    );
}

// Export individual score functions for composition
export {
    computeTimeScore,
    computeSpaceScore,
    computeQuantityScore,
    computeSkillsScore,
    computeTravelScore,
    computeAffinityScore,
    computeContinuityScore,
};
