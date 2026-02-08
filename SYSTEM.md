# The Match System: A Guide for Organizers

## What Is This?

This is a coordination system. It helps people organize collective activities — shared childcare, community tool libraries, neighborhood workshops, cooperative labor — by matching what people need with what people can contribute, and tracking whether things actually happen as planned.

It replaces the logic of buying and selling with the logic of coordinating directly. Nobody "sells" their time. People express what they can do, what they need, and the system helps them find each other and hold each other accountable.

---

## The Core Concepts

### Resources: What Exists, What's Needed

A **resource** is anything that can be contributed or needed. Time, labor, tools, space, knowledge. Each resource has:

- **What it is**: a type, a quantity, a unit ("10 hours of childcare", "1 workshop space", "3 power drills")
- **Where it is**: a location, a radius, or "remote"
- **When it's available**: a schedule — anything from "every weekday 9-5" to "first Tuesday of February, 2-4pm"
- **What it requires**: skills, advance notice, minimum time blocks

Resources aren't abstract. They exist somewhere, at some time, under some conditions. The system respects that.

### Commons: Coordinating Together

A **commons** is a shared activity that needs multiple contributions to happen. Think of it as a template with slots:

- "Block Party" needs: a venue slot, a food slot, a music slot, a cleanup slot
- "Tool Library" needs: a storage space slot, tool donation slots, a librarian time slot
- "Childcare Cooperative" needs: caregiver time slots for each day of the week

Each **slot** describes what kind of contribution is needed. People fill slots by offering their resources. When all required slots are filled, the commons becomes **actual** — it's happening. Until then, it's **potential** — a plan waiting for enough participants.

A commons can also reference other commons. "The neighborhood festival" might need "the childcare cooperative" to be running (so parents can attend). This creates a chain of coordination — one collective activity enabling another.

### Matching: Finding the Right Fit

The system matches needs to capacities across seven dimensions:

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

---

## Effects: What Actually Happens

Here's the key insight: plans are not reality. Someone says they'll contribute 10 hours. Did they? Someone promises a venue. Did it actually open on time? The effects system tracks the gap between projection and actuality.

### What Is an Effect?

An effect is a **claim that something changed in the world, at a specific place and time**.

- "5 drills were added to the tool library on Tuesday at the community center"
- "Temperature dropped below freezing last night across the neighborhood"
- "Maria provided 3 hours of childcare on Friday morning at the daycare"
- "The building permit was approved on March 12th"

Every effect has:

- **What changed**: which entity, which attribute, by how much (a batch of changes, all-or-nothing)
- **Where and when**: the space-time envelope — coordinates, radius, time window
- **Who says so**: the witness — the person or system asserting this happened
- **A lifecycle**: projected → pending → accepted/rejected

### The Lifecycle

Effects flow through time:

**Projected** — "We expect this to happen." Someone committed to contributing, a weather forecast predicts rain, a permit application was submitted. It's a plan, not yet reality.

**Pending** — The moment arrives. The effect must now be judged: did this actually happen?

**Accepted** — Yes, it happened as described. The 5 drills arrived. Maria did her 3 hours.

**Rejected** — No, it didn't happen. The drills never showed up. The venue fell through.

**Modified** — It happened, but differently. Maria came but only stayed 2 hours instead of 3. The venue opened at 10am instead of 9am. The effect keeps its identity — it's still "the same contribution" — but the details changed.

**Retracted** — We previously accepted this, but we've since learned it was wrong. Maybe the drills were counted twice. Maybe fraud. The original acceptance stays in the record (for audit), but a retraction is appended. Everything that depended on this must now re-evaluate.

### No Allocation, Just Observation

There's no fundamental difference between "Maria allocated her time" and "the river flooded." Both are transformations witnessed and asserted. The system treats all effects the same — same lifecycle, same propagation, same accountability.

This matters because a commons doesn't just depend on human contributions. It depends on weather, permits, infrastructure, seasonal availability. A community garden commons needs rain just as much as it needs volunteers. The effects system handles both.

### Dependencies

Effects can depend on other effects:

- "The workshop" depends on "the venue being available" and "the instructor showing up"
- "The harvest" depends on "the seeds being planted" (months earlier) and "adequate rainfall"

Dependencies have two strengths:

- **Hard**: if this breaks, the dependent is invalidated. The workshop can't happen without a venue.
- **Soft**: if this breaks, the dependent is degraded but persists. Less rainfall means a smaller harvest, not no harvest.

When an effect is retracted or modified, the system traces all dependencies and flags what needs re-evaluation. Nothing silently breaks.

### Accountability Without Surveillance

The assertion log is append-only. Nothing is deleted or overwritten. If something was accepted and later found wrong, the retraction is visible alongside the original acceptance. This creates:

- **Audit trail**: you can always reconstruct what happened and when the system learned about it
- **Bitemporality**: "when did it happen in the world?" is a different question from "when did we record it?" Both are tracked.
- **Trust building**: over time, patterns emerge — who follows through, who doesn't, which projections tend to be accurate

This isn't surveillance. There are no scores or punishments. It's shared bookkeeping — the same thing cooperatives have always done, just with better tools.

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

1. **Filters spatially** — only effects whose locations overlap the query region count. An effect at the downtown library doesn't affect the suburb's metabolism. Spatial overlap is binary: either the effect is reachable from the query location or it isn't (drills are at the library, not spread across a radius).

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

A commons might be `actual` right now — all slots filled, everything running. But if its attributes are being consumed faster than produced, it's on a trajectory toward failure. And that trajectory might only be visible at certain times or locations.

- The tool library looks fine in aggregate (+2 drills/week system-wide). But downtown is at -4/week and the suburbs are at +6/week. Downtown will fail in 5 weeks if nothing changes.
- The childcare co-op is sustainable on weekdays but critically short on weekends. A flat average masks this.
- The community garden produces plenty in summer but the winter months are pure consumption. The yearly aggregate is positive but December through February is a crisis.

Metabolism makes these patterns visible so organizers can intervene before things break — recruit weekend volunteers, redistribute tools between locations, plan for seasonal troughs.

---

## How It All Fits Together

```
People express what they CAN do (capacities)
People express what they NEED (needs)
                    ↓
Matching finds feasible, desired connections
                    ↓
Commons organize these into coordinated activities
    (slots define what's needed, people fill them)
                    ↓
Effects track what actually happens in space-time
    (projected → judged → accepted or not)
                    ↓
Derivation computes current state from effects
    (not stored — always freshly computed)
                    ↓
Metabolism shows sustainability
    (production vs consumption, flow rates)
                    ↓
Dependencies propagate changes
    (if something breaks, everything that depends on it knows)
```

The system doesn't tell people what to do. It helps people see:
- What's needed and what's available
- Where there are good matches
- Whether commitments are being followed through
- Whether collective activities are sustainable
- Where intervention is needed before things break down

---

## Key Principles

**No outputs, only coordination.** Nobody produces a commodity. People coordinate activities directly. The "product" is the commons itself — the shared childcare, the tool library, the garden.

**Plans are not reality.** Every commitment is a projection that must be verified. The system tracks the gap between what was planned and what happened, and adapts accordingly.

**Everything happens somewhere, somewhen.** Contributions aren't abstract. They have locations, schedules, durations. The system respects the material reality of coordination.

**State is derived, not stored.** The current state of any resource is computed from the history of effects, not read from a field. This means the system can always reconstruct, audit, and correct.

**Sustainability over snapshots.** A healthy-looking moment means nothing if the flows don't balance. Metabolism makes trajectories visible.

**Accountability through transparency.** No scores, no punishments. Append-only records that everyone can see. Trust emerges from patterns, not enforcement.
