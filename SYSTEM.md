# A Guide for Xorganizers

## What Is This?

This is a coordination system. It helps people organize collective activities — shared childcare, community tool libraries, neighborhood workshops, cooperative labor — by matching what people need with what people can contribute, and tracking whether things actually happen as planned.

It replaces the logic of buying and selling with the logic of coordinating directly. Nobody "sells" their time. People express what they can do, what they need, and the system helps them find each other and hold each other accountable.

---

## Three Layers

The system has three layers, each with a distinct role:

- **State** — what IS, what's WANTED, and what's CLAIMED (capacities, needs, and allocations)
- **Effects** — what CHANGED (transformations in space-time)
- **Commons** — how contributions are ORGANIZED (coordination structures)

These form a loop:

```
State (capacities / needs / allocations)
    ↑ derived from
Effects (transformations — things that happened)
    ↑ produced when allocations are fulfilled
Commons (coordination — slots, matching, allocation)
    ↑ conditional on
State ...
```

Commons read state, match capacities to needs, allocate capacity to slots, and when those allocations are fulfilled — when someone actually shows up and does the thing — effects are produced. Effects transform state. New state feeds back into the conditions that commons depend on.

---

## State: What IS, What's WANTED, What's CLAIMED

### Capacities

A **capacity** is the current state of an entity, derived from all the effects that have acted on it. "There are 20 drills at the downtown library" is the net result of every acquisition, donation, loan, breakage, and return. The number 20 is what you get when you fold all those effects together.

A capacity is not a separate thing from effects. It's an effect whose changes are `set` operations — asserting the full state rather than an incremental change. It functions as a checkpoint, so you don't have to replay every effect since the beginning of time to know what's true right now.

Each capacity has:

- **What it is**: a type, a quantity, a unit ("10 hours of childcare", "1 workshop space", "3 power drills")
- **Where it is**: a location, a radius, or "remote"
- **When it's available**: a schedule — anything from "every weekday 9-5" to "first Tuesday of February, 2-4pm"
- **What it requires**: skills, advance notice, minimum time blocks

Capacities aren't abstract. They exist somewhere, at some time, under some conditions.

Capacities exist in all temporal modes. A present capacity ("I have 20 drills now") is a snapshot of accepted effects. A future capacity can be either an **original assertion** ("Starting March 1st, I'll have a space available" — someone is accountable) or a **projection** ("At current rates, we'll have 12 drills by April" — the system extrapolated, nobody promised). The distinction matters: you can hold someone to an assertion, not to an extrapolation.

### Needs

A **need** is the same shape as a capacity — a type, quantity, location, schedule — but expressing what's wanted rather than what's available. A need is a predicate over state that isn't yet satisfied.

### Snapshots

State is derived from effects, but matching can't re-derive every entity's attributes from scratch on every query. A **snapshot** is a materialized view — derived state projected into the structured shape of a capacity or need (type, quantity, location, schedule, skills, etc.) at a point in time.

Matching operates on snapshots, not raw derived state. When Maria's effects fold into "10 hours of childcare, weekdays 9-5, at the daycare, skill: early childhood," that's a snapshot. When the childcare cooperative needs "8 hours of childcare, weekdays, within 2km," that's a need. Matching compares these structured projections across seven dimensions.

Snapshots are ephemeral — derived on demand, never the source of truth. The effect stream remains authoritative. But snapshots give matching a structured, multi-dimensional view to query against efficiently.

### Allocations

An **allocation** is a claim on capacity — "these 8 of Maria's 10 hours are pledged to the childcare cooperative." Nothing changed in the world. Maria still has 10 hours. What changed is the coordination bookkeeping: those hours are spoken for.

Allocation is state, not an effect. No transformation occurred — it's a coordination decision that partitions capacity. This matters because it prevents double-counting: if Maria allocates 8 hours to one commons, the matching system sees only her remaining 2 hours as available for others.

Allocation bridges capacities and commons. The matching system discovers that Maria's capacity could satisfy the childcare slot. Maria (or an organizer) decides to allocate. That allocation is state — it updates what's available. Later, when Maria actually provides childcare, *that* is an effect.

### Matching

Matching is **discovery** — finding capacities that could satisfy needs. The system matches across seven dimensions:

1. **Time** — Do their schedules overlap? For how long?
2. **Space** — Are they close enough? Or is it remote?
3. **Quantity** — Is there enough to meet the need?
4. **Skills** — Does the contributor have what's required?
5. **Travel** — Can they physically get there in time?
6. **Affinity** — Do they trust each other? Any exclusions?
7. **Continuity** — Is the time fragmented or solid blocks?

Each dimension produces a score from 0 to 1. Zero in any dimension means it's impossible. The system explains *why* — "time mismatch", "skill gap", "too far" — so people can adapt.

Matching also captures **desire**: just because something is feasible doesn't mean both parties want it. The system tracks mutual interest and surfaces four states:

| | Want it | Don't want it |
|---|---|---|
| **Feasible** | Valid match | Suggestion (system recommends) |
| **Not feasible** | Contradiction (want but can't) | Pruned (ignored) |

Matching is not allocation. Matching discovers possibilities. Allocation claims them.

---

## Effects: What CHANGED

An **effect** is a claim that something changed in the world, at a specific place and time. There's no fundamental difference between a human contribution and a natural event — both are transformations witnessed and asserted.

- "5 drills were added to the tool library on Tuesday at the community center"
- "Maria provided 3 hours of childcare on Friday morning at the daycare"
- "Temperature dropped below freezing last night across the neighborhood"

Every effect has what changed, where and when, who says so, and a lifecycle.

### The Lifecycle

Plans are not reality. Someone promises a venue. Did it actually open on time? The system tracks the gap between projection and actuality.

**Projected** — "We expect this to happen." A weather forecast predicts rain, a permit application was submitted. It's a plan, not yet reality.

**Pending** — The moment arrives. The effect must now be judged: did this actually happen?

**Accepted** — Yes, it happened as described. The 5 drills arrived. Maria did her 3 hours.

**Rejected** — No, it didn't happen. The drills never showed up. The venue fell through.

**Modified** — It happened, but differently. Maria came but only stayed 2 hours instead of 3. The venue opened at 10am instead of 9am. The effect keeps its identity — it's still "the same contribution" — but the details changed.

**Retracted** — We previously accepted this, but we've since learned it was wrong. Maybe the drills were counted twice. Maybe fraud. The original acceptance stays in the record (for audit), but a retraction is appended.

### All Effects Are Observational

There's no fundamental difference between "Maria provided childcare" and "the river flooded." Both are transformations witnessed and asserted. The system treats all effects the same — same lifecycle, same propagation, same accountability.

This matters because a commons doesn't just depend on human contributions. It depends on weather, permits, infrastructure, seasonal availability. A community garden commons needs rain just as much as it needs volunteers. The effects system handles both.

Allocation is not an effect — it's not a transformation of the world. When Maria pledges her time, nothing in the world changed. When Maria *shows up*, that's an effect. The allocation was state; the fulfillment is a transformation.

### State Predicates

Effects don't depend on other effects — they depend on **state**. The workshop doesn't care about the specific effect that made the venue available. It cares that the venue *is* available. If the original venue booking falls through but someone else provides one, nothing breaks.

Each effect can declare conditions on derived state:

- "The workshop" requires "venue availability >= 1 at this location during this time" and "instructor availability >= 1"
- "The harvest" requires "seeds planted >= minimum" and "rainfall >= adequate"

These conditions have two strengths:

- **Hard**: if this breaks, the effect is invalidated. The workshop can't happen without a venue.
- **Soft**: if this breaks, the effect is degraded but persists. Less rainfall means a smaller harvest, not no harvest.

When state changes (because an effect is accepted, retracted, or modified), the system re-derives the affected state and checks all effects watching it. Only transitions from satisfied to unsatisfied trigger alerts. Nothing silently breaks.

### Accountability Without Surveillance

The assertion log is append-only. Nothing is deleted or overwritten. If something was accepted and later found wrong, the retraction is visible alongside the original acceptance. This creates:

- **Audit trail**: you can always reconstruct what happened and when the system learned about it
- **Bitemporality**: "when did it happen in the world?" is a different question from "when did we record it?" Both are tracked.
- **Trust building**: over time, patterns emerge — who follows through, who doesn't, which projections tend to be accurate

This isn't surveillance. There are no scores or punishments. It's shared bookkeeping — the same thing cooperatives have always done, just with better tools.

---

## Commons: How Contributions Are ORGANIZED

A **commons** is a coordination structure — a process that organizes contributions. It doesn't "have" a capacity. When its allocations are fulfilled — when people actually do what they pledged — the resulting effects fold into state elsewhere.

The childcare cooperative coordinates caregiver contributions. When caregivers actually provide hours, those effects fold into state: "childcare availability = 20 hours/week at the daycare." That state is a capacity. The commons organized its production but doesn't own it.

### Slots

A commons is a template with **slots** — each slot is something the commons requires. Slots come in four kinds, each with a different satisfaction mechanism:

**Condition slots** are state predicates — conditions on derived state. "Venue availability >= 1", "temperature above freezing", "permit approved." They don't care *how* the condition is met, only that it holds. The venue slot checks derived state, not the effects that produced it.

- "Block Party" requires: venue availability >= 1, food quantity >= 50 servings, music hours >= 4
- "Tool Library" requires: storage space >= 1, tool count >= minimum
- "Community Garden" requires: rainfall >= adequate (a natural condition, not a human contribution)

**Need slots** carry a full resource query — "I need a sound engineer with mixing skills, available Saturday, within 5km." The matching system uses this query to discover capacities via snapshots. Once matched, an allocation binds a specific contributor. The slot is satisfied when the allocation is fulfilled (the contributor actually shows up) and the derived state meets the need.

A need is a multi-dimensional query: type, quantity, skills, location, schedule. It's more than a single predicate — it's the structured shape that matching operates on. Need slots can also carry additional condition predicates beyond the resource query ("need a venue AND it can't be raining").

**Composition slots** reference another commons. "The neighborhood festival needs the childcare cooperative to be running." The slot is satisfied when that commons is actual. The festival doesn't care how childcare gets organized — only that derived state says "childcare = actual." One collective activity enabling another.

**Data slots** collect human input — "What should we name the event?", "How many attendees?", "Indoor or outdoor?" These aren't derived from effects or matched against capacities. Someone provides a value (a string, a number, a choice from options) and the slot is satisfied. Not everything a commons needs comes from the world; some things come from decisions.

When all required slots are satisfied, the commons becomes **actual** — it's happening. Until then, it's **potential** — a plan waiting for enough contributions, conditions, decisions, and dependencies to come together.

### From Match to Allocation to Fulfillment

The journey from capacity to satisfied slot has three steps:

1. **Matching** discovers that Maria's capacity could satisfy the caregiver slot (discovery — state layer)
2. **Allocation** claims 8 of Maria's hours for this commons (coordination decision — state layer)
3. **Fulfillment** happens when Maria actually provides childcare (transformation — effects layer)

Matching is discovery. Allocation is a state partition. Fulfillment is a world-transformation — only fulfillment produces effects. There is no separate "delivery" record. When Maria actually provides childcare, that effect is accepted and folds into state. The slot's predicate re-evaluates against the new derived state. Coverage — how much of the slot's predicate is met — is derived, not recorded.

### Composition

A commons can depend on other commons. "The neighborhood festival" needs "the childcare cooperative" to be running so parents can attend. This is a composition slot — it references the childcare commons and is satisfied when that commons is actual. The festival doesn't care how childcare gets organized, only that it's happening. One collective activity enabling another.

---

## Metabolism: Is This Sustainable?

A commons can be active right now — all slots filled, everything running. But is it sustainable?

**Metabolism** measures the flow: how much of each resource is being produced versus consumed, and at what rate. Crucially, metabolism is not a single number — it varies across space and time. The drill borrowing rate at the downtown library on Monday morning is different from Saturday afternoon in the suburbs.

### Metabolism Is a Field, Not a Scalar

Every effect has a space-time envelope — it happens somewhere, during some time window. Metabolism at any point in space-time is the aggregate of all effects whose envelopes contain that point.

This means you can ask specific questions:

- "What's the flow of drills at the downtown library on weekday afternoons?" — query with a location and a time pattern
- "Is volunteer coverage sustainable on weekends?" — query with a temporal window
- "Which locations are depleting fastest?" — query across spatial cells

Different points in space-time see different metabolisms. The tool library is flush on Monday (when donations arrive) and depleted by Friday (after a week of borrowing). The downtown location runs a deficit while the suburbs accumulate. These patterns are invisible in a flat aggregate but critical for organizers.

### How It Works

When you query metabolism for a space-time region, the system:

1. **Filters spatially** — only effects whose locations overlap the query region count. An effect at the downtown library doesn't affect the suburb's metabolism. Spatial overlap is binary: either the effect is reachable from the query location or it isn't.

2. **Weights temporally** — effects get weighted by how much of their time falls within the query window. If Maria volunteers "weekdays 9-5" and you query for "weekday afternoons 12-5", only 5 of her 8 daily hours count — a temporal fraction of 5/8. Her contribution is weighted proportionally.

3. **Accumulates** — weighted production (adds) and consumption (subtracts) are summed across all matching effects.

4. **Computes rates** — totals are divided by the query window's duration to give rates *during the times you asked about*. "2 drills per hour during weekday afternoons" is a meaningful rate. "0.3 drills per hour averaged across all time" is not.

### What It Measures

- **Production**: what's flowing in (contributions, returns, natural growth) — weighted to the query region
- **Consumption**: what's flowing out (usage, wear, natural decay) — weighted to the query region
- **Net rate**: the balance during the queried period
- **Sustainability**: is production keeping up with consumption?
- **Time horizon**: if depleting, how long until it's empty at current rates?
- **Contributions**: which specific effects are producing and consuming, and by how much

### Metabolic Profiles

Rather than a single number, the system can produce a **profile** — metabolism sampled across time periods for a given location:

- **Day of week**: which days are rich, which are barren? Monday: +3 drills, Friday: -5 drills.
- **Time of day**: morning surplus, afternoon deficit? Or the reverse?
- **Month**: seasonal patterns. Summer abundant, winter strained.
- **Week of month**: first week busy, third week quiet.

This reveals the rhythm of a commons — the metabolic pattern that a single aggregate hides.

### Spatial Distribution

The system can also map metabolism across locations for a given time window. "During weekday afternoons, which library branches are depleting and which are accumulating?" This is a **metabolic field** — a spatial map of flows.

### Why It Matters

A commons might be actual right now — all slots filled, everything running. But if its attributes are being consumed faster than produced, it's on a trajectory toward failure. And that trajectory might only be visible at certain times or locations.

- The tool library looks fine in aggregate (+2 drills/week system-wide). But downtown is at -4/week and the suburbs are at +6/week. Downtown will fail in 5 weeks if nothing changes.
- The childcare co-op is sustainable on weekdays but critically short on weekends. A flat average masks this.
- The community garden produces plenty in summer but the winter months are pure consumption. The yearly aggregate is positive but December through February is a crisis.

Metabolism makes these patterns visible so organizers can intervene before things break — recruit weekend volunteers, redistribute tools between locations, plan for seasonal troughs.

---

## The Loop

```
State: capacities describe what's available, needs describe what's wanted
    ↓
Matching: discovers which capacities could satisfy which needs
    ↓
Allocation: claims capacity for a commons' slot (state partition, no world-change)
    ↓
Fulfillment: someone actually does the thing (effect — a transformation in space-time)
    ↓
Derivation: accepted effects fold into new state (capacities update)
    ↓
Metabolism: reveals whether flows are sustainable across space and time
    ↓
Predicates: state changes propagate to effects watching that state
    ↓
State ...
```

The system doesn't tell people what to do. It helps people see:
- What's needed and what's available (state)
- Where there are good matches (matching)
- What's been claimed and by whom (allocations)
- Whether people are following through (fulfillment vs allocation gap)
- Whether collective activities are sustainable (metabolism)
- Where and when intervention is needed before things break down (profiles, fields)

---

## Key Principles

**The commons is the process, not the product.** A commons organizes contributions. The product is always state — effects folded into a present-tense view.

**Allocation is state, fulfillment is effect.** Pledging your time changes the books, not the world. Showing up changes the world. Coverage — how much of a slot's need is met — is derived from the combination of allocations (what's claimed) and accepted effects (what actually happened).

**Plans are not reality.** Every projection must be verified. The system tracks the gap between what was planned and what happened, and adapts accordingly.

**Everything happens somewhere, somewhen.** Contributions aren't abstract. They have locations, schedules, durations. The system respects the material reality of coordination.

**State is derived, not stored.** The current state of any resource is computed from the history of effects, not read from a field. This means the system can always reconstruct, audit, and correct.

**Effects depend on state, not on other effects.** The workshop doesn't care which specific effect made the venue available. It cares that the venue is available. If the source changes but the state holds, nothing breaks.

**Sustainability over snapshots.** A healthy-looking moment means nothing if the flows don't balance. Metabolism makes trajectories visible — across space, across time.

**Accountability through transparency.** No scores, no punishments. Append-only records that everyone can see. Trust emerges from patterns, not enforcement.
