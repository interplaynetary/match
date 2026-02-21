Here's the complete inventory of indexes and aggregations your system needs, organized by what they serve. I'm
thinking in terms of: firehose emits effects, and these are the materialized views you hydrate to make  
 everything queryable.

---

1. Effect Stream Indexes (already exist in effect-stream.ts)

These are your primary indexes — the raw firehose consumption layer:
Index: effects
Key → Value: origin_id → Effect[] (versions)
Purpose: Version history, latest lookup
────────────────────────────────────────
Index: byEntity
Key → Value: entity_id → Set<origin_id>
Purpose: "All effects touching this entity" — powers derive()
────────────────────────────────────────
Index: byPhase
Key → Value: AssertionPhase → Set<origin_id>
Purpose: Filter by lifecycle (accepted, projected, etc.)
────────────────────────────────────────
Index: stateWatchers
Key → Value: "entity_id:attribute" → Set<origin_id>
Purpose: Propagation: which effects care when this state changes
────────────────────────────────────────
Index: predicateSatisfaction
Key → Value: "effectId:entity:attr" → boolean
Purpose: Transition detection (satisfied → unsatisfied only)

---

2. Allocation Indexes (already exist in fulfillment.ts)

These track claims on capacity — coordination bookkeeping, not effects:
Index: commitments
Key → Value: commitment_id → Commitment
Purpose: Primary store
────────────────────────────────────────
Index: commitmentsBySlot
Key → Value: slot_id → Set<commitment_id>
Purpose: "Who's committed to this slot?"
────────────────────────────────────────
Index: commitmentsByOccurrence
Key → Value: "slot_id:date" → Set<commitment_id>
Purpose: Per-occurrence coverage (recurring slots)
────────────────────────────────────────
Index: commitmentsByContributor
Key → Value: contributor_id → Set<commitment_id>
Purpose: "What has this person committed to?" — needed for double-booking prevention
────────────────────────────────────────
Index: commitmentsByCapacity
Key → Value: capacity_id → Set<commitment_id>
Purpose: "How much of this capacity is spoken for?" — prevents double-counting

---

3. Derived State (computed on demand via derivation.ts, but should be materialized)

Currently derive() replays all effects every time. In an AppView you'd maintain:
┌──────────────────┬───────────────────────────────┬──────────────────────────────────────────────────────────┐
│ Materialized │ Shape │ Purpose │
│ View │ │ │
├──────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Entity Attribute │ "entity_id:attribute" → │ Current value of any entity attribute, invalidated on │
│ Cache │ DerivedValue │ effect acceptance/retraction │
├──────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Entity Snapshot │ entity_id → { attributes, │ The "Resource snapshot" that matching operates on │
│ │ metabolism } │ (SYSTEM.md: "matching operates on snapshots") │
└──────────────────┴───────────────────────────────┴──────────────────────────────────────────────────────────┘

---

4. Matching Indexes (needed but not yet materialized in your code)

These are the big ones for discovery. Currently slotsCompatible() does brute-force pair checking. An AppView
needs:

4a. Type Index
┌────────────────┬─────────────────────────┬──────────────────────────────────────────────────────────────────┐
│ Index │ Key → Value │ Purpose │
├────────────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Resources by │ type_id → │ First filter in matching — only compare same types. Eliminates │
│ type │ Set<resource_id> │ most pairs instantly. │
└────────────────┴─────────────────────────┴──────────────────────────────────────────────────────────────────┘
4b. Spatial Index
Index: Resources by H3 cell
Key → Value: h3_index → Set<resource_id>
Purpose: Spatial bucketing at default resolution (7). For radius queries, expand via gridDisk() and union the
buckets.
────────────────────────────────────────
Index: Remote resources
Key → Value: Set<resource_id>
Purpose: Special bucket — matches everything spatially.
4c. Temporal Index
┌───────────────────┬────────────────────────────────────┬────────────────────────────────────────────────────┐
│ Index │ Key → Value │ Purpose │
├───────────────────┼────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Resources by │ 'recurring' | 'onetime' → │ Split matching logic (recurring×recurring, │
│ recurrence track │ Set<resource_id> │ onetime×recurring, etc.) │
├───────────────────┼────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Resources by │ DayOfWeek → Set<resource_id> │ For recurring resources: which days are they │
│ day-of-week │ │ available? Pre-flattened to UTC. │
├───────────────────┼────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Resources by date │ Interval tree or sorted list of │ │
│ range │ [start_date, end_date, │ For one-time resources: fast overlap detection. │
│ │ resource_id] │ │
├───────────────────┼────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Space-time │ signature → { quantity, │ Already in groupSlotsBySpaceTime() — aggregates │
│ signature groups │ resource_ids } │ fungible resources by identical space-time │
│ │ │ pattern. │
└───────────────────┴────────────────────────────────────┴────────────────────────────────────────────────────┘
4d. Skills Index
┌───────────────────────────┬────────────────────────────┬────────────────────────────────────────────────────┐
│ Index │ Key → Value │ Purpose │
├───────────────────────────┼────────────────────────────┼────────────────────────────────────────────────────┤
│ Resources by required │ skill_id → │ "Which resources require this skill?" │
│ skill │ Set<resource_id> │ │
├───────────────────────────┼────────────────────────────┼────────────────────────────────────────────────────┤
│ Contacts by skill │ skill_id → Set<contact_id> │ "Who has this skill?" — needed for │
│ │ │ skillsCompatible() │
└───────────────────────────┴────────────────────────────┴────────────────────────────────────────────────────┘
4e. Filter/Eligibility Index
Index: Resources with filter rules
Key → Value: Set<resource_id>
Purpose: Know which resources need eligibility evaluation (json-logic)

---

5. Commons Indexes (needed for slot satisfaction & composition)
   ┌──────────────────┬────────────────────────────────┬─────────────────────────────────────────────────────────┐
   │ Index │ Key → Value │ Purpose │
   ├──────────────────┼────────────────────────────────┼─────────────────────────────────────────────────────────┤
   │ Commons registry │ commons_id → Commons │ Already in CommonsManager.registry │
   ├──────────────────┼────────────────────────────────┼─────────────────────────────────────────────────────────┤
   │ Commons by │ 'actual' | 'potential' → │ Materialized view of deriveCommons() — needed for │
   │ actuality │ Set<commons_id> │ composition slots ("is childcare co-op running?") │
   ├──────────────────┼────────────────────────────────┼─────────────────────────────────────────────────────────┤
   │ Slots by kind │ slot_kind → Set<{commons_id, │ Fast lookup: "all need slots", "all condition slots", │
   │ │ slot_id}> │ etc. │
   ├──────────────────┼────────────────────────────────┼─────────────────────────────────────────────────────────┤
   │ Composition │ commons_id → │ Reverse graph: "if childcare becomes actual, which │
   │ dependencies │ Set<dependent_commons_id> │ commons care?" — powers composition slot propagation │
   ├──────────────────┼────────────────────────────────┼─────────────────────────────────────────────────────────┤
   │ Slot predicates │ entity_id → Set<{commons_id, │ "When entity X's state changes, which slots need │
   │ by entity │ slot_id}> │ re-evaluation?" — analogous to stateWatchers but for │
   │ │ │ slots │
   └──────────────────┴────────────────────────────────┴─────────────────────────────────────────────────────────┘

---

6. Metabolism Aggregations (computed via derivation.ts, should be incrementally maintained)

These are the flow-rate views — SYSTEM.md's "field over space-time":
┌────────────────────────┬──────────────────────────────────────────────┬─────────────────────────────────────┐
│ Aggregation │ Shape │ Purpose │
├────────────────────────┼──────────────────────────────────────────────┼─────────────────────────────────────┤
│ Metabolic flow per │ "entity:attr" → MetabolicFlow │ Flat aggregate: production, │
│ entity×attribute │ │ consumption, net, sustainable? │
├────────────────────────┼──────────────────────────────────────────────┼─────────────────────────────────────┤
│ Metabolic profile │ "entity:attr" → { day_of_week → flow, │ Rhythmic patterns: "Monday surplus, │
│ │ time_of_day → flow, month → flow } │ Friday deficit" │
├────────────────────────┼──────────────────────────────────────────────┼─────────────────────────────────────┤
│ Metabolic field │ "entity:attr:temporal_window" → { h3_cell → │ Spatial map: "downtown depleting, │
│ │ flow } │ suburbs accumulating" │
├────────────────────────┼──────────────────────────────────────────────┼─────────────────────────────────────┤
│ │ Set<{entity_id, attribute, │ Pre-computed from negative net │
│ Sustainability alerts │ hours_until_exhaustion}> │ rates — the "intervene before it │
│ │ │ breaks" view │
└────────────────────────┴──────────────────────────────────────────────┴─────────────────────────────────────┘

---

7. Trust / Affinity Indexes (referenced in matching dimensions but not yet implemented)

From commons.ts (AffinityScore, AcceptanceLogic) and SYSTEM.md:
Index: Mutual recognition
Key → Value: "actor_a:actor_b" → score
Purpose: Bidirectional trust — used by AffinityScore and filter rules
────────────────────────────────────────
Index: Follow-through rate
Key → Value: contributor_id → { projected, accepted, rejected }
Purpose: "Patterns emerge — who follows through" (SYSTEM.md accountability)
────────────────────────────────────────
Index: Exclusion pairs
Key → Value: Set<"actor_a:actor_b">
Purpose: Block relationships — EXCLUSION_RULE in BlockReason

---

8. Semantic / Category Indexes (referenced in SemanticScore, CategoryMatch)
   Index: Embedding vectors
   Key → Value: resource_id → float[]
   Purpose: For cosine similarity in SemanticScore.similarity
   ────────────────────────────────────────
   Index: Category taxonomy
   Key → Value: Tree of type_id → parent
   Purpose: For CategoryMatch.distance and disjoint checks (vegan ⊥ meat)
   ────────────────────────────────────────
   Index: ANN index
   Key → Value: HNSW or similar over embeddings
   Purpose: Approximate nearest-neighbor for semantic discovery at scale

---

Summary: The AppView Hydration Pipeline

Firehose (Effects)
│
├─→ Effect Store + byEntity + byPhase + stateWatchers
│
├─→ Derived State Cache (entity:attr → value)
│ └─→ invalidated by effect acceptance/retraction
│
├─→ Snapshots (entity → structured Resource shape)
│ └─→ what matching actually queries against
│
├─→ Matching Indexes
│ ├── by type_id
│ ├── by H3 cell (spatial)
│ ├── by day-of-week / date-range (temporal)
│ ├── by skill
│ ├── by space-time signature (grouping)
│ └── by embedding (semantic ANN)
│
├─→ Allocation State
│ ├── by slot, occurrence, contributor, capacity
│ └── coverage aggregations
│
├─→ Commons State
│ ├── actuality (all required slots satisfied?)
│ ├── composition graph (who depends on whom?)
│ └── slot→entity watcher reverse index
│
├─→ Metabolism Views
│ ├── flat flows per entity:attr
│ ├── temporal profiles (rhythms)
│ ├── spatial fields (maps)
│ └── sustainability alerts
│
└─→ Social Graph
├── mutual recognition scores
├── follow-through rates
└── exclusion pairs

The key insight: your current code computes most of this on demand (derive replays effects, matching does
pairwise checks). An AppView would pre-materialize all of these and keep them incrementally updated as effects
flow through the stream. The stateWatchers + propagate() mechanism in effect-stream.ts is already the
invalidation backbone — it just needs to trigger index updates rather than only predicate re-evaluation.
