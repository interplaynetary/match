# Fulfillment: Commitments & Deliveries

## The Model

```
Match        →  Commitment    →  Delivery
(potential)     (promise)        (actual)
```

**Match** = computed compatibility (from matching.ts)
**Commitment** = "I promise to provide X" (binding, can be cancelled)
**Delivery** = "I actually provided Y" (immutable event)

## Two Immutable Record Types

```typescript
// A promise to provide (can be cancelled, otherwise immutable)
Commitment = {
    id, slot_id, commons_id, occurrence?,
    contributor_id,
    quantity: number,
    committed_at: Date,
    cancelled_at?: Date,
}

// Actual provision (immutable event)
Delivery = {
    id, slot_id, commons_id, occurrence?,
    commitment_id?: NanoId,  // optional link
    contributor_id,
    quantity: number,
    delivered_at: Date,
    duration_hours?: number,  // time accounting
}
```

## Why Two Records?

| Use Case | Commitments | Deliveries |
|----------|-------------|------------|
| Alice commits 3, delivers 3 | 1 | 1 |
| Bob commits 10, delivers in parts | 1 | 3 |
| Carol commits 2, delivers 4 (exceeds) | 1 | 1+ |
| Dave helps without committing | 0 | 1 |
| Eve commits 5, never delivers | 1 | 0 |

All cases handled cleanly.

## Coverage Metrics

**Per occurrence (slot + date):**
```
quantity_needed     = from Resource
quantity_delivered  = sum(deliveries)
quantity_committed  = sum(active commitments) - already delivered against them
quantity_remaining  = needed - delivered
quantity_gap        = remaining - committed
coverage_ratio      = (delivered + committed) / needed
```

**Status derived:**
- `delivered`: delivery_ratio >= 1
- `covered`: coverage_ratio >= 1 (enough commitments)
- `partial`: some activity but gap exists
- `gap`: nothing committed or delivered

## Lazy Instances for Recurring

Occurrences emerge lazily when someone commits/delivers. For future planning:

```typescript
// Caller generates expected occurrences from Resource recurrence pattern
const expected = ['2024-03-05', '2024-03-12', '2024-03-19'];

// Check coverage including future occurrences with no activity yet
const coverage = fulfillments.recurringCoverage(slot_id, commons_id, quantity_needed, expected);

// Find gaps
const gaps = [...coverage.occurrences.values()].filter(o => o.status === 'gap');
```

## Time Accounting (Marx)

On Delivery:
- `duration_hours`: actual time spent

Derived:
- `total_duration_hours`: sum across deliveries
- `avg_duration_hours`: average per delivery
- `socially_necessary_hours`: average across similar deliveries (the Marxian measure)

Commitment-to-delivery analysis:
- `time_to_first_delivery_hours`: how long from promise to first delivery?
- `is_fulfilled`: has the full committed quantity been delivered?

## Integration with commons.ts

**Slot stays pure (template):**
```typescript
Slot = {
    id, name, description,
    input: InputDefinition,
    optional: boolean,
    acceptance_logic?: AcceptanceLogic,
    expected_duration_hours?: number,  // template estimate
}
```

Remove: `filled_by`, `filled_at`, `completed_at`, `actual_duration_hours`

**State derived from fulfillments:**
```typescript
// Is slot filled? Check coverage
const coverage = fulfillments.slotCoverage(slot.id, commons.id, resource.quantity);
const isFilled = coverage.coverage_ratio >= 1;

// Who filled it?
const filledBy = coverage.unique_contributors;
```

**Progress derived:**
```typescript
Progress = {
    slots_filled: number,      // coverage_ratio >= 1
    slots_delivered: number,   // delivery_ratio >= 1
    slots_total: number,
    coverage_percentage: number,
    delivery_percentage: number,
}
```

## Files

- `fulfillment.ts`: Commitment, Delivery, Fulfillments class (DONE)
- `commons.ts`: Clean up Slot, integrate with Fulfillments (TODO)

## Verification

- [ ] Can commit to a slot
- [ ] Can deliver against a commitment
- [ ] Can deliver without commitment (ad-hoc)
- [ ] Partial delivery tracked correctly
- [ ] Exceeding commitment tracked correctly
- [ ] Coverage ratio computed correctly
- [ ] Recurring occurrences handled lazily
- [ ] Future occurrence gaps identified
- [ ] Time accounting works
- [ ] Socially necessary labor time computable
