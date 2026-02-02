# Integration Analysis: System 1 vs System 2

## System 1 (Current Visualization) - Data Flow Analysis

### Type Signatures

**Expression Type (src/types.ts):**
```typescript
export type Expression = {
  text: string                    // USED: core semantic content for matching
  priority?: number               // USED: influences matching weight (default 1)
  categoryChain?: string[]        // USED: hierarchical category matching
  disjointWith?: string[]         // USED: blocks matches on conflicts
}
```

**Constraints (src/types.ts):**
```typescript
export type TimeConstraint = {
  availableFrom?: string
  availableTo?: string
  dayOfWeek?: string
  timeOfDay?: string
  recurring?: string
  minDuration?: number            // minutes
}

export type SpaceConstraint = {
  location?: { lat: number; lng: number }
  area?: string
  maxRadius?: number              // km
  remote?: boolean
}

export type QuantityConstraint = {
  amount: number
  unit: string
  minAtomic?: number
}
```

### Constraint Implementation Status

| Constraint Field | Defined | Implemented | Status |
|---|---|---|---|
| time.availableFrom | Yes | No | Stub returns 1.0 |
| time.availableTo | Yes | No | Stub returns 1.0 |
| time.dayOfWeek | Yes | No | Never checked |
| time.timeOfDay | Yes | No | Never checked |
| time.recurring | Yes | No | Never checked |
| time.minDuration | Yes | No | Never checked |
| space.location (lat/lng) | Yes | No | Never checked |
| space.area | Yes | Yes | Simple string equality |
| space.maxRadius | Yes | No | Never checked |
| space.remote | Yes | Yes | Boolean flag check |
| quantity.amount | Yes | Yes | Feasibility ratio |
| quantity.unit | Yes | Yes | Exact match required |
| quantity.minAtomic | Yes | No | Never checked |

---

## System 2 (Friend's Additions) - Data Models and Entry Points

### Key Types

**Resource** - Unified model for both needs and capacity offers
- Core fields: `type_id`, `quantity`, `unit`, `description`, `emoji`
- Temporal: `time_zone`, `start_date`, `end_date`, `availability_window`, `recurrence`
- Spatial: `latitude`, `longitude`, `h3_index`, `search_radius_km`
- Constraints: `min_atomic_size`, `required_skills`, etc.

**Slot** - Container for filling needs/capacity
- Fields: `id`, `name`, `input`, `filled_by`

**Commons** - Multi-slot offering or need container

### Key Function: calculateFeasibility()

```typescript
calculateFeasibility(
  need: Resource,
  capacity: Resource,
  context?: FeasibilityContext
): FeasibilityStatus
```

**7 Scoring Dimensions** (each 0-1):
1. **time** - Binary overlap check with minimum atomic size enforcement
2. **location** - Distance decay (1.0 at 0km, 0.0 at max_radius)
3. **skills** - Level-aware bidirectional skill matching
4. **travel** - Feasibility given previous commitment
5. **resources** - Quantity partial fulfillment (offered/needed)
6. **affinity** - Social trust via global recognition weights
7. **continuity** - Penalizes time fragmentation

### Standalone Utility Functions

From **spatial.ts**:
- `haversineDistance(lat1, lng1, lat2, lng2)` - Great-circle distance (km)
- `computeH3Index(slot)` - Convert lat/lng to H3 cell
- `cellsCompatible(cell1, cell2, radius?)` - Check if within search radius

From **feasibility.ts**:
- `scoreTime(need, capacity)` - Returns 0-1
- `scoreLocation(need, capacity)` - Returns 0-1
- `scoreResources(need, capacity)` - Returns 0-1

### Minimal Input for calculateFeasibility()

```typescript
const minimalNeed = {
  type_id: 'childcare',
  quantity: 10,
};

const minimalCapacity = {
  type_id: 'childcare',
  quantity: 20,
};

const result = calculateFeasibility(minimalNeed, minimalCapacity);
// Returns: { type: 'possible', confidence: 1.0, scores: {...} }
```

---

## Integration Options

### Option A: Use System 2 utilities in System 1
- Import `haversineDistance` for real distance calculations
- Implement `computeSpaceFeasibility` using actual lat/lng + maxRadius
- Keep embedding-based semantic matching as primary signal

### Option B: Replace System 1 constraints with System 2 scoring
- Convert Need/Capacity to Resource format
- Use `calculateFeasibility()` for constraint scoring
- Keep embedding similarity as additional dimension

### Option C: Parallel systems with unified visualization
- Run both matchers
- Combine scores (semantic + feasibility)
- Show feasibility breakdown in UI

---

## Key Differences

| Aspect | System 1 | System 2 |
|--------|----------|---------|
| **Data Unit** | Need/Capacity (expressions) | Resource/Slot |
| **Matching** | Embedding similarity | Constraint satisfaction |
| **Time** | Stub (returns 1.0) | Full overlap calculation |
| **Space** | String equality | H3 geospatial + distance |
| **Output** | Single score | 7-dimension breakdown |
