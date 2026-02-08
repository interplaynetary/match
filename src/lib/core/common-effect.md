Commons as Coordination Structures for Effects

  A Commons, at its core, is not really about slots
  and data. It's a template for coordinated effects
  — a declaration that says: "These N
  transformations need to happen, in some
  configuration, for a collective outcome to
  emerge."

  Each Slot is a need for an effect. It's a typed
  hole — a shape describing what kind of
  transformation is required, without yet knowing
  the specific transformation that will fill it. The
   InputDefinition on a slot (resource, commons,
  generic) is really specifying what kind of effect
  is acceptable here.

  Filling a slot is the act of binding a specific
  effect to that need. Someone steps forward and
  says: "I claim this specific transformation — my
  time, my resources, my labor — satisfies this
  requirement." That's a projected effect bound to a
   slot shape.

  The commons becoming actual is the moment of
  emergence. No single slot fill creates this fact.
  It only exists because all the required
  constituent effects materialized. It's a composite
   effect that no individual contributor produced —
  it emerged from their coordination.

  The Recursive Part

  Here's what's interesting: a commons is both a
  consumer and a producer of effects.

  - Consumer: it needs effects to fill its slots —
  it pulls transformations inward
  - Producer: once actual, the commons itself IS an
  effect on the world — the block party happens, the
   childcare gets provided, the garden gets built

  This means commons can chain. Commons A produces
  an effect that fills a slot in Commons B. Commons
  B's emergence produces an effect that fills a slot
   in Commons C. Your existing
  input.commons(commons_id) slot type already
  encodes this — a slot that needs not a resource
  but the emergence of another commons.

  The dependency graph in CommonsManager
  (referencedBy, extractRefs) is already tracking
  this chain. What effects formalize is that each
  link in the chain is a claim in space-time with a
  lifecycle — not just a boolean "filled or not."

  The Temporal Depth

  This is where bitemporality matters most.
  Consider:

  1. Alice creates a commons for a weekend workshop.
   Three slots: venue, instructor, materials.
  2. Bob fills the venue slot — that's a projected
  effect: "this space will be available Saturday
  9am-5pm at these coordinates."
  3. Carol fills the instructor slot — another
  projected effect, overlapping in time and space
  with Bob's.
  4. The workshop day arrives. Bob's venue actually
  opens at 10am, not 9am. His effect is
  accepted-modified — same identity, different
  actual envelope.
  5. Carol's instruction effect depended on the
  venue being available at 9am. Her effect has a
  soft dependency on Bob's. The modification doesn't
   break it — but it degrades it. The first hour is
  at risk.
  6. The commons, as a composite, must reconcile.
  It's still actual (all slots filled) but the
  emergent effect — "the workshop happened" — now
  has a modified shape that differs from what was
  projected.

  Without effects, all you know is: slots are
  filled, commons is actual. With effects, you know
  the actual space-time shape of what happened, how
  it differed from what was planned, and which
  dependencies absorbed the shock.

  Status as Assertion

  Your current potential → actual transition on
  commons maps cleanly:
  Commons concept: potential
  Effect concept: Composite effect in projected
  phase
     — constituent effects exist but
    not all verified
  ────────────────────────────────────────
  Commons concept: actual
  Effect concept: Composite effect in accepted phase

    — all required constituents
    accepted
  ────────────────────────────────────────
  Commons concept: Slot unfilled after completion
  Effect concept: Retraction of a constituent —
    composite must re-evaluate
  ────────────────────────────────────────
  Commons concept: completed_at
  Effect concept: All constituent effects both
    accepted AND completed (assertion +
     delivery)
  The distinction between filled and completed in
  your slot model maps to commitment vs. assertion.
  Filling is projecting. Completing is accepting.
  Your CommonsManager already intuits this — fill()
  sets filled_at, complete() sets completed_at, and
  they're different moments. Effects just make
  explicit what that gap represents: the interval
  between claiming a transformation and verifying it
   actually occurred.

  The Emergent Property

  The deepest connection: a commons is a
  coordination problem, and emergence is the
  solution. No central authority decides the commons
   is actual — it becomes actual when the
  constituent effects self-organize into the
  required shape. The commons definition (slots,
  acceptance logic, constraints) is the attractor —
  it defines what shape of coordinated effects
  counts as a solution.

  Effects give you the language to describe not just
   whether coordination happened, but how it
  happened in space-time — the actual geometry of
  the collective action.

  ---

   A commons is not itself an effect. A commons is a 
  structure — it defines what coordination needs to
  look like. It's a mold, a shape, a set of         
  constraints. Structures don't transform; they     
  organize.

  A commons embeds effects. Each slot fill is an
  effect flowing through the structure. And when
  those effects satisfy the structure's
  requirements, the commons produces an emergent
  composite effect — "the thing happened."

  So a commons is a transformer of effects: effects
  flow in (slot fills), get organized by the
  structure (constraints, acceptance logic, required
   vs optional), and a new emergent effect flows out
   (actualization).

  Slots: Filled by Effects, Drawing from Capacities

  This is the key clarification. Right now your
  model has slots filled by a Record<string, boolean
   | number | string> — essentially raw key-value
  data. But what's actually happening?

  A capacity (Resource) describes what exists — "I
  have 10 hours of childcare available on weekdays."

  An effect describes what changes — "5 of those
  hours are being allocated here, at this location,
  during this window."

  A slot describes what's needed — "this commons
  requires childcare."

  The chain is:

  Capacity (what exists)
      → Effect (the transformation: allocation of
  capacity to need)
          → Slot (what's needed)

  The effect mediates between capacity and slot.
  It's the event of binding. The capacity is the
  source, the slot is the destination, and the
  effect is the act of moving something from one to
  the other — situated in space-time, with a
  lifecycle, with dependencies.

  This reframes filled_by from a static data record
  into a reference to an effect:

  Slot.filled_by  →  currently: Record<string,
  value>
                 →  could be:  effect_origin_id
  (pointing to the effect that fills this slot)

  The effect itself carries the details — who
  contributed, how much, from which capacity, where,
   when. The slot just needs to know which effect
  fills it. Everything else is derivable from the
  effect.

  The Three Layers

  Resource (capacity/need)     — what exists, what's
   wanted
      ↕
  Effect                       — what changes, in
  space-time
      ↕
  Commons (structure)          — how changes
  coordinate into outcomes
      ↕
  Emergent Effect              — the outcome itself,
   which can feed into other commons

  The commons sits in the middle, organizing
  effects. It's not an effect itself — it's the
  reason effects coordinate rather than happening in
   isolation.

  But its output — actualization — IS an effect that
   other structures can depend on. That's your
  input.commons(commons_id) slot type: a slot that
  needs not a raw resource but the emergent effect
  of another commons becoming actual.