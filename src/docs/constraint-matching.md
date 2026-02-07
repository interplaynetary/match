# Constraint Matching

Non-semantic constraints that filter and score matches based on feasibility.

## Overview

Semantic matching (embeddings + categories) finds conceptually compatible matches. Constraints filter those matches by practical feasibility:

| Constraint | Question |
|------------|----------|
| **Quantity** | Does the capacity have enough? |
| **Time** | Are availability windows compatible? |
| **Space** | Are locations compatible? |

Constraint scores are combined with semantic scores via geometric mean.

---

## Implementation Status

| Constraint | Status | Notes |
|------------|--------|-------|
| Quantity | Implemented | Unit matching, ratio scoring |
| Time | Stub | Data structures exist, logic returns placeholders |
| Space | Partial | Exact area matching only, no distance calculation |

---

## Quantity Constraints

**Status: Implemented**

Checks whether a capacity can satisfy a need's quantity requirements.

### Data Model

```typescript
type QuantityConstraint = {
  amount: number
  unit: string        // "kg", "chairs", "people", etc.
  minAtomic?: number  // minimum atomic units (not yet used)
}
```

### Matching Rules

1. **Units must match exactly** — "kg" ≠ "lbs" (unit conversion not implemented)
2. **Capacity must meet or exceed need** for score 1.0
3. **Partial fulfillment** scores proportionally

### Scoring

| Condition | Score |
|-----------|-------|
| Either side missing quantity | 1.0 (no constraint) |
| Unit mismatch | 0.0 (no match) |
| Capacity ≥ need | 1.0 |
| Capacity < need | capacity.amount / need.amount |

### Examples

```
Need: 2kg flour
Offer: 5kg flour
→ Score: 1.0 (5 ≥ 2)

Need: 5kg flour
Offer: 2kg flour
→ Score: 0.4 (2/5 = partial fulfillment)

Need: 30 tables
Offer: 50 chairs
→ Score: 0.0 (unit mismatch)
```

---

## Time Constraints

**Status: Stub — data structures only**

The matching logic currently returns placeholder values. Actual overlap calculation is not implemented.

### Data Model

```typescript
type TimeConstraint = {
  availableFrom?: string    // ISO date "2024-01-27"
  availableTo?: string      // ISO date "2024-01-28"
  dayOfWeek?: string        // "Monday", "Mon-Wed"
  timeOfDay?: string        // "9am-5pm", "evenings"
  recurring?: string        // "weekly", "daily"
  minDuration?: number      // minutes
}
```

### Current Behavior

```typescript
// Actual implementation (placeholder)
if (!needTime && !capacityTime) return 1.0
if (!needTime || !capacityTime) return 0.5
return 1.0  // ← does not check overlap
```

### Intended Matching Rules (Not Yet Implemented)

1. Date ranges should overlap
2. Day-of-week patterns should intersect
3. Time-of-day windows should overlap
4. Duration requirements should be satisfiable
5. Recurring patterns should align

### Example Data (from test fixtures)

```json
{
  "id": "17",
  "expressions": [{ "text": "professional photography services" }],
  "constraints": {
    "time": {
      "dayOfWeek": "Mon-Wed",
      "timeOfDay": "9am-5pm EST",
      "recurring": "weekly"
    }
  }
}
```

---

## Space Constraints

**Status: Partial — exact area matching only**

### Data Model

```typescript
type SpaceConstraint = {
  location?: { lat: number; lng: number }
  area?: string          // area name/code
  maxRadius?: number     // km
  remote?: boolean
}
```

### Current Behavior

```typescript
// What works
if (need.area === capacity.area) return 1.0     // exact area match
if (need.remote && capacity.remote) return 1.0  // both remote

// What doesn't work
// - Distance calculation from lat/lng
// - Radius-based matching
// - Partial area overlap
```

### Scoring

| Condition | Score |
|-----------|-------|
| Either side missing space | 1.0 (no constraint) |
| Exact area match | 1.0 |
| Both remote | 1.0 |
| Area mismatch | 0.3 |
| One side missing | 0.5 |

---

## Score Combination

Constraint feasibility scores are combined with semantic scores using geometric mean:

```
finalScore = (
  semanticScore *
  priorityWeight *
  timeFeasibility *
  spaceFeasibility *
  quantityFeasibility
) ^ (1/5)
```

This means any constraint scoring 0 eliminates the match entirely.

---

## Future Work

### Time Matching
- Parse and compare date ranges for overlap
- Handle recurring patterns (weekly, daily)
- Support timezone-aware comparisons
- Duration requirement validation

### Space Matching
- Haversine distance calculation from coordinates
- Radius-based proximity matching
- Hierarchical area matching (neighborhood → city → region)

### Quantity Matching
- Unit conversion (kg ↔ lbs, hours ↔ minutes)
- Aggregate matching (multiple capacities → one need)
- Minimum atomic unit enforcement
