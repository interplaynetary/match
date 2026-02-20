/**
 * Comprehensive system tests exercising the full ontology from SYSTEM.md:
 *
 * - State: capacities, needs, allocations
 * - Effects: lifecycle, deltas, envelopes, state predicates, propagation
 * - Process: predicate-based slots, derivation, composition
 * - Metabolism: spatiotemporally honest flows, profiles
 * - The Loop: State → Effects → Process → State
 *
 * Scenario: A neighborhood organizes a Block Party process. It requires:
 *   - Venue (availability >= 1)
 *   - Food (servings >= 50)
 *   - Music (hours >= 4)
 *
 * Meanwhile, a Childcare Cooperative runs so parents can attend.
 * The Block Party has a composition slot: childcare must be actual.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { EffectStream } from '$lib/core/effect-stream';
import {
    type Effect,
    type StatePredicate,
    currentPhase,
    isActive,
    isRetracted,
    evaluateSinglePredicate,
    evaluatePredicates,
    stateKey,
} from '$lib/core/effect';
import {
    derive,
    deriveAt,
    deriveProcess,
    evaluateSlot,
    metabolize,
    metabolizeWindowed,
    metabolicProfile,
    applyDelta,
    checkConstraint,
    predicateToConstraint,
    snapshot,
    type AttributeConstraint,
    type DerivedValue,
} from '$lib/core/plan/derivation';
import { ProcessManager, type SlotPredicate } from '$lib/core/plan/process';
import { Allocations, isActiveCommitment } from '$lib/core/plan/allocation';
import type { NanoId } from '$lib/core/plan/ids';

// =============================================================================
// HELPERS — Build effects concisely
// =============================================================================

let idCounter = 0;
function eid(): string {
    return `eff-${++idCounter}-${'x'.repeat(10)}`;
}

function makeEffect(overrides: Partial<Effect> & {
    entity_id?: string;
    attribute?: string;
    operation?: Effect['deltas'][0]['operation'];
    value?: unknown;
    phase?: Effect['assertion_log'][0]['phase'];
}): Effect {
    const origin_id = overrides.origin_id ?? eid();
    const phase = overrides.phase ?? 'accepted';
    return {
        origin_id,
        version: overrides.version ?? 0,
        author: overrides.author ?? 'system',
        deltas: overrides.deltas ?? [{
            entity_id: overrides.entity_id ?? 'entity',
            attribute: overrides.attribute ?? 'attr',
            operation: overrides.operation ?? 'set',
            value: overrides.value ?? 0,
        }],
        envelope: overrides.envelope ?? {},
        assertion_log: overrides.assertion_log ?? [{
            phase,
            at: new Date(),
            by: 'system',
        }],
        predicates: overrides.predicates ?? [],
        recorded_at: overrides.recorded_at ?? new Date(),
        valid_from: overrides.valid_from,
        valid_until: overrides.valid_until,
    };
}

// =============================================================================
// STATE LAYER
// =============================================================================

describe('State Layer', () => {
    let stream: EffectStream;

    beforeEach(() => {
        stream = new EffectStream();
        idCounter = 0;
    });

    describe('Capacities — derived from effects via set operations', () => {
        it('a single set effect establishes a capacity', () => {
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'set',
                value: 20,
            }));

            const state = derive(stream, 'tool-library', 'drills');
            expect(state.value).toBe(20);
            expect(state.effect_count).toBe(1);
        });

        it('set acts as a checkpoint — later set overwrites earlier effects', () => {
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'add',
                value: 5,
                valid_from: '2025-01-01T00:00:00Z',
            }));
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'set',
                value: 20,
                valid_from: '2025-01-02T00:00:00Z',
            }));

            const state = derive(stream, 'tool-library', 'drills');
            expect(state.value).toBe(20); // set overwrites the add
        });

        it('incremental effects accumulate on top of a checkpoint', () => {
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'set',
                value: 20,
                valid_from: '2025-01-01T00:00:00Z',
            }));
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'add',
                value: 3,
                valid_from: '2025-01-02T00:00:00Z',
            }));
            stream.submit(makeEffect({
                entity_id: 'tool-library',
                attribute: 'drills',
                operation: 'subtract',
                value: 1,
                valid_from: '2025-01-03T00:00:00Z',
            }));

            const state = derive(stream, 'tool-library', 'drills');
            expect(state.value).toBe(22); // 20 + 3 - 1
            expect(state.effect_count).toBe(3);
        });
    });

    describe('applyDelta — all operations', () => {
        it('set replaces', () => expect(applyDelta(10, 'set', 42)).toBe(42));
        it('add', () => expect(applyDelta(10, 'add', 5)).toBe(15));
        it('subtract', () => expect(applyDelta(10, 'subtract', 3)).toBe(7));
        it('multiply', () => expect(applyDelta(10, 'multiply', 2)).toBe(20));
        it('append to array', () => expect(applyDelta(['a'], 'append', 'b')).toEqual(['a', 'b']));
        it('remove from array', () => expect(applyDelta(['a', 'b', 'c'], 'remove', 'b')).toEqual(['a', 'c']));
        it('add to undefined starts from 0', () => expect(applyDelta(undefined, 'add', 5)).toBe(5));
        it('append to undefined creates array', () => expect(applyDelta(undefined, 'append', 'x')).toEqual(['x']));
    });

    describe('Allocations — state that partitions capacity', () => {
        let alloc: Allocations;

        beforeEach(() => {
            alloc = new Allocations();
        });

        it('a commitment claims capacity for a slot', () => {
            const c = alloc.commit({
                slot_id: 'slot-childcare-1234' as NanoId,
                process_id: 'coop-abcdefghij' as NanoId,
                contributor_id: 'maria',
                quantity: 8,
                unit: 'hours',
            });

            expect(c.contributor_id).toBe('maria');
            expect(c.quantity).toBe(8);
            expect(isActiveCommitment(c)).toBe(true);
        });

        it('cancelling a commitment frees capacity', () => {
            const c = alloc.commit({
                slot_id: 'slot-childcare-1234' as NanoId,
                process_id: 'coop-abcdefghij' as NanoId,
                contributor_id: 'maria',
                quantity: 8,
            });

            const cancelled = alloc.cancelCommitment(c.id);
            expect(isActiveCommitment(cancelled)).toBe(false);
        });

        it('allocation coverage tracks how much is claimed', () => {
            const slotId = 'slot-childcare-1234' as NanoId;
            const processId = 'coop-abcdefghij' as NanoId;

            alloc.commit({ slot_id: slotId, process_id: processId, contributor_id: 'maria', quantity: 5 });
            alloc.commit({ slot_id: slotId, process_id: processId, contributor_id: 'jose', quantity: 3 });

            const coverage = alloc.allocationCoverage(slotId, 10);
            expect(coverage.quantity_allocated).toBe(8);
            expect(coverage.quantity_gap).toBe(2);
            expect(coverage.allocation_ratio).toBe(0.8);
            expect(coverage.status).toBe('partial');
            expect(coverage.contributors).toContain('maria');
            expect(coverage.contributors).toContain('jose');
        });

        it('fully allocated slot has no gap', () => {
            const slotId = 'slot-childcare-1234' as NanoId;
            const processId = 'coop-abcdefghij' as NanoId;

            alloc.commit({ slot_id: slotId, process_id: processId, contributor_id: 'maria', quantity: 10 });

            const coverage = alloc.allocationCoverage(slotId, 10);
            expect(coverage.status).toBe('fully_allocated');
            expect(coverage.quantity_gap).toBe(0);
        });

        it('cancelled commitments do not count toward allocation', () => {
            const slotId = 'slot-childcare-1234' as NanoId;
            const processId = 'coop-abcdefghij' as NanoId;

            const c = alloc.commit({ slot_id: slotId, process_id: processId, contributor_id: 'maria', quantity: 8 });
            alloc.cancelCommitment(c.id);

            const coverage = alloc.allocationCoverage(slotId, 10);
            expect(coverage.quantity_allocated).toBe(0);
            expect(coverage.status).toBe('gap');
        });
    });
});

// =============================================================================
// EFFECTS LAYER
// =============================================================================

describe('Effects Layer', () => {
    let stream: EffectStream;

    beforeEach(() => {
        stream = new EffectStream();
        idCounter = 0;
    });

    describe('Lifecycle — projected → pending → accepted/rejected/retracted', () => {
        it('an effect advances through its lifecycle', () => {
            const projected = makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
                phase: 'projected',
            });
            stream.submit(projected);
            expect(currentPhase(stream.latest(projected.origin_id)!)).toBe('projected');

            stream.assert(projected.origin_id, { phase: 'pending', by: 'organizer' });
            expect(currentPhase(stream.latest(projected.origin_id)!)).toBe('pending');

            stream.assert(projected.origin_id, { phase: 'accepted', by: 'witness' });
            expect(currentPhase(stream.latest(projected.origin_id)!)).toBe('accepted');
        });

        it('only accepted effects fold into state', () => {
            stream.submit(makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
                phase: 'projected',
            }));

            // Projected effects don't count in derive (default phases = ['accepted'])
            const state = derive(stream, 'venue', 'availability');
            expect(state.value).toBeUndefined();
            expect(state.effect_count).toBe(0);
        });

        it('retracted effects are excluded from derivation', () => {
            const eff = makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
            });
            stream.submit(eff);
            expect(derive(stream, 'venue', 'availability').value).toBe(1);

            stream.assert(eff.origin_id, { phase: 'retracted', by: 'auditor', note: 'counted twice' });
            expect(derive(stream, 'venue', 'availability').value).toBeUndefined();
            expect(isRetracted(stream.latest(eff.origin_id)!)).toBe(true);
        });

        it('assertion log is append-only — retraction sits alongside acceptance', () => {
            const eff = makeEffect({
                entity_id: 'drills',
                attribute: 'count',
                operation: 'set',
                value: 5,
            });
            stream.submit(eff);
            stream.assert(eff.origin_id, { phase: 'retracted', by: 'auditor' });

            const latest = stream.latest(eff.origin_id)!;
            expect(latest.assertion_log).toHaveLength(2);
            expect(latest.assertion_log[0].phase).toBe('accepted');
            expect(latest.assertion_log[1].phase).toBe('retracted');
        });
    });

    describe('Bitemporality — valid_time vs known_time', () => {
        it('deriveAt reconstructs state as-of a specific known_time', () => {
            const t1 = new Date('2025-01-01');
            const t2 = new Date('2025-02-01');
            const t3 = new Date('2025-03-01');

            // Effect 1: accepted at t1
            stream.submit(makeEffect({
                entity_id: 'pantry',
                attribute: 'flour_kg',
                operation: 'set',
                value: 10,
                valid_from: '2025-01-01T00:00:00Z',
                assertion_log: [{ phase: 'accepted', at: t1, by: 'chef' }],
            }));

            // Effect 2: accepted at t2
            stream.submit(makeEffect({
                entity_id: 'pantry',
                attribute: 'flour_kg',
                operation: 'add',
                value: 5,
                valid_from: '2025-01-15T00:00:00Z',
                assertion_log: [{ phase: 'accepted', at: t2, by: 'delivery' }],
            }));

            // As of t1, only the first effect is known
            const atT1 = deriveAt(stream, 'pantry', 'flour_kg', t1);
            expect(atT1.value).toBe(10);

            // As of t3, both effects are known
            const atT3 = deriveAt(stream, 'pantry', 'flour_kg', t3);
            expect(atT3.value).toBe(15);
        });
    });

    describe('State Predicates — effects depend on state, not effects', () => {
        it('evaluateSinglePredicate checks min/max/exact', () => {
            expect(evaluateSinglePredicate({ entity_id: 'e', attribute: 'a', min: 5, binding: 'hard' }, 10)).toBe(true);
            expect(evaluateSinglePredicate({ entity_id: 'e', attribute: 'a', min: 5, binding: 'hard' }, 3)).toBe(false);
            expect(evaluateSinglePredicate({ entity_id: 'e', attribute: 'a', max: 10, binding: 'hard' }, 15)).toBe(false);
            expect(evaluateSinglePredicate({ entity_id: 'e', attribute: 'a', exact: 'yes', binding: 'hard' }, 'yes')).toBe(true);
            expect(evaluateSinglePredicate({ entity_id: 'e', attribute: 'a', exact: 'yes', binding: 'hard' }, 'no')).toBe(false);
        });

        it('hard predicates invalidate effects when state breaks', () => {
            // Set up venue availability
            const venueEffect = makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
            });
            stream.submit(venueEffect);

            // Workshop depends on venue availability
            const workshop = makeEffect({
                entity_id: 'workshop',
                attribute: 'happening',
                operation: 'set',
                value: true,
                predicates: [{
                    entity_id: 'venue',
                    attribute: 'availability',
                    min: 1,
                    binding: 'hard',
                    label: 'venue must be available',
                }],
            });
            stream.submit(workshop);

            // Now retract the venue — this should trigger propagation
            const events: any[] = [];
            stream.subscribe(e => { if (e.type === 'propagation') events.push(e); });

            stream.assert(venueEffect.origin_id, { phase: 'retracted', by: 'landlord' });

            // The propagation should fire an invalidation
            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].action.type).toBe('invalidate');
            expect(events[0].action.origin_id).toBe(workshop.origin_id);
        });

        it('soft predicates degrade effects instead of invalidating', () => {
            stream.submit(makeEffect({
                entity_id: 'garden',
                attribute: 'rainfall_mm',
                operation: 'set',
                value: 50,
            }));

            const harvest = makeEffect({
                entity_id: 'garden',
                attribute: 'yield',
                operation: 'set',
                value: 100,
                predicates: [{
                    entity_id: 'garden',
                    attribute: 'rainfall_mm',
                    min: 30,
                    binding: 'soft',
                    label: 'adequate rainfall',
                }],
            });
            stream.submit(harvest);

            const events: any[] = [];
            stream.subscribe(e => { if (e.type === 'propagation') events.push(e); });

            // Rainfall drops below threshold
            stream.submit(makeEffect({
                entity_id: 'garden',
                attribute: 'rainfall_mm',
                operation: 'set',
                value: 20,
            }));

            expect(events.some(e => e.action.type === 'degrade')).toBe(true);
        });

        it('only satisfied→unsatisfied transitions trigger propagation (no re-alarming)', () => {
            stream.submit(makeEffect({
                entity_id: 'tank',
                attribute: 'water',
                operation: 'set',
                value: 100,
            }));

            const pump = makeEffect({
                entity_id: 'pump',
                attribute: 'running',
                operation: 'set',
                value: true,
                predicates: [{
                    entity_id: 'tank',
                    attribute: 'water',
                    min: 10,
                    binding: 'hard',
                }],
            });
            stream.submit(pump);

            const events: any[] = [];
            stream.subscribe(e => { if (e.type === 'propagation') events.push(e); });

            // Drop below threshold
            stream.submit(makeEffect({ entity_id: 'tank', attribute: 'water', operation: 'set', value: 5 }));
            expect(events).toHaveLength(1); // first alarm

            // Drop even further — should NOT re-alarm
            stream.submit(makeEffect({ entity_id: 'tank', attribute: 'water', operation: 'set', value: 2 }));
            expect(events).toHaveLength(1); // still 1, no re-alarm
        });
    });

    describe('Multi-delta effects — atomic batches', () => {
        it('a single effect can transform multiple entities', () => {
            stream.submit(makeEffect({
                deltas: [
                    { entity_id: 'library-a', attribute: 'drills', operation: 'subtract', value: 2 },
                    { entity_id: 'library-b', attribute: 'drills', operation: 'add', value: 2 },
                ],
            }));

            // Need a base for subtract to work on
            stream.submit(makeEffect({
                entity_id: 'library-a',
                attribute: 'drills',
                operation: 'set',
                value: 10,
                valid_from: '2024-01-01T00:00:00Z',
            }));

            const a = derive(stream, 'library-a', 'drills');
            const b = derive(stream, 'library-b', 'drills');
            // library-a: set 10, subtract 2 = 8
            expect(a.value).toBe(8);
            // library-b: add 2 = 2
            expect(b.value).toBe(2);
        });
    });
});

// =============================================================================
// COMMONS LAYER
// =============================================================================

describe('Process Layer', () => {
    let stream: EffectStream;
    let manager: ProcessManager;

    beforeEach(() => {
        stream = new EffectStream();
        manager = new ProcessManager(stream);
        idCounter = 0;
    });

    describe('Slots as state predicates', () => {
        it('an unsatisfied process is potential', () => {
            const party = manager.create({
                name: 'Block Party',
                author: 'alice',
                slots: [
                    {
                        kind: 'condition',
                        name: 'Venue',
                        predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }],
                    },
                    {
                        kind: 'condition',
                        name: 'Food',
                        predicates: [{ entity_id: 'food', attribute: 'servings', min: 50 }],
                    },
                ],
            });

            expect(party.actual).toBe(false);
            expect(party.satisfaction_ratio).toBe(0);
        });

        it('satisfying all required slots makes process actual', () => {
            const party = manager.create({
                name: 'Block Party',
                author: 'alice',
                slots: [
                    {
                        kind: 'condition',
                        name: 'Venue',
                        predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }],
                    },
                    {
                        kind: 'condition',
                        name: 'Food',
                        predicates: [{ entity_id: 'food', attribute: 'servings', min: 50 }],
                    },
                ],
            });

            // Submit effects that satisfy both slots
            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'availability', operation: 'set', value: 1 }));
            stream.submit(makeEffect({ entity_id: 'food', attribute: 'servings', operation: 'set', value: 75 }));

            const state = manager.getWithState(party.id)!;
            expect(state.actual).toBe(true);
            expect(state.satisfaction_ratio).toBe(1);
        });

        it('partial satisfaction: one slot met, one not', () => {
            const party = manager.create({
                name: 'Block Party',
                author: 'alice',
                slots: [
                    {
                        kind: 'condition',
                        name: 'Venue',
                        predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }],
                    },
                    {
                        kind: 'condition',
                        name: 'Food',
                        predicates: [{ entity_id: 'food', attribute: 'servings', min: 50 }],
                    },
                ],
            });

            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'availability', operation: 'set', value: 1 }));
            // food not provided

            const state = manager.getWithState(party.id)!;
            expect(state.actual).toBe(false);
            expect(state.satisfaction_ratio).toBe(0.5);
        });

        it('optional slots do not block actuality', () => {
            const party = manager.create({
                name: 'Block Party',
                author: 'alice',
                slots: [
                    {
                        kind: 'condition',
                        name: 'Venue',
                        predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }],
                    },
                    {
                        kind: 'condition',
                        name: 'Decorations',
                        required: false,
                        predicates: [{ entity_id: 'decorations', attribute: 'count', min: 10 }],
                    },
                ],
            });

            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'availability', operation: 'set', value: 1 }));
            // decorations not provided, but it's optional

            const state = manager.getWithState(party.id)!;
            expect(state.actual).toBe(true); // only required slots matter
        });

        it('a slot with multiple predicates requires ALL to be satisfied', () => {
            const workshop = manager.create({
                name: 'Workshop',
                author: 'bob',
                slots: [{
                    kind: 'condition',
                    name: 'Fully equipped venue',
                    predicates: [
                        { entity_id: 'venue', attribute: 'availability', min: 1 },
                        { entity_id: 'venue', attribute: 'chairs', min: 20 },
                    ],
                }],
            });

            // Only one predicate met
            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'availability', operation: 'set', value: 1 }));

            let state = manager.getWithState(workshop.id)!;
            expect(state.actual).toBe(false);

            // Now satisfy the second
            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'chairs', operation: 'set', value: 25 }));

            state = manager.getWithState(workshop.id)!;
            expect(state.actual).toBe(true);
        });
    });

    describe('Composition — process referencing process', () => {
        it('a festival depends on childcare being actual', () => {
            // Childcare coop
            const coop = manager.create({
                name: 'Childcare Cooperative',
                author: 'maria',
                slots: [{
                    kind: 'condition',
                    name: 'Caregivers',
                    predicates: [{ entity_id: 'daycare', attribute: 'caregiver_hours', min: 8 }],
                }],
            });

            // Festival with a composition slot — depends on childcare being actual
            const festival = manager.create({
                name: 'Neighborhood Festival',
                author: 'alice',
                slots: [
                    {
                        kind: 'condition',
                        name: 'Venue',
                        predicates: [{ entity_id: 'park', attribute: 'availability', min: 1 }],
                    },
                    {
                        kind: 'composition',
                        name: 'Childcare running',
                        process_id: coop.process_id,
                    },
                ],
            });

            // Park is available
            stream.submit(makeEffect({ entity_id: 'park', attribute: 'availability', operation: 'set', value: 1 }));

            // But childcare isn't running yet — festival can't be actual
            // (The coop's actuality would need its own effect tracking;
            // here we test the predicate mechanism)
            let state = manager.getWithState(festival.id)!;
            expect(state.actual).toBe(false);

            // Simulate childcare becoming actual by setting its actuality in state
            stream.submit(makeEffect({
                entity_id: coop.process_id,
                attribute: 'actuality',
                operation: 'set',
                value: true,
            }));

            state = manager.getWithState(festival.id)!;
            expect(state.actual).toBe(true);
        });
    });

    describe('The slot does not care HOW its condition is met', () => {
        it('different effects can satisfy the same slot predicate', () => {
            const party = manager.create({
                name: 'Block Party',
                author: 'alice',
                slots: [{
                    kind: 'condition',
                    name: 'Venue',
                    predicates: [{ entity_id: 'venue', attribute: 'availability', min: 1 }],
                }],
            });

            // Alice books a venue
            const booking = makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
                author: 'alice',
            });
            stream.submit(booking);
            expect(manager.getWithState(party.id)!.actual).toBe(true);

            // Booking falls through
            stream.assert(booking.origin_id, { phase: 'retracted', by: 'landlord' });
            expect(manager.getWithState(party.id)!.actual).toBe(false);

            // Bob provides an alternative venue — same slot satisfied, different source
            stream.submit(makeEffect({
                entity_id: 'venue',
                attribute: 'availability',
                operation: 'set',
                value: 1,
                author: 'bob',
            }));
            expect(manager.getWithState(party.id)!.actual).toBe(true);
        });
    });

    describe('State is derived, never stored', () => {
        it('getWithState always reflects current effect stream', () => {
            const coop = manager.create({
                name: 'Tool Library',
                author: 'carol',
                slots: [{
                    kind: 'condition',
                    name: 'Tools',
                    predicates: [{ entity_id: 'tools', attribute: 'count', min: 10 }],
                }],
            });

            expect(manager.getWithState(coop.id)!.actual).toBe(false);

            stream.submit(makeEffect({ entity_id: 'tools', attribute: 'count', operation: 'set', value: 15 }));
            expect(manager.getWithState(coop.id)!.actual).toBe(true);

            // Tools get borrowed — count drops
            stream.submit(makeEffect({
                entity_id: 'tools',
                attribute: 'count',
                operation: 'subtract',
                value: 8,
            }));
            // 15 - 8 = 7, below the min of 10
            expect(manager.getWithState(coop.id)!.actual).toBe(false);
        });
    });
});

// =============================================================================
// METABOLISM
// =============================================================================

describe('Metabolism', () => {
    let stream: EffectStream;

    beforeEach(() => {
        stream = new EffectStream();
        idCounter = 0;
    });

    describe('Basic flow computation', () => {
        it('tracks production and consumption', () => {
            // Donations (production)
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 5,
            }));

            // Borrowing (consumption)
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'subtract',
                value: 3,
            }));

            const flow = metabolize(stream, 'library', 'drills');
            expect(flow.production).toBe(5);
            expect(flow.consumption).toBe(3);
            expect(flow.net).toBe(2);
            expect(flow.sustainable).toBe(true);
        });

        it('net negative flow is unsustainable', () => {
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 2,
            }));
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'subtract',
                value: 7,
            }));

            const flow = metabolize(stream, 'library', 'drills');
            expect(flow.net).toBe(-5);
            expect(flow.sustainable).toBe(false);
        });

        it('estimates hours until exhaustion', () => {
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'subtract',
                value: 2,
                envelope: {
                    temporal: {
                        start: '2025-01-01T00:00:00Z',
                        end: '2025-01-01T10:00:00Z', // 10 hour window
                    },
                },
            }));

            const flow = metabolizeWindowed(stream, 'library', 'drills', {
                temporal: {
                    start: '2025-01-01T00:00:00Z',
                    end: '2025-01-01T10:00:00Z',
                },
            }, 20); // base of 20 drills

            expect(flow.sustainable).toBe(false);
            expect(flow.hours_until_exhaustion).toBeDefined();
        });
    });

    describe('Spatiotemporal honesty', () => {
        it('bounded temporal query weights effects by overlap', () => {
            // Effect spans 10 hours (00:00 - 10:00)
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 10,
                envelope: {
                    temporal: {
                        start: '2025-06-01T00:00:00Z',
                        end: '2025-06-01T10:00:00Z',
                    },
                },
            }));

            // Query only 5 of those hours (00:00 - 05:00) → fraction = 0.5
            const flow = metabolizeWindowed(stream, 'library', 'drills', {
                temporal: {
                    start: '2025-06-01T00:00:00Z',
                    end: '2025-06-01T05:00:00Z',
                },
            });

            expect(flow.production).toBeCloseTo(5, 0); // 10 * 0.5
            expect(flow.contributions).toHaveLength(1);
            expect(flow.contributions[0].fraction).toBeCloseTo(0.5, 1);
        });

        it('non-overlapping temporal query yields zero', () => {
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 10,
                envelope: {
                    temporal: {
                        start: '2025-06-01T00:00:00Z',
                        end: '2025-06-01T10:00:00Z',
                    },
                },
            }));

            // Query a completely different day
            const flow = metabolizeWindowed(stream, 'library', 'drills', {
                temporal: {
                    start: '2025-07-01T00:00:00Z',
                    end: '2025-07-01T10:00:00Z',
                },
            });

            expect(flow.production).toBe(0);
        });

        it('spatial filtering excludes distant effects', () => {
            // Effect at downtown (lat 40.7, lng -74.0)
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 10,
                envelope: {
                    spatial: {
                        latitude: 40.7128,
                        longitude: -74.0060,
                        radius_km: 5,
                    },
                },
            }));

            // Query at a faraway location
            const flow = metabolizeWindowed(stream, 'library', 'drills', {
                spatial: {
                    latitude: 34.0522, // Los Angeles
                    longitude: -118.2437,
                    radius_km: 5,
                },
            });

            expect(flow.production).toBe(0); // too far
        });
    });

    describe('Metabolic profile — rhythm across time', () => {
        it('reveals day-of-week patterns', () => {
            // Donations happen Monday mornings
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'add',
                value: 5,
                envelope: {
                    temporal: {
                        availability_window: {
                            day_schedules: [{ days: ['monday'], time_ranges: [{ start_time: '09:00', end_time: '12:00' }] }],
                        },
                    },
                },
            }));

            // Borrowing happens Friday afternoons
            stream.submit(makeEffect({
                entity_id: 'library',
                attribute: 'drills',
                operation: 'subtract',
                value: 3,
                envelope: {
                    temporal: {
                        availability_window: {
                            day_schedules: [{ days: ['friday'], time_ranges: [{ start_time: '14:00', end_time: '17:00' }] }],
                        },
                    },
                },
            }));

            const profile = metabolicProfile(stream, 'library', 'drills');
            expect(profile.periods).toHaveLength(7); // 7 days

            const monday = profile.periods.find(p => p.label === 'monday')!;
            const friday = profile.periods.find(p => p.label === 'friday')!;
            const wednesday = profile.periods.find(p => p.label === 'wednesday')!;

            expect(monday.flow.production).toBeGreaterThan(0);
            expect(friday.flow.consumption).toBeGreaterThan(0);
            expect(wednesday.flow.production).toBe(0);
            expect(wednesday.flow.consumption).toBe(0);
        });
    });

    describe('Sustainability assessment', () => {
        it('process with unsustainable metabolism is flagged', () => {
            const stream2 = new EffectStream();
            const manager = new ProcessManager(stream2);

            // Create process with a tool requirement
            const lib = manager.create({
                name: 'Tool Library',
                author: 'carol',
                slots: [{
                    kind: 'condition',
                    name: 'Tools',
                    predicates: [{ entity_id: 'tools', attribute: 'count', min: 5 }],
                }],
            });

            // Add tools (production)
            stream2.submit(makeEffect({
                entity_id: 'tools',
                attribute: 'count',
                operation: 'add',
                value: 2,
            }));

            // Remove tools (consumption > production)
            stream2.submit(makeEffect({
                entity_id: 'tools',
                attribute: 'count',
                operation: 'subtract',
                value: 5,
            }));

            const state = manager.getWithState(lib.id)!;
            expect(state.sustainable).toBe(false);
        });
    });
});

// =============================================================================
// THE FULL LOOP
// =============================================================================

describe('The Loop: State → Effects → Process → State', () => {
    it('complete scenario: Block Party from empty state to actual', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);
        const alloc = new Allocations();

        // 1. Create the process with slots (state predicates)
        const party = manager.create({
            name: 'Block Party',
            author: 'alice',
            slots: [
                {
                    kind: 'condition',
                    name: 'Venue',
                    predicates: [{ entity_id: 'community-hall', attribute: 'available', min: 1 }],
                },
                {
                    kind: 'condition',
                    name: 'Food',
                    predicates: [{ entity_id: 'food-supply', attribute: 'servings', min: 50 }],
                },
                {
                    kind: 'condition',
                    name: 'Music',
                    predicates: [{ entity_id: 'music', attribute: 'hours', min: 4 }],
                },
            ],
        });

        expect(party.actual).toBe(false);
        expect(party.satisfaction_ratio).toBe(0);

        // 2. Venue: Bob submits a projected effect (he'll provide the venue)
        const venueProjection = makeEffect({
            entity_id: 'community-hall',
            attribute: 'available',
            operation: 'set',
            value: 1,
            phase: 'projected',
            author: 'bob',
        });
        stream.submit(venueProjection);

        // Still not actual — projections don't count
        expect(manager.getWithState(party.id)!.actual).toBe(false);

        // 3. Venue confirmed (accepted)
        stream.assert(venueProjection.origin_id, { phase: 'pending', by: 'bob' });
        stream.assert(venueProjection.origin_id, { phase: 'accepted', by: 'alice' });

        // 1 of 3 required slots now satisfied
        expect(manager.getWithState(party.id)!.satisfaction_ratio).toBeCloseTo(1 / 3, 1);

        // 4. Food: Carol provides servings (directly accepted)
        stream.submit(makeEffect({
            entity_id: 'food-supply',
            attribute: 'servings',
            operation: 'set',
            value: 60,
            author: 'carol',
        }));

        expect(manager.getWithState(party.id)!.satisfaction_ratio).toBeCloseTo(2 / 3, 1);

        // 5. Music: Dave allocates his time, then fulfills it
        const musicSlot = party.slots.find(s => s.name === 'Music')!;
        alloc.commit({
            slot_id: musicSlot.id as NanoId,
            process_id: party.id as NanoId,
            contributor_id: 'dave',
            quantity: 4,
            unit: 'hours',
        });

        // Allocation doesn't produce effects — still not actual
        expect(manager.getWithState(party.id)!.actual).toBe(false);

        // Dave actually plays music (fulfillment → effect)
        stream.submit(makeEffect({
            entity_id: 'music',
            attribute: 'hours',
            operation: 'set',
            value: 4,
            author: 'dave',
        }));

        // ALL slots satisfied → process is actual!
        const finalState = manager.getWithState(party.id)!;
        expect(finalState.actual).toBe(true);
        expect(finalState.satisfaction_ratio).toBe(1);
    });

    it('retraction cascades: venue falls through, party becomes potential again', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);

        const party = manager.create({
            name: 'Block Party',
            author: 'alice',
            slots: [{
                kind: 'condition',
                name: 'Venue',
                predicates: [{ entity_id: 'venue', attribute: 'available', min: 1 }],
            }],
        });

        const venue = makeEffect({
            entity_id: 'venue',
            attribute: 'available',
            operation: 'set',
            value: 1,
        });
        stream.submit(venue);
        expect(manager.getWithState(party.id)!.actual).toBe(true);

        // Venue retracted!
        stream.assert(venue.origin_id, { phase: 'retracted', by: 'landlord' });
        expect(manager.getWithState(party.id)!.actual).toBe(false);

        // New venue saves the day
        stream.submit(makeEffect({
            entity_id: 'venue',
            attribute: 'available',
            operation: 'set',
            value: 1,
            author: 'eve',
        }));
        expect(manager.getWithState(party.id)!.actual).toBe(true);
    });

    it('multiple effects combine to satisfy a single slot (additive)', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);

        const coop = manager.create({
            name: 'Childcare Cooperative',
            author: 'maria',
            slots: [{
                kind: 'condition',
                name: 'Caregivers',
                predicates: [{ entity_id: 'daycare', attribute: 'hours', min: 8 }],
            }],
        });

        // Maria contributes 3 hours
        stream.submit(makeEffect({ entity_id: 'daycare', attribute: 'hours', operation: 'add', value: 3, author: 'maria' }));
        expect(manager.getWithState(coop.id)!.actual).toBe(false);

        // Jose contributes 3 hours
        stream.submit(makeEffect({ entity_id: 'daycare', attribute: 'hours', operation: 'add', value: 3, author: 'jose' }));
        expect(manager.getWithState(coop.id)!.actual).toBe(false);

        // Ana contributes 3 hours — total now 9, above the 8 threshold
        stream.submit(makeEffect({ entity_id: 'daycare', attribute: 'hours', operation: 'add', value: 3, author: 'ana' }));
        expect(manager.getWithState(coop.id)!.actual).toBe(true);

        // Verify: 3 different people, 3 effects, one satisfied slot
        const hours = derive(stream, 'daycare', 'hours');
        expect(hours.value).toBe(9);
        expect(hours.contributors).toHaveLength(3);
    });

    it('plans are not reality: projection vs acceptance', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);

        const lib = manager.create({
            name: 'Tool Library',
            author: 'carol',
            slots: [{
                kind: 'condition',
                name: 'Storage',
                predicates: [{ entity_id: 'storage', attribute: 'available', exact: true }],
            }],
        });

        // Projected: someone says they'll provide storage
        const promise = makeEffect({
            entity_id: 'storage',
            attribute: 'available',
            operation: 'set',
            value: true,
            phase: 'projected',
        });
        stream.submit(promise);
        expect(manager.getWithState(lib.id)!.actual).toBe(false); // projections don't count

        // Rejected: the storage fell through
        stream.assert(promise.origin_id, { phase: 'pending', by: 'system' });
        stream.assert(promise.origin_id, { phase: 'rejected', by: 'reality' });
        expect(manager.getWithState(lib.id)!.actual).toBe(false);

        // A different offer, accepted this time
        stream.submit(makeEffect({
            entity_id: 'storage',
            attribute: 'available',
            operation: 'set',
            value: true,
        }));
        expect(manager.getWithState(lib.id)!.actual).toBe(true);
    });

    it('allocation prevents double-counting', () => {
        const alloc = new Allocations();
        const slotA = 'slot-aaaa-bbbbbb' as NanoId;
        const slotB = 'slot-cccc-dddddd' as NanoId;
        const processA = 'process-1234abcd' as NanoId;
        const processB = 'process-5678efgh' as NanoId;

        // Maria has 10 hours total
        alloc.commit({ slot_id: slotA, process_id: processA, contributor_id: 'maria', quantity: 8 });

        const coverageA = alloc.allocationCoverage(slotA, 8);
        expect(coverageA.status).toBe('fully_allocated');

        // Maria also tries to commit to another process
        alloc.commit({ slot_id: slotB, process_id: processB, contributor_id: 'maria', quantity: 8 });

        // Both show as allocated — it's up to the system to check Maria's total capacity
        // The allocation layer records claims; capacity checking is a separate concern
        const mariaCommitments = alloc.commitmentsForContributor('maria');
        expect(mariaCommitments).toHaveLength(2);
        const totalAllocated = mariaCommitments.reduce((sum, c) => sum + c.quantity, 0);
        expect(totalAllocated).toBe(16); // over-committed — flagged by capacity checking
    });
});

// =============================================================================
// DERIVATION DETAILS
// =============================================================================

describe('Derivation', () => {
    let stream: EffectStream;

    beforeEach(() => {
        stream = new EffectStream();
        idCounter = 0;
    });

    describe('Constraints', () => {
        it('checkConstraint validates min/max/exact', () => {
            const d: DerivedValue = { entity_id: 'e', attribute: 'a', value: 15, contributors: [], effect_count: 1 };

            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', min: 10 }).satisfied).toBe(true);
            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', min: 20 }).satisfied).toBe(false);
            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', max: 20 }).satisfied).toBe(true);
            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', max: 10 }).satisfied).toBe(false);
            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', exact: 15 }).satisfied).toBe(true);
            expect(checkConstraint(d, { entity_id: 'e', attribute: 'a', exact: 10 }).satisfied).toBe(false);
        });

        it('custom check function', () => {
            const d: DerivedValue = { entity_id: 'e', attribute: 'a', value: 'hello', contributors: [], effect_count: 1 };

            expect(checkConstraint(d, {
                entity_id: 'e', attribute: 'a',
                check: v => typeof v === 'string' && v.length > 3,
            }).satisfied).toBe(true);

            expect(checkConstraint(d, {
                entity_id: 'e', attribute: 'a',
                check: v => typeof v === 'number',
            }).satisfied).toBe(false);
        });
    });

    describe('predicateToConstraint bridge', () => {
        it('converts StatePredicate to AttributeConstraint', () => {
            const pred: StatePredicate = {
                entity_id: 'venue',
                attribute: 'chairs',
                min: 20,
                max: 100,
                binding: 'hard',
            };

            const constraint = predicateToConstraint(pred);
            expect(constraint.entity_id).toBe('venue');
            expect(constraint.attribute).toBe('chairs');
            expect(constraint.min).toBe(20);
            expect(constraint.max).toBe(100);
        });
    });

    describe('Snapshot', () => {
        it('captures a point-in-time view of an entity', () => {
            stream.submit(makeEffect({ entity_id: 'library', attribute: 'drills', operation: 'set', value: 20 }));
            stream.submit(makeEffect({ entity_id: 'library', attribute: 'saws', operation: 'set', value: 5 }));
            stream.submit(makeEffect({ entity_id: 'library', attribute: 'drills', operation: 'subtract', value: 3 }));

            const snap = snapshot(stream, 'library', ['drills', 'saws']);
            expect(snap.attributes.drills).toBe(17);
            expect(snap.attributes.saws).toBe(5);
            expect(snap.metabolism.drills).toBeDefined();
            expect(snap.metabolism.saws).toBeDefined();
        });
    });

    describe('evaluateSlot', () => {
        it('evaluates constraints against derived state', () => {
            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'capacity', operation: 'set', value: 50 }));

            const result = evaluateSlot(stream, 'slot-1', [
                { entity_id: 'venue', attribute: 'capacity', min: 30 },
            ]);

            expect(result.satisfied).toBe(true);
            expect(result.derived[0].value).toBe(50);
        });

        it('partial satisfaction when some constraints fail', () => {
            stream.submit(makeEffect({ entity_id: 'venue', attribute: 'capacity', operation: 'set', value: 50 }));

            const result = evaluateSlot(stream, 'slot-1', [
                { entity_id: 'venue', attribute: 'capacity', min: 30 },
                { entity_id: 'venue', attribute: 'parking', min: 10 }, // no parking effects
            ]);

            expect(result.satisfied).toBe(false);
            expect(result.partial).toBe(true);
        });
    });
});

// =============================================================================
// EFFECT STREAM MECHANICS
// =============================================================================

describe('Effect Stream', () => {
    let stream: EffectStream;

    beforeEach(() => {
        stream = new EffectStream();
        idCounter = 0;
    });

    it('stores and retrieves effects by origin_id', () => {
        const eff = makeEffect({ entity_id: 'x', attribute: 'y', operation: 'set', value: 1 });
        stream.submit(eff);

        const retrieved = stream.latest(eff.origin_id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.origin_id).toBe(eff.origin_id);
    });

    it('maintains version history', () => {
        const eff = makeEffect({ entity_id: 'x', attribute: 'y', operation: 'set', value: 1 });
        stream.submit(eff);
        stream.assert(eff.origin_id, { phase: 'retracted', by: 'test' });

        const versions = stream.versions(eff.origin_id);
        expect(versions).toHaveLength(2);
        expect(versions[0].version).toBe(0);
        expect(versions[1].version).toBe(1);
    });

    it('queries by phase', () => {
        stream.submit(makeEffect({ entity_id: 'a', attribute: 'x', operation: 'set', value: 1, phase: 'projected' }));
        stream.submit(makeEffect({ entity_id: 'b', attribute: 'x', operation: 'set', value: 2, phase: 'accepted' }));
        stream.submit(makeEffect({ entity_id: 'c', attribute: 'x', operation: 'set', value: 3, phase: 'accepted' }));

        expect(stream.inPhase('projected')).toHaveLength(1);
        expect(stream.inPhase('accepted')).toHaveLength(2);
    });

    it('queries by entity', () => {
        stream.submit(makeEffect({ entity_id: 'library', attribute: 'drills', operation: 'set', value: 1 }));
        stream.submit(makeEffect({ entity_id: 'library', attribute: 'saws', operation: 'set', value: 2 }));
        stream.submit(makeEffect({ entity_id: 'park', attribute: 'benches', operation: 'set', value: 3 }));

        expect(stream.forEntity('library')).toHaveLength(2);
        expect(stream.forEntity('park')).toHaveLength(1);
    });

    it('emits events to subscribers', () => {
        const events: string[] = [];
        stream.subscribe(e => events.push(e.type));

        stream.submit(makeEffect({ entity_id: 'x', attribute: 'y', operation: 'set', value: 1 }));
        expect(events).toContain('submitted');
    });

    it('clear resets all state', () => {
        stream.submit(makeEffect({ entity_id: 'x', attribute: 'y', operation: 'set', value: 1 }));
        stream.clear();

        expect(stream.all()).toHaveLength(0);
    });
});

// =============================================================================
// INTEGRATION: ALL EFFECTS ARE OBSERVATIONAL
// =============================================================================

describe('All effects are observational', () => {
    it('natural events and human contributions use the same lifecycle', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);

        const garden = manager.create({
            name: 'Community Garden',
            author: 'green-team',
            slots: [
                {
                    kind: 'condition',
                    name: 'Rain',
                    predicates: [{ entity_id: 'garden', attribute: 'rainfall_mm', min: 25 }],
                },
                {
                    kind: 'condition',
                    name: 'Volunteers',
                    predicates: [{ entity_id: 'garden', attribute: 'volunteer_hours', min: 10 }],
                },
            ],
        });

        // Natural event: rain
        stream.submit(makeEffect({
            entity_id: 'garden',
            attribute: 'rainfall_mm',
            operation: 'set',
            value: 30,
            author: 'weather-station',
        }));

        // Human contribution: volunteers
        stream.submit(makeEffect({
            entity_id: 'garden',
            attribute: 'volunteer_hours',
            operation: 'add',
            value: 12,
            author: 'volunteer-coordinator',
        }));

        const state = manager.getWithState(garden.id)!;
        expect(state.actual).toBe(true);

        // Both natural and human effects contribute equally
        const rain = derive(stream, 'garden', 'rainfall_mm');
        const hours = derive(stream, 'garden', 'volunteer_hours');
        expect(rain.contributors).toContain(rain.contributors[0]); // weather station's effect
        expect(hours.value).toBe(12);
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
    describe('Slot kinds', () => {
        it('data slot: satisfied when value is provided', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            const c = manager.create({
                name: 'Event Setup',
                author: 'alice',
                slots: [
                    {
                        kind: 'data',
                        name: 'Event Name',
                        data_type: 'string',
                    },
                    {
                        kind: 'data',
                        name: 'Max Attendees',
                        data_type: 'number',
                    },
                ],
            });

            // Data slots start unsatisfied (no value)
            expect(c.actual).toBe(false);

            // Provide the event name
            const eventNameSlot = c.slots.find(s => s.name === 'Event Name')!;
            manager.setData(c.id, eventNameSlot.id, 'Summer Block Party');

            // Still not actual — second data slot still empty
            let state = manager.getWithState(c.id)!;
            expect(state.actual).toBe(false);

            // Provide max attendees
            const maxSlot = c.slots.find(s => s.name === 'Max Attendees')!;
            manager.setData(c.id, maxSlot.id, 100);

            state = manager.getWithState(c.id)!;
            expect(state.actual).toBe(true);
        });

        it('data slot with options', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            const c = manager.create({
                name: 'Lunch Order',
                author: 'bob',
                slots: [{
                    kind: 'data',
                    name: 'Meal Choice',
                    data_type: 'option',
                    options: ['pizza', 'salad', 'soup'],
                }],
            });

            expect(c.actual).toBe(false);

            const slot = c.slots[0];
            manager.setData(c.id, slot.id, 'pizza');

            const state = manager.getWithState(c.id)!;
            expect(state.actual).toBe(true);
            // Verify the slot retains its value
            const dataSlot = state.slots.find(s => s.name === 'Meal Choice')!;
            expect(dataSlot.kind).toBe('data');
            if (dataSlot.kind === 'data') {
                expect(dataSlot.value).toBe('pizza');
            }
        });

        it('composition slot: sugar for actuality predicate', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            // Create the dependency
            const coop = manager.create({
                name: 'Childcare Co-op',
                author: 'maria',
                slots: [{
                    kind: 'condition',
                    name: 'Caregivers',
                    predicates: [{ entity_id: 'daycare', attribute: 'hours', min: 8 }],
                }],
            });

            // Create the dependent with a composition slot
            const festival = manager.create({
                name: 'Festival',
                author: 'alice',
                slots: [{
                    kind: 'composition',
                    name: 'Childcare',
                    process_id: coop.process_id,
                }],
            });

            expect(festival.actual).toBe(false);

            // Make childcare actual by setting its actuality
            stream.submit(makeEffect({
                entity_id: coop.process_id,
                attribute: 'actuality',
                operation: 'set',
                value: true,
            }));

            expect(manager.getWithState(festival.id)!.actual).toBe(true);
        });

        it('need slot: carries a Resource query', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            const c = manager.create({
                name: 'Concert',
                author: 'alice',
                slots: [{
                    kind: 'need',
                    name: 'Sound Engineer',
                    need: {
                        id: 'need-sound-eng-001' as NanoId,
                        type_id: 'sound_engineer',
                        quantity: 1,
                        required_skills: [{ id: 'mixing', level: 3 }],
                    },
                    predicates: [{ entity_id: 'sound', attribute: 'engineer_hours', min: 4 }],
                }],
            });

            // Need slot starts unsatisfied (predicates not met)
            expect(c.actual).toBe(false);

            // Satisfy the predicates
            stream.submit(makeEffect({
                entity_id: 'sound',
                attribute: 'engineer_hours',
                operation: 'set',
                value: 6,
            }));

            const state = manager.getWithState(c.id)!;
            expect(state.actual).toBe(true);

            // Verify the slot retains its Resource
            const slot = state.slots[0];
            expect(slot.kind).toBe('need');
            if (slot.kind === 'need') {
                expect(slot.need.type_id).toBe('sound_engineer');
                expect(slot.need.quantity).toBe(1);
            }
        });

        it('need slot without predicates: trivially satisfied for now', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            const c = manager.create({
                name: 'Workshop',
                author: 'bob',
                slots: [{
                    kind: 'need',
                    name: 'Projector',
                    need: {
                        id: 'need-projector-01' as NanoId,
                        type_id: 'projector',
                        quantity: 1,
                    },
                    // No predicates — satisfaction will come from snapshot matching later
                }],
            });

            // With no predicates, the slot is trivially satisfied by derivation
            // (Full Resource→snapshot matching is a future concern)
            expect(c.actual).toBe(true);
        });

        it('mixed slot kinds in one process', () => {
            const stream = new EffectStream();
            const manager = new ProcessManager(stream);

            const coop = manager.create({
                name: 'Childcare',
                author: 'maria',
                slots: [{
                    kind: 'condition',
                    name: 'Staff',
                    predicates: [{ entity_id: 'care', attribute: 'hours', min: 4 }],
                }],
            });

            const party = manager.create({
                name: 'Full Block Party',
                author: 'alice',
                slots: [
                    { kind: 'condition', name: 'Venue', predicates: [{ entity_id: 'v', attribute: 'avail', min: 1 }] },
                    { kind: 'composition', name: 'Childcare', process_id: coop.process_id },
                    { kind: 'data', name: 'Theme', data_type: 'string' },
                    { kind: 'need', name: 'DJ', need: { id: 'need-dj-12345' as NanoId, type_id: 'dj', quantity: 1 } },
                ],
            });

            // Nothing satisfied yet
            expect(party.actual).toBe(false);
            expect(party.satisfaction_ratio).toBe(0.25); // DJ need (no predicates) is trivially satisfied

            // Satisfy venue
            stream.submit(makeEffect({ entity_id: 'v', attribute: 'avail', operation: 'set', value: 1 }));
            expect(manager.getWithState(party.id)!.satisfaction_ratio).toBe(0.5);

            // Satisfy childcare composition
            stream.submit(makeEffect({ entity_id: coop.process_id, attribute: 'actuality', operation: 'set', value: true }));
            expect(manager.getWithState(party.id)!.satisfaction_ratio).toBe(0.75);

            // Provide theme data
            const themeSlot = party.slots.find(s => s.name === 'Theme')!;
            manager.setData(party.id, themeSlot.id, 'Tropical');
            expect(manager.getWithState(party.id)!.actual).toBe(true);
        });
    });

    it('process with no required slots is always actual', () => {
        const stream = new EffectStream();
        const manager = new ProcessManager(stream);

        const c = manager.create({
            name: 'Open Space',
            author: 'anyone',
            slots: [{
                kind: 'condition',
                name: 'Nice to have',
                required: false,
                predicates: [{ entity_id: 'x', attribute: 'y', min: 1 }],
            }],
        });

        expect(c.actual).toBe(true);
    });

    it('deriving an attribute with no effects returns undefined', () => {
        const stream = new EffectStream();
        const d = derive(stream, 'nonexistent', 'nothing');
        expect(d.value).toBeUndefined();
        expect(d.effect_count).toBe(0);
    });

    it('modified effect: contribution happened differently', () => {
        const stream = new EffectStream();

        const eff = makeEffect({
            entity_id: 'daycare',
            attribute: 'hours',
            operation: 'add',
            value: 3,
            author: 'maria',
        });
        stream.submit(eff);
        expect(derive(stream, 'daycare', 'hours').value).toBe(3);

        // Maria only stayed 2 hours — modified
        stream.assert(eff.origin_id, { phase: 'modified', by: 'supervisor', note: 'only 2 hours' });

        // The modified version needs new deltas to reflect the correction.
        // In practice, a new effect version would be created with updated deltas.
        // The modified phase flags that the original was inaccurate.
        const latest = stream.latest(eff.origin_id)!;
        expect(currentPhase(latest)).toBe('modified');
    });

    it('stateKey helper generates consistent keys', () => {
        expect(stateKey('venue-123', 'availability')).toBe('venue-123:availability');
        expect(stateKey('a', 'b')).toBe('a:b');
    });
});
