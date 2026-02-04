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

// Re-export time types for convenience
export { TimeRangeSchema, DayOfWeekSchema, DayScheduleSchema, AvailabilityWindowSchema };
export type { TimeRange, DayOfWeek, DaySchedule, AvailabilityWindow };

// =============================================================================
// IDs
// =============================================================================

export const NanoId = z.string().min(10).max(32);
export type NanoId = z.infer<typeof NanoId>;

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

export const CommonsDescription = z.union([
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
export type CommonsDescription = z.infer<typeof CommonsDescription>;

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
// INPUT DEFINITIONS
// =============================================================================

const InputGeneric = z.object({
    kind: z.literal('generic'),
    data_type: z.enum(['string', 'number', 'boolean', 'option']),
    options: z.array(z.string()).optional(),
    description: z.string().optional(),
});

const InputResource = z.object({
    kind: z.literal('resource'),
    resource_id: z.string(),
});

const InputCommons = z.object({
    kind: z.literal('commons'),
    commons_id: z.string().optional(),
});

export const InputDefinition = z.union([InputGeneric, InputResource, InputCommons]);
export type InputDefinition = z.infer<typeof InputDefinition>;
export type InputResource = z.infer<typeof InputResource>;
export type InputCommons = z.infer<typeof InputCommons>;
export type InputGeneric = z.infer<typeof InputGeneric>;

// Input helpers
export const input = {
    resource: (resource_id: string) => ({
        kind: 'resource' as const,
        resource_id,
    } satisfies InputResource),

    commons: (commons_id?: string) => ({
        kind: 'commons' as const,
        commons_id,
    } satisfies InputCommons),

    generic: (data_type: 'string' | 'number' | 'boolean' | 'option', opts?: { options?: string[], description?: string }) => ({
        kind: 'generic' as const,
        data_type,
        ...opts,
    } satisfies InputGeneric),
};

// =============================================================================
// SLOT
// =============================================================================

export const Slot = z.object({
    id: NanoId,
    name: z.string(),
    description: z.string().optional(),
    input: InputDefinition,
    optional: z.boolean().default(false),
    acceptance_logic: AcceptanceLogic.optional(),
    filled_by: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
});
export type Slot = z.infer<typeof Slot>;

export type SlotInput = {
    name: string;
    description?: string;
    input: InputDefinition;
    optional?: boolean;
    acceptance_logic?: AcceptanceLogic;
};

// =============================================================================
// COMMONS
// =============================================================================

export const Commons = z.object({
    id: NanoId,
    name: z.string(),
    description: CommonsDescription.optional(),
    author: z.string(),
    offerer: z.string().optional(),
    slots: z.array(Slot),
    created_at: z.date(),
    updated_at: z.date(),
});
export type Commons = z.infer<typeof Commons>;

export const Progress = z.object({
    requiredSlotsFilled: z.number(),
    totalRequiredSlots: z.number(),
    optionalSlotsFilled: z.number(),
    totalOptionalSlots: z.number(),
    completionPercentage: z.number().min(0).max(100),
});
export type Progress = z.infer<typeof Progress>;

export type CommonsWithState = Commons & {
    status: 'potential' | 'actual';
    progress: Progress;
};

// =============================================================================
// MANAGER
// =============================================================================

export class CommonsManager {
    private registry = new Map<NanoId, Commons>();
    private resources = new Map<NanoId, Resource>(); // New: resource definitions
    private referencedBy = new Map<NanoId, Set<NanoId>>();

    /**
     * Create a commons.
     *
     * @example
     * manager.create({
     *   name: 'Block Party',
     *   author: 'alice',
     *   slots: [{
     *     name: 'Childcare',
     *     input: input.resource(resourceId, 10)
     *   }]
     * });
     */
    create(data: {
        name: string;
        description?: CommonsDescription;
        author: string;
        offerer?: string;
        slots: SlotInput[];
    }): CommonsWithState {
        const slots: Slot[] = data.slots.map(s => ({
            id: nanoid() as NanoId,
            name: s.name,
            description: s.description,
            input: s.input,
            optional: s.optional ?? false,
            acceptance_logic: s.acceptance_logic,
            filled_by: undefined,
        }));

        // Validate that referenced resources exist
        for (const slot of slots) {
            if (slot.input.kind === 'resource') {
                if (!this.resources.has(slot.input.resource_id as NanoId)) {
                    // Warn or throw? For now throw to be safe.
                    // throw new Error(`Resource ${slot.input.resource_id} not found`);
                }
            }
        }

        const commons: Commons = {
            id: nanoid() as NanoId,
            name: data.name,
            description: data.description,
            author: data.author,
            offerer: data.offerer,
            slots,
            created_at: new Date(),
            updated_at: new Date(),
        };

        this.registry.set(commons.id, commons);
        this.rebuildIndex();
        return this.getWithState(commons.id)!;
    }

    /** Fill a slot. Cycles allowed (reciprocity). */
    fill(
        commonsId: NanoId,
        slotId: NanoId,
        filledBy: Record<string, boolean | number | string>,
        author: string,
    ): CommonsWithState {
        const commons = this.registry.get(commonsId);
        if (!commons) throw new Error(`Commons ${commonsId} not found`);

        const slot = commons.slots.find(s => s.id === slotId);
        if (!slot) throw new Error(`Slot ${slotId} not found`);

        // Causal constraint: referenced commons must exist
        for (const ref of Object.keys(filledBy)) {
            if (NanoId.safeParse(ref).success && !this.registry.has(ref)) {
                throw new Error(`Referenced commons ${ref} does not exist`);
            }
        }

        slot.filled_by = { ...slot.filled_by, ...filledBy };
        commons.updated_at = new Date();

        this.rebuildIndex();
        return this.getWithState(commonsId)!;
    }

    /**
     * Fill by slot name (when unique).
     *
     * @example
     * manager.fillByName(commons.id, 'Childcare', { 'bob-id': true }, 'alice');
     */
    fillByName(
        commonsId: NanoId,
        slotName: string,
        filledBy: Record<string, boolean | number | string>,
        author: string,
    ): CommonsWithState {
        const commons = this.registry.get(commonsId);
        if (!commons) throw new Error(`Commons ${commonsId} not found`);

        const matches = commons.slots.filter(s => s.name === slotName);
        if (matches.length === 0) throw new Error(`No slot named "${slotName}"`);
        if (matches.length > 1) throw new Error(`Multiple slots named "${slotName}"`);

        return this.fill(commonsId, matches[0]!.id, filledBy, author);
    }

    /** Unfill a slot. */
    unfill(commonsId: NanoId, slotId: NanoId): CommonsWithState {
        const commons = this.registry.get(commonsId);
        if (!commons) throw new Error(`Commons ${commonsId} not found`);

        const slot = commons.slots.find(s => s.id === slotId);
        if (!slot) throw new Error(`Slot ${slotId} not found`);

        slot.filled_by = undefined;
        commons.updated_at = new Date();

        this.rebuildIndex();
        return this.getWithState(commonsId)!;
    }

    /** Unfill by name. */
    unfillByName(commonsId: NanoId, slotName: string): CommonsWithState {
        const commons = this.registry.get(commonsId);
        if (!commons) throw new Error(`Commons ${commonsId} not found`);

        const matches = commons.slots.filter(s => s.name === slotName);
        if (matches.length === 0) throw new Error(`No slot named "${slotName}"`);
        if (matches.length > 1) throw new Error(`Multiple slots named "${slotName}"`);

        return this.unfill(commonsId, matches[0].id);
    }

    // --- Queries ---

    get(id: NanoId): Commons | undefined {
        return this.registry.get(id);
    }

    getWithState(id: NanoId): CommonsWithState | undefined {
        const commons = this.registry.get(id);
        if (!commons) return undefined;
        return { ...commons, ...this.computeState(commons) };
    }

    all(): CommonsWithState[] {
        return Array.from(this.registry.values()).map(c => ({
            ...c,
            ...this.computeState(c),
        }));
    }

    dependentsOf(id: NanoId): NanoId[] {
        return Array.from(this.referencedBy.get(id) ?? []);
    }

    dependenciesOf(id: NanoId): NanoId[] {
        const commons = this.registry.get(id);
        if (!commons) return [];
        return Array.from(this.extractRefs(commons));
    }

    remove(id: NanoId): boolean {
        this.registry.delete(id);
        this.rebuildIndex();
        return true;
    }

    clear() {
        this.registry.clear();
        this.referencedBy.clear();
    }

    // --- Derived state: LOCAL status (not transitive) ---

    private computeState(commons: Commons): { status: 'potential' | 'actual'; progress: Progress } {
        let requiredFilled = 0, totalRequired = 0;
        let optionalFilled = 0, totalOptional = 0;

        for (const slot of commons.slots) {
            const filled = slot.filled_by && Object.keys(slot.filled_by).length > 0;

            if (slot.optional) {
                totalOptional++;
                if (filled) optionalFilled++;
            } else {
                totalRequired++;
                if (filled) requiredFilled++;
            }
        }

        return {
            status: requiredFilled === totalRequired ? 'actual' : 'potential',
            progress: {
                requiredSlotsFilled: requiredFilled,
                totalRequiredSlots: totalRequired,
                optionalSlotsFilled: optionalFilled,
                totalOptionalSlots: totalOptional,
                completionPercentage: totalRequired > 0
                    ? Math.round((requiredFilled / totalRequired) * 100)
                    : 100,
            },
        };
    }

    // --- Reference index ---

    private rebuildIndex() {
        this.referencedBy.clear();
        for (const [id, commons] of this.registry.entries()) {
            for (const ref of this.extractRefs(commons)) {
                if (!this.referencedBy.has(ref)) this.referencedBy.set(ref, new Set());
                this.referencedBy.get(ref)!.add(id);
            }
        }
    }

    private extractRefs(commons: Commons): Set<NanoId> {
        const refs = new Set<NanoId>();
        for (const slot of commons.slots) {
            if (slot.filled_by) {
                for (const ref of Object.keys(slot.filled_by)) {
                    if (NanoId.safeParse(ref).success) refs.add(ref as NanoId);
                }
            }
            if (slot.input.kind === 'commons' && slot.input.commons_id) {
                if (NanoId.safeParse(slot.input.commons_id).success) {
                    refs.add(slot.input.commons_id as NanoId);
                }
            }
        }
        return refs;
    }
}

export const commons = new CommonsManager();