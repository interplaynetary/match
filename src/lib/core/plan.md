# Time Accounting & Fulfillment Records Plan

## Problem Statement

The current `Slot` schema conflates several distinct concepts:
- **Commitment** (someone agrees to fill a slot)
- **Contribution** (actual work performed)
- **Completion** (the need is fully satisfied)

This is especially problematic for:
1. **Recurring slots** (Resources with recurrence windows) - the same slot may be filled many times
2. **Partial fulfillment** - contributions can satisfy part of a need
3. **Time accounting** - tracking actual labor time requires records, not just slot state

## Design Principle

Following the pattern established with `MatchRecord` (separate from `Resource`), we need:
- `FulfillmentRecord` - tracks individual contributions to slots over time
- Slot remains the *template* / *need declaration*
- Fulfillment records are the *instances* / *actual contributions*

## Questions to Resolve

### Q1: What is the relationship between Slot and Resource?
- Currently: Slot.input can reference a Resource via `kind: 'resource'`
- Resources have recurrence patterns (AvailabilityWindow)
- Does a recurring Resource mean the Slot expects multiple contributions?
        - I think so by default, but we should actually commit specific instances of recurrance patterns, or specify a commitment-pattern

### Q2: What constitutes "completion" for different slot types?
- **One-time slot**: Single contribution that meets the need
- **Recurring slot**: What does "complete" mean? All instances through end_date? Each instance separately?
- **Quantity-based**: Need 10 hours, got 7 - is this 70% complete?

### Q3: How do we track time for Marxian accounting?
Marx distinguishes:
- **Expected labor time** (what we estimate the work will take)
- **Actual labor time** (what it really took)
- **Socially necessary labor time** (average across similar contributions)

What data do we need to capture for each?

## Proposed Schema

```typescript
// A single contribution to a slot
const FulfillmentRecord = z.object({
    id: NanoId,
    slot_id: NanoId,
    commons_id: NanoId,
    contributor_id: z.string(),

    // What was contributed
    quantity: z.number().nonnegative().optional(),
    unit: z.string().optional(),

    // When (for recurring slots, which instance)
    occurrence_date: z.date().optional(),  // which recurrence instance

    // Time accounting
    committed_at: z.date(),           // when they agreed
    started_at: z.date().optional(),  // when work began
    completed_at: z.date().optional(), // when work finished

    expected_duration_hours: z.number().positive().optional(),
    actual_duration_hours: z.number().nonnegative().optional(),

    // Status
    status: z.enum(['committed', 'in_progress', 'completed', 'cancelled']),

    // Notes/evidence
    notes: z.string().optional(),
});
```

## Open Questions

1. Should `Slot.filled_by` remain for backward compatibility, or be derived from FulfillmentRecords?
2. How do we aggregate fulfillments to determine slot/commons status?
3. For recurring slots, do we pre-generate expected occurrences or track them ad-hoc?

## Files to Modify

- `src/lib/core/commons.ts` - Add FulfillmentRecord schema, modify CommonsManager
- Possibly new file: `src/lib/core/fulfillment.ts` - Separate concern

## Verification

- [ ] Existing tests still pass
- [ ] Can track multiple contributions to a recurring slot
- [ ] Can calculate partial completion percentage
- [ ] Time accounting aggregation works across fulfillments
