# Planning System Architecture Analysis

**Last Updated**: 2026-02-11

## Overview

The planning system has been refactored to use a unified, elegant architecture that bridges matching (skills on persons) with planning (labor capacity) through person-level tracking.

---

## Core Abstractions

### 1. Person (Unified Schema)

**Location**: `src/lib/core/person.ts`

**Purpose**: Single source of truth for all person-related data across matching, planning, and scheduling.

```typescript
export const PersonSchema = z.object({
  // Identity
  id: z.string(),
  name: z.string().optional(),

  // Skills (for matching & planning)
  skills: z.array(SkillSchema),
  labor_powers: z.array(LaborPowerSchema).optional(), // Deprecated, use skills

  // Availability (for scheduling)
  availability_window: AvailabilityWindowSchema.optional(),
  hours_per_day: z.number().optional(),
  hours_per_week: z.number().optional(),

  // Location (for space-time matching)
  location: z
    .object({
      city: z.string().optional(),
      country: z.string().optional(),
      h3_index: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .optional(),

  // Planning (for stockbook)
  skills_inventory: z.record(z.string(), z.number()).optional(),
});
```

**Benefits**:

- ✅ No more `Individual` vs `Contact` vs `PersonWithAvailability` confusion
- ✅ Works for matching, planning, and scheduling
- ✅ Conversion utilities for backward compatibility

---

### 2. LaborIndex (Person-Level Capacity Tracking)

**Location**: `src/lib/core/labor.ts`

**Purpose**: Prevent double-counting by tracking person capacity once and indexing by skills.

```typescript
export interface LaborIndex {
  // Person capacities (stored ONCE per person)
  person_capacities: Map<string, PersonCapacity>;

  // Skill index (references to person capacities)
  skill_index: Map<string, Set<string>>;

  // Space-time index (future: filter by location/time)
  space_time_index: Map<string, Set<string>>;
}

export interface PersonCapacity {
  person_id: string;
  capacity_id: string; // Unique: person_id|space|time
  total_hours: number; // Stored ONCE
  skills: Skill[]; // Person's skills
  location?: Location;
  time_window?: TimeWindow;
}
```

**Key Insight**: A person with multiple skills has their hours stored **once** in `person_capacities`, and multiple skill indexes **reference** that single capacity.

**Example**:

```typescript
// Alice has 40 hours/week and skills [welding, electrical]
person_capacities.set("alice|Berlin_weekly", {
  person_id: "alice",
  capacity_id: "alice|Berlin_weekly",
  total_hours: 40, // Stored ONCE
  skills: [{ id: "welding" }, { id: "electrical" }],
});

// Skill indexes reference the same capacity
skill_index.get("welding").add("alice|Berlin_weekly");
skill_index.get("electrical").add("alice|Berlin_weekly");

// Query: Total welding hours
const welders = queryLaborBySkill(index, "welding");
getTotalHours(welders); // → 40 (not 80!)
```

---

### 3. Planner Integration

**Location**: `src/lib/core/plan/planner.ts`

**Changes**:

#### buildFeasibleSet

- **Before**: Flat aggregation `laborCapacity: Record<string, number>`
- **After**: Person-level tracking via `LaborIndex`

```typescript
// Before (~8 lines)
const laborCapacity: Record<string, number> = {};
for (const individual of Object.values(individuals)) {
  for (const lp of individual.laborPowers) {
    laborCapacity[lp.skill_id] += lp.hoursPerDay * horizonDays;
  }
}

// After (~6 lines)
const timeWindow = {
  start: new Date(),
  end: new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000),
};
const laborIndex = buildLaborIndex(persons, timeWindow);
```

#### computeMaxByLabor (New Helper)

```typescript
function computeMaxByLabor(strategy: Strategy, laborIndex: LaborIndex): number {
  let maxExecutions = Infinity;

  for (const labor of strategy.labor) {
    const capacities = queryLaborBySkill(laborIndex, labor.skill_id);
    const totalHours = getTotalHours(capacities);

    if (labor.hours > 0) {
      maxExecutions = Math.min(
        maxExecutions,
        Math.floor(totalHours / labor.hours),
      );
    }
  }

  return maxExecutions === Infinity ? 0 : maxExecutions;
}
```

#### FeasibleSet Return Type

```typescript
export interface FeasibleSet {
  strategies: FeasibleStrategy[];
  laborIndex: LaborIndex; // NEW: Include for downstream use
  surplus: {
    materials: Record<string, number>;
    labor: Record<string, number>;
  };
}
```

---

## Architectural Improvements

### Before: Fragmented Architecture

```
┌─────────────────┐
│ matching.ts     │ → Contact (skills on persons)
└─────────────────┘

┌─────────────────┐
│ planner.ts      │ → Individual (laborPowers)
└─────────────────┘    ↓
                   Flat aggregation
                   laborCapacity: { welding: 200 }
                   ❌ Lost person identity
                   ❌ Double-counting bug
```

### After: Unified Architecture

```
┌─────────────────┐
│ person.ts       │ → Person (unified schema)
└─────────────────┘
        ↓
┌─────────────────┐
│ labor.ts        │ → LaborIndex (person-level tracking)
└─────────────────┘    ↓
        ↓              PersonCapacity (stored ONCE)
        ↓              skill_index (references)
┌─────────────────┐
│ planner.ts      │ → Uses LaborIndex queries
└─────────────────┘    ✅ Person identity preserved
                       ✅ No double-counting
                       ✅ Space-time aware
```

---

## Query Capabilities

### Current (Implemented)

```typescript
// Query by skill
const welders = queryLaborBySkill(laborIndex, "welding");

// Query by multiple skills
const multiSkilled = queryLaborBySkills(laborIndex, ["welding", "electrical"]);

// Get total hours
const totalHours = getTotalHours(capacities);
```

### Future (Space-Time Extensions)

```typescript
// Query by skill + location
const berlinWelders = queryLaborBySkillAndLocation(laborIndex, "welding", {
  city: "Berlin",
});

// Query by skill + time window
const morningWelders = queryLaborBySkillAndTime(laborIndex, "welding", {
  start: "09:00",
  end: "12:00",
});

// Query by skill + space + time
const berlinMorningWelders = queryLaborBySkillSpaceTime(
  laborIndex,
  "welding",
  { city: "Berlin" },
  { start: "09:00", end: "12:00" },
);
```

---

## Code Cleanup

### Removed Deprecated Code

#### Deduction System (D1-D6)

- **Removed from stockbook.ts**: ~70 lines
  - `DeductionTypeSchema`, `DeductionSchema`
  - `deductions` field from `AllocationPlan`
  - `deductionConstraints` from `PlanningProblem`
  - `validateDeductions()` function

- **Removed from planner.ts**: ~83 lines
  - `Deduction` import
  - D1-D6 building logic
  - `deductions` field from `allocationPlan`

**Total**: ~153 lines of deprecated code removed

---

## Benefits Summary

### Double-Counting Fix

**Before**:

```typescript
// Alice has 40 hours/week, skills [welding, electrical]
laborCapacity["welding"] += 40;
laborCapacity["electrical"] += 40;
// Total: 80 hours (WRONG!)
```

**After**:

```typescript
// Alice's capacity stored ONCE
person_capacities.set("alice", { total_hours: 40, skills: [...] });

// Skills reference the same capacity
skill_index.get("welding").add("alice");
skill_index.get("electrical").add("alice");

// Query welding: 40 hours (CORRECT!)
// Query electrical: 40 hours (CORRECT!)
// Query both: 40 hours (CORRECT!)
```

### Person Schema Unification

**Before**: 3 types

- `Contact` (matching.ts)
- `Individual` (stockbook.ts)
- `PersonWithAvailability` (labor.ts)

**After**: 1 type

- `Person` (person.ts) with conversion utilities

### Planner Integration

**Before**:

- Flat aggregation: 35 lines
- Lost person identity
- No space-time awareness

**After**:

- LaborIndex queries: 30 lines
- Person-level tracking
- Space-time ready
- Reusable helpers

---

## Next Steps

### Immediate

1. **Testing**: Add comprehensive tests for LaborIndex
2. **Validation**: Verify planner accuracy with multi-skilled persons

### Medium-Term

1. **Space-Time Filtering**: Implement location and time window queries
2. **Allocation Tracking**: Track which persons are allocated to which strategies
3. **Documentation**: Update PLAN.md to reflect new architecture

### Long-Term

1. **Skill-Aware Optimization**: Prefer multi-skilled persons for efficiency
2. **Space-Time Optimization**: Co-locate strategies, batch work for same persons
3. **Dynamic Capacity**: Handle changing availability, time-off, etc.

---

## Files Modified

### Core Architecture

- `src/lib/core/person.ts` (NEW): Unified Person schema
- `src/lib/core/labor.ts`: LaborIndex, PersonCapacity, query functions
- `src/lib/core/plan/aggregation.ts`: Updated with person tracking

### Planning

- `src/lib/core/plan/planner.ts`: Integrated with LaborIndex
- `src/lib/core/plan/stockbook.ts`: Removed deduction code

### Total Impact

- **Added**: ~350 lines (person.ts, LaborIndex, queries)
- **Modified**: ~100 lines (planner integration)
- **Removed**: ~153 lines (deduction system)
- **Net**: Cleaner, more maintainable architecture

---

## Key Principles

1. **Person-Level Tracking**: Always track capacity at the person level, never aggregate prematurely
2. **Reference, Don't Duplicate**: Skill indexes reference person capacities, they don't duplicate hours
3. **Space-Time Aware**: Design for location and time filtering from the start
4. **Unified Schema**: One `Person` type for all use cases
5. **Backward Compatible**: Provide conversion utilities for gradual migration

---

## Conclusion

The planning system now has a solid foundation for accurate, space-time-aware labor capacity planning. The unified `Person` schema and `LaborIndex` architecture eliminate double-counting bugs and provide a clean API for querying labor capacity by skill, location, and time.
