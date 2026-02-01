# Scoring Improvements (2026-02-01)

This document explains the scoring changes made to fix bad matches scoring too high.

## Background

We observed matches like these scoring absurdly high:
- "piano lessons" → "business succession opportunity": **89%**
- "lawnmower" → "freelance web developer": **87%**

These should score much lower. Investigation revealed two issues.

## Problem 1: Generic category matches

When category chains overlapped only at distance 2+ (e.g., both containing "services"), this was still being treated as a useful category match and blended into the score.

**Example:**
```
Need:     services > education > music-instruction > piano
Capacity: services > business > business-transfer
Overlap:  "services" at distance 2
```

This "services" overlap provides almost no signal — they're just both services.

### Fix

Cap category matching at distance 1. If the overlap is at distance 2+, fall back to pure embedding similarity.

```typescript
// src/category-matcher.ts
export const MAX_CATEGORY_DISTANCE = 1

export function computeCategoryScore(distance: number): number | null {
  if (distance > MAX_CATEGORY_DISTANCE) {
    return null  // too generic, don't use
  }
  return Math.max(0.5, 1.0 - distance * 0.2)
}
```

## Problem 2: Empty constraints inflating scores

The enrichment pipeline was creating constraint objects with all null values:
```json
{
  "time": { "availableFrom": null, "availableTo": null, ... },
  "quantity": { "amount": null, "unit": null }
}
```

These objects are truthy, so the matcher was including them in scoring. When both sides had these empty objects, they scored as "compatible" (1.0), inflating the geometric mean.

### Fix

Added helper functions to check if constraints have *meaningful* values:

```typescript
function hasTimeConstraint(t?: Constraints['time']): boolean {
  if (!t) return false
  return !!(t.availableFrom || t.availableTo || t.dayOfWeek || ...)
}
```

The constraint is only included in the score if at least one side has meaningful data.

## Results

| Match | Before | After |
|-------|--------|-------|
| piano lessons → business succession | 89% | 52% |
| lawnmower → web developer | 87% | 68% |
| piano lessons → piano teacher | 69% | 95% |
| flour → organic flour | 83% | 83% |
| doula → birth doula (wormhole) | 98% | 98% |

Good matches stayed high or improved. Bad matches dropped significantly.

## Remaining Issues

### ~~Time overlap bug~~ (Fixed)

The time matching function was incorrectly reporting "overlaps" when days didn't match (e.g., Saturday vs Mon-Wed). This has been fixed - day schedules now correctly return false when days don't intersect. The lawnmower (Saturday) → web developer (Mon-Wed) match is now blocked entirely by the time constraint.

### Asymmetric distance

Currently, we only penalize based on *distance from need's leaf*. But the direction matters:
- Specific capacity matching general need → OK
- Specific need matching generic capacity → Bad

Example:
- Need "food" matching capacity "organic-flour" (specific under need) → Good
- Need "ML engineer" matching capacity "general services" → Bad

This requires considering both chains' depths when scoring.

### Taxonomy naming collisions

The "location" category is overloaded:
- `services > events > film-production > location` (filming location)
- `services > legal > notary > location` (service area)

These match at distance 0 even though they mean completely different things. The fix is better taxonomy naming (e.g., `film-location`, `service-area`).

## Test File

The scoring behavior is now codified in `src/scoring.test.ts`:

```bash
bun test src/scoring.test.ts
```

This tests specific need-capacity pairs with expected score ranges, making it easier to tune parameters without breaking good behavior.
