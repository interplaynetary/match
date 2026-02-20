import { z } from 'zod';
import jsonLogic from 'json-logic-js';
import { SkillSchema } from './skills';
import {
    TimeRangeSchema,
    DayOfWeekSchema,
    DayScheduleSchema,
    AvailabilityWindowSchema,
    type TimeRange,
    type DayOfWeek,
    type DaySchedule,
    type AvailabilityWindow
} from './time';
import { nanoid } from 'nanoid';
import { NanoId } from './ids';
import type { EffectStream } from './effect-stream';
import { deriveProcess, type ProcessDerivedState } from './derivation';

// Re-export time types for convenience
export { TimeRangeSchema, DayOfWeekSchema, DayScheduleSchema, AvailabilityWindowSchema };
export type { TimeRange, DayOfWeek, DaySchedule, AvailabilityWindow };

// Re-export NanoId (many files import it from process)
export { NanoId };

// =============================================================================
// ACCEPTANCE LOGIC
// =============================================================================

const AutomaticAcceptance = z.object({
    type: z.literal('automatic'),
    rule: z.any(),
});

const GovernedAcceptance = z.object({
    type: z.literal('governed'),
    rightHolder: z.enum(['offeror', 'other']),
    rightHolderIds: z.array(z.string()).optional(),
});

export const AcceptanceLogic = z.union([AutomaticAcceptance, GovernedAcceptance]);
export type AcceptanceLogic = z.infer<typeof AcceptanceLogic>;

export function checkAcceptance(logic: AcceptanceLogic, context: any): boolean {
    if (logic.type === 'automatic') {
        try { return jsonLogic.apply(logic.rule, context) === true; }
        catch { return false; }
    }
    return false;
}

// =============================================================================
// DESCRIPTIONS
// =============================================================================

export const ProcessDescription = z.union([
    z.object({
        type: z.literal('templated_strict'),
        requirements: z.object({
            wordCount: z.number().optional(),
            characterCount: z.number().optional(),
            format: z.string().optional(),
        }),
        template: z.string(),
    }),
    z.object({
        type: z.literal('templated_lazy'),
        description: z.string(),
        template: z.string(),
    }),
    z.string(),
]);
export type ProcessDescription = z.infer<typeof ProcessDescription>;

// =============================================================================
// RESOURCE
// =============================================================================
// Everything about a resource: what it is, constraints, and context.
// No artificial separation between "definition" and "context".

export const Resource = z.object({
    id: NanoId,
    // What
    type_id: z.string().min(1),
    quantity: z.number().gte(0),
    unit: z.string().optional(),
    emoji: z.string().optional(),
    description: z.string().optional(),

    // Constraints
    min_atomic_size: z.number().positive().optional(),
    max_participation: z.number().int().positive().optional(),
    max_concurrency: z.number().int().positive().optional(),
    min_calendar_duration: z.number().positive().optional(),
    required_skills: z.array(SkillSchema).optional(),
    filter_rule: z.any().optional(),
    mutual_agreement_required: z.boolean().optional(),

    // Identity
    author: z.string().optional(),
    offerer: z.string().optional(),

    // Temporal
    time_zone: z.string().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    availability_window: AvailabilityWindowSchema.optional(),
    recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    advance_notice_hours: z.number().gte(0).optional(),
    booking_window_hours: z.number().gte(0).optional(),

    // Spatial
    search_radius_km: z.number().gte(0).optional(),
    location_type: z.string().optional(),
    longitude: z.number().min(-180).max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    street_address: z.string().optional(),
    city: z.string().optional(),
    state_province: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
    online_link: z.string().url().or(z.string().length(0)).optional(),
    h3_index: z.string().optional(),
    h3_resolution: z.number().int().min(0).max(15).optional(),

    // Allocation
    priority_distribution: z.record(z.string(), z.number().min(0).max(1)).optional(),
    
    // ===== Use-Rights (⭐) from PLAN.md =====
    
    /**
     * Rights catalog: Available rights and valid combinations.
     * 
     * From PLAN.md:
     * - Maintains catalog of possible combinations: { ⭐1, ⭐2, ⭐3 }
     * - Maintains index of ⭐ distribution over time
     */
    rights_catalog: z.object({
        /** All available rights for this resource */
        available_rights: z.array(z.any()).optional(),  // UseRightSchema from rights.ts
        
        /** Valid combinations of rights that can coexist */
        valid_combinations: z.array(z.object({
            combination_id: z.string(),
            right_ids: z.array(z.string()),
            compatible: z.boolean(),
        })).optional(),
        
        /** Default combination (if any) */
        default_combination_id: z.string().optional(),
    }).optional(),
    
    /**
     * Governance: Who controls this resource.
     * Can issue/grant/revoke rights.
     */
    governed_by: z.string().optional(),  // Governance ID
});
export type Resource = z.infer<typeof Resource>;

// =============================================================================
// MATCH DEFINITIONS
// =============================================================================
// Composable schemas for match records. Design principles:
// 1. Scores EXTEND, not contain - TimeScore IS a Score with extra fields
// 2. Discriminated unions for status - no ambiguous optional fields
// 3. Flat where possible, nested only when meaningful
// 4. Self-documenting - every score explains WHY

// -----------------------------------------------------------------------------
// Base: Score
// -----------------------------------------------------------------------------

/** Base score: normalized value with explanation. All dimension scores extend this. */
export const Score = z.object({
    value: z.number().min(0).max(1),
    reason: z.string(),
});
export type Score = z.infer<typeof Score>;

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

export const BlockReason = z.enum([
    'TIME_MISMATCH',
    'LOCATION_MISMATCH',
    'SKILL_MISMATCH',
    'QUANTITY_MISMATCH',
    'CATEGORY_CONFLICT',
    'TRAVEL_TIME_VIOLATION',
    'EXCLUSION_RULE',
    'ALREADY_COMMITTED',
]);
export type BlockReason = z.infer<typeof BlockReason>;

export const RiskFactor = z.enum([
    'FRAGMENTED_TIME',
    'TIGHT_TRAVEL',
    'PARTIAL_QUANTITY',
    'LOW_TRUST',
    'MARGINAL_SKILL',
    'NEAR_BOUNDARY',
]);
export type RiskFactor = z.infer<typeof RiskFactor>;

export const DIMENSIONS = ['time', 'space', 'quantity', 'skills', 'travel', 'affinity', 'continuity'] as const;
export type Dimension = typeof DIMENSIONS[number];

// -----------------------------------------------------------------------------
// Time
// -----------------------------------------------------------------------------

/** A single overlapping window (day + time ranges) */
export const Overlap = z.object({
    day: DayOfWeekSchema.optional(),
    date: z.string().optional(),           // YYYY-MM-DD for one-time
    ranges: z.array(TimeRangeSchema),
    minutes: z.number().int().nonnegative(),
});
export type Overlap = z.infer<typeof Overlap>;

/** Time score: Score + overlap details */
export const TimeScore = Score.extend({
    overlaps: z.array(Overlap).optional(),
    total_hours: z.number().nonnegative().optional(),
    blocks: z.number().int().positive().optional(),
    max_block_min: z.number().int().nonnegative().optional(),
});
export type TimeScore = z.infer<typeof TimeScore>;

// -----------------------------------------------------------------------------
// Space
// -----------------------------------------------------------------------------

export const SpaceScore = Score.extend({
    distance_km: z.number().nonnegative().optional(),
    radius_km: z.number().positive().optional(),
    remote: z.boolean().optional(),
});
export type SpaceScore = z.infer<typeof SpaceScore>;

// -----------------------------------------------------------------------------
// Quantity
// -----------------------------------------------------------------------------

export const QuantityScore = Score.extend({
    need: z.number().nonnegative(),
    available: z.number().nonnegative(),
    allocatable: z.number().nonnegative(),
    unit: z.string().optional(),
});
export type QuantityScore = z.infer<typeof QuantityScore>;

// -----------------------------------------------------------------------------
// Skills
// -----------------------------------------------------------------------------

export const SkillCheck = z.object({
    id: z.string(),
    required: z.union([z.number(), z.string()]).optional(),
    actual: z.union([z.number(), z.string()]).optional(),
    met: z.boolean(),
});
export type SkillCheck = z.infer<typeof SkillCheck>;

export const SkillsScore = Score.extend({
    checks: z.array(SkillCheck).optional(),
});
export type SkillsScore = z.infer<typeof SkillsScore>;

// -----------------------------------------------------------------------------
// Travel (spatio-temporal feasibility)
// -----------------------------------------------------------------------------

export const TravelScore = Score.extend({
    distance_km: z.number().nonnegative().optional(),
    time_hours: z.number().nonnegative().optional(),
    speed_kmh: z.number().nonnegative().optional(),
});
export type TravelScore = z.infer<typeof TravelScore>;

// -----------------------------------------------------------------------------
// Affinity (trust)
// -----------------------------------------------------------------------------

export const AffinityScore = Score.extend({
    seeker_to_provider: z.number().min(0).max(1).optional(),
    provider_to_seeker: z.number().min(0).max(1).optional(),
});
export type AffinityScore = z.infer<typeof AffinityScore>;

// -----------------------------------------------------------------------------
// Category (semantic taxonomy)
// -----------------------------------------------------------------------------

export const CategoryMatch = z.object({
    at: z.string().optional(),              // where chains meet
    distance: z.number().int().nonnegative(), // 0=exact, 1=sibling, 2+=ancestor
    specificity: z.number().min(0).max(1),
    disjoint: z.boolean(),                  // vegan ⊥ meat
});
export type CategoryMatch = z.infer<typeof CategoryMatch>;

// -----------------------------------------------------------------------------
// Semantic (embeddings + category)
// -----------------------------------------------------------------------------

export const SemanticScore = z.object({
    similarity: z.number().min(0).max(1),   // raw embedding cosine
    blended: z.number().min(0).max(1),      // weighted with category
    weight: z.number().min(0).max(1),       // priority weight
    need_expr: z.string(),
    capacity_expr: z.string(),
    category: CategoryMatch.optional(),
});
export type SemanticScore = z.infer<typeof SemanticScore>;

// -----------------------------------------------------------------------------
// Breakdown: all dimensions
// -----------------------------------------------------------------------------

export const Breakdown = z.object({
    time: TimeScore.optional(),
    space: SpaceScore.optional(),
    quantity: QuantityScore.optional(),
    skills: SkillsScore.optional(),
    travel: TravelScore.optional(),
    affinity: AffinityScore.optional(),
    continuity: Score.optional(),
});
export type Breakdown = z.infer<typeof Breakdown>;

// -----------------------------------------------------------------------------
// Match Record (discriminated union)
// -----------------------------------------------------------------------------

const MatchBase = z.object({
    id: z.string().min(1),
    capacity_id: z.string().min(1),
    need_id: z.string().min(1),
    score: z.number().min(0).max(1),
    semantic: SemanticScore.optional(),
    breakdown: Breakdown.optional(),
    allocatable: z.number().nonnegative().optional(),
    computed_at: z.coerce.date().optional(),
});

export const MatchRecord = z.discriminatedUnion('status', [
    MatchBase.extend({
        status: z.literal('possible'),
        risks: z.array(RiskFactor).default([]),
    }),
    MatchBase.extend({
        status: z.literal('impossible'),
        blocked_by: z.array(BlockReason).min(1),
    }),
]);
export type MatchRecord = z.infer<typeof MatchRecord>;

// -----------------------------------------------------------------------------
// Breakdown Utilities
// -----------------------------------------------------------------------------

/** Extract numeric values from breakdown */
export const scoreValues = (b: Breakdown): Record<Dimension, number | undefined> => ({
    time: b.time?.value,
    space: b.space?.value,
    quantity: b.quantity?.value,
    skills: b.skills?.value,
    travel: b.travel?.value,
    affinity: b.affinity?.value,
    continuity: b.continuity?.value,
});

/** Geometric mean of defined scores */
export const aggregateScore = (b: Breakdown): number => {
    const v = Object.values(scoreValues(b)).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a * b, 1) ** (1 / v.length) : 1;
};

/** Any dimension blocks? */
export const isBlocked = (b: Breakdown): boolean =>
    Object.values(scoreValues(b)).some(v => v === 0);

/** Extract blocking reasons */
export const getBlockReasons = (b: Breakdown): BlockReason[] => {
    const r: BlockReason[] = [];
    if (b.time?.value === 0) r.push('TIME_MISMATCH');
    if (b.space?.value === 0) r.push('LOCATION_MISMATCH');
    if (b.skills?.value === 0) r.push('SKILL_MISMATCH');
    if (b.travel?.value === 0) r.push('TRAVEL_TIME_VIOLATION');
    if (b.quantity?.value === 0) r.push('QUANTITY_MISMATCH');
    if (b.affinity?.value === 0) r.push('EXCLUSION_RULE');
    return r;
};

/** Extract risk factors */
export const getRiskFactors = (b: Breakdown): RiskFactor[] => {
    const r: RiskFactor[] = [];
    if (b.continuity?.value && b.continuity.value < 1) r.push('FRAGMENTED_TIME');
    if (b.travel?.value && b.travel.value < 1 && b.travel.value > 0) r.push('TIGHT_TRAVEL');
    if (b.quantity?.value && b.quantity.value < 1 && b.quantity.value > 0) r.push('PARTIAL_QUANTITY');
    if (b.affinity?.value && b.affinity.value < 0.5 && b.affinity.value > 0) r.push('LOW_TRUST');
    return r;
};

/** Build MatchRecord from breakdown */
export const buildMatchRecord = (
    ids: { id: string; need_id: string; capacity_id: string },
    breakdown: Breakdown,
    opts?: { semantic?: SemanticScore; allocatable?: number }
): MatchRecord => {
    const blocked_by = getBlockReasons(breakdown);
    const base = {
        ...ids,
        score: aggregateScore(breakdown),
        breakdown,
        semantic: opts?.semantic,
        allocatable: opts?.allocatable ?? breakdown.quantity?.allocatable,
        computed_at: new Date(),
    };
    return blocked_by.length
        ? { ...base, status: 'impossible' as const, blocked_by }
        : { ...base, status: 'possible' as const, risks: getRiskFactors(breakdown) };
};

// =============================================================================
// SLOT PREDICATE — Condition on derived state
// =============================================================================

/**
 * A condition on derived state that a slot requires to be satisfied.
 * Same shape as StatePredicate in effect.ts but without binding
 * (binding is at the slot level via required/optional).
 */
export const SlotPredicate = z.object({
    entity_id: z.string().min(1),
    attribute: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    exact: z.unknown().optional(),
    label: z.string().optional(),
});
export type SlotPredicate = z.infer<typeof SlotPredicate>;

// =============================================================================
// SLOT — Discriminated union of slot kinds
// =============================================================================
//
// A slot represents something a process requires to become actual.
// Four kinds, each with a different satisfaction mechanism:
//
// - **need**: "I need a sound engineer" → matched via Resource snapshots,
//   satisfied by allocation + optional state predicates.
//
// - **condition**: "It must not be raining" → pure state predicates on
//   derived state, no allocation needed.
//
// - **composition**: "Childcare co-op must be running" → references another
//   process, satisfied when that process is actual.
//
// - **data**: "What's the event name?" → collects human input (string,
//   number, boolean, option), satisfied when a value is provided.

const SlotBase = z.object({
    id: NanoId,
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().default(true),
});

/** "I need a Resource matched via snapshots" */
export const NeedSlot = SlotBase.extend({
    kind: z.literal('need'),
    /** The Resource query — what we're looking for. Matching operates on this. */
    need: Resource,
    /** Additional state conditions beyond the Resource query. */
    predicates: z.array(SlotPredicate).optional(),
});
export type NeedSlot = z.infer<typeof NeedSlot>;

/** "A condition on world state must hold" */
export const ConditionSlot = SlotBase.extend({
    kind: z.literal('condition'),
    /** Conditions on derived state that determine satisfaction. */
    predicates: z.array(SlotPredicate).min(1),
});
export type ConditionSlot = z.infer<typeof ConditionSlot>;

/** "Another process must be actual" */
export const CompositionSlot = SlotBase.extend({
    kind: z.literal('composition'),
    /** The process that must be actual for this slot to be satisfied. */
    process_id: NanoId,
});
export type CompositionSlot = z.infer<typeof CompositionSlot>;

/** "Collect human input" */
export const DataSlot = SlotBase.extend({
    kind: z.literal('data'),
    data_type: z.enum(['string', 'number', 'boolean', 'option']),
    options: z.array(z.string()).optional(),
    value: z.unknown().optional(),
});
export type DataSlot = z.infer<typeof DataSlot>;

export const Slot = z.discriminatedUnion('kind', [NeedSlot, ConditionSlot, CompositionSlot, DataSlot]);
export type Slot = z.infer<typeof Slot>;

// ---------------------------------------------------------------------------
// SlotInput — ergonomic construction types (no generated IDs yet)
// ---------------------------------------------------------------------------

type SlotInputBase = {
    name: string;
    description?: string;
    required?: boolean;
};

export type NeedSlotInput = SlotInputBase & {
    kind: 'need';
    need: Resource;
    predicates?: SlotPredicate[];
};

export type ConditionSlotInput = SlotInputBase & {
    kind: 'condition';
    predicates: SlotPredicate[];
};

export type CompositionSlotInput = SlotInputBase & {
    kind: 'composition';
    process_id: string;
};

export type DataSlotInput = SlotInputBase & {
    kind: 'data';
    data_type: 'string' | 'number' | 'boolean' | 'option';
    options?: string[];
};

export type SlotInput = NeedSlotInput | ConditionSlotInput | CompositionSlotInput | DataSlotInput;

// =============================================================================
// PROCESS
// =============================================================================

export const Process = z.object({
    id: NanoId,
    name: z.string(),
    description: ProcessDescription.optional(),
    author: z.string(),
    offerer: z.string().optional(),
    slots: z.array(Slot),
    created_at: z.date(),
    updated_at: z.date(),
});
export type Process = z.infer<typeof Process>;

/**
 * Process with derived state from the effect stream.
 * Status, satisfaction, and sustainability are all computed
 * from accepted effects — never stored directly.
 */
export type ProcessWithState = Process & ProcessDerivedState;

// =============================================================================
// MANAGER
// =============================================================================

export class ProcessManager {
    private registry = new Map<NanoId, Process>();
    private stream: EffectStream;

    constructor(stream: EffectStream) {
        this.stream = stream;
    }

    /**
     * Create a process — a coordination structure with typed slots.
     *
     * @example
     * manager.create({
     *   name: 'Block Party',
     *   author: 'alice',
     *   slots: [
     *     { kind: 'condition', name: 'Venue', predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }] },
     *     { kind: 'need', name: 'Sound', need: soundEngineerResource },
     *     { kind: 'composition', name: 'Childcare', process_id: childcareCoopId },
     *     { kind: 'data', name: 'Event Name', data_type: 'string' },
     *   ]
     * });
     */
    create(data: {
        name: string;
        description?: ProcessDescription;
        author: string;
        offerer?: string;
        slots: SlotInput[];
    }): ProcessWithState {
        const slots: Slot[] = data.slots.map(s => {
            const base = {
                id: nanoid() as NanoId,
                name: s.name,
                description: s.description,
                required: s.required ?? true,
            };
            switch (s.kind) {
                case 'need':
                    return { ...base, kind: 'need' as const, need: s.need, predicates: s.predicates };
                case 'condition':
                    return { ...base, kind: 'condition' as const, predicates: s.predicates };
                case 'composition':
                    return { ...base, kind: 'composition' as const, process_id: s.process_id as NanoId };
                case 'data':
                    return { ...base, kind: 'data' as const, data_type: s.data_type, options: s.options };
            }
        });

        const process: Process = {
            id: nanoid() as NanoId,
            name: data.name,
            description: data.description,
            author: data.author,
            offerer: data.offerer,
            slots,
            created_at: new Date(),
            updated_at: new Date(),
        };

        this.registry.set(process.id, process);
        return this.getWithState(process.id)!;
    }

    // =========================================================================
    // QUERIES
    // =========================================================================

    get(id: NanoId): Process | undefined {
        return this.registry.get(id);
    }

    /**
     * Derive the current state of a process from the effect stream.
     * Actuality, satisfaction, metabolism — all computed, never stored.
     */
    getWithState(id: NanoId): ProcessWithState | undefined {
        const process = this.registry.get(id);
        if (!process) return undefined;
        return { ...process, ...this.deriveState(process) };
    }

    all(): ProcessWithState[] {
        return Array.from(this.registry.values()).map(c => ({
            ...c,
            ...this.deriveState(c),
        }));
    }

    remove(id: NanoId): boolean {
        return this.registry.delete(id);
    }

    clear() {
        this.registry.clear();
    }

    // =========================================================================
    // DERIVED STATE — from the effect stream via derivation
    // =========================================================================

    /** Set a data slot's value. */
    setData(processId: NanoId, slotId: NanoId, value: unknown): ProcessWithState {
        const process = this.registry.get(processId);
        if (!process) throw new Error(`Process ${processId} not found`);
        const slot = process.slots.find(s => s.id === slotId);
        if (!slot || slot.kind !== 'data') throw new Error(`Data slot ${slotId} not found`);
        (slot as DataSlot).value = value;
        process.updated_at = new Date();
        return this.getWithState(processId)!;
    }

    private deriveState(process: Process): ProcessDerivedState {
        const slots = process.slots.map(s => {
            const base = { id: s.id, required: s.required };
            switch (s.kind) {
                case 'condition':
                    return { ...base, constraints: this.predicatesToConstraints(s.predicates) };
                case 'composition':
                    // Sugar: actuality of another process is a state predicate
                    return { ...base, constraints: [{
                        entity_id: s.process_id,
                        attribute: 'actuality',
                        exact: true,
                    }] };
                case 'need':
                    // For now, use optional predicates if present; full Resource→snapshot matching comes later
                    return { ...base, constraints: s.predicates ? this.predicatesToConstraints(s.predicates) : [] };
                case 'data':
                    // Satisfied when value is provided — synthesize an always-true or always-false constraint
                    // We handle this by returning an empty constraint list (trivially satisfied) if value exists,
                    // or a constraint that will fail if value is missing
                    if (s.value !== undefined) {
                        return { ...base, constraints: [] }; // trivially satisfied
                    }
                    // Unsatisfied: use a dummy constraint that can never be met
                    return { ...base, constraints: [{
                        entity_id: `__data_slot__${s.id}`,
                        attribute: 'value',
                        exact: true, // will fail because no effect sets this
                    }] };
            }
        });

        return deriveProcess(this.stream, process.id, slots);
    }

    private predicatesToConstraints(predicates: SlotPredicate[]) {
        return predicates.map(p => ({
            entity_id: p.entity_id,
            attribute: p.attribute,
            min: p.min,
            max: p.max,
            exact: p.exact,
        }));
    }
}