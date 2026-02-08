OK. Here's the honest answer: the current
  metabolize() is a flat aggregate. It sums all
  production, sums all consumption, divides by the
  time span between earliest and latest effect. It
  throws away the space-time structure entirely. It
  treats "3 drills borrowed Monday downtown" and "1
  drill returned Friday in the suburbs" as the same
  metabolic context. That's wrong.

  Metabolism is not a scalar. It's a field over
  space-time. Let me spell out what it actually
  needs to be.

  How Metabolism Actually Works

  Every effect has an envelope — a temporal window
  and a spatial region. The effect's delta doesn't
  just happen "in general." It happens within that
  envelope. A delta of subtract 3 on drills doesn't
  mean "3 drills disappeared from the universe." It
  means "3 drills left this location during this
  time window."

  So metabolism at any point in space-time is:

  "What is the aggregate of all effect deltas whose
  envelopes contain this point?"

  A point (lat, lng, time) is inside an effect's
  envelope if:
  - The time falls within the effect's temporal
  window (one-time range or recurring availability
  pattern)
  - The location falls within the effect's spatial
  region (within radius, within H3 cell, or the
  effect is remote/unbounded)

  Different points in space-time see different
  metabolisms. Monday morning at downtown sees
  different flows than Saturday afternoon in the
  suburbs. The tool library's metabolism at its
  physical location during open hours is completely
  different from its metabolism at 3am.

  The Three Temporal Shapes

  Effects have three temporal shapes, and each
  produces a different metabolic contribution:

  Instantaneous — valid_from set, no valid_until, no
   recurring window. "5 drills were donated on March
   12th." This is a one-time impulse. It produces at
   the moment it occurs, then nothing. It shifts the
   level permanently but contributes zero to the
  ongoing rate.

  Bounded — valid_from and valid_until set. "A
  generator is available May 1 through September
  30." This produces within the window and stops.
  Its rate contribution is the delta value spread
  across the duration. Outside the window, zero.

  Recurring — availability_window set. "Maria
  volunteers 3 hours every Monday 9-12." This is a
  periodic metabolic contribution. Every Monday
  9-12, at this location, there's a production flow
  of 3 hours. The rest of the week, zero from this
  effect.

  The current implementation collapses all three
  into a single span and divides. That loses the
  rhythm. A recurring effect with "3 hours every
  Monday" and another with "5 hours every Friday"
  have the same weekly total as "8 hours spread
  uniformly" — but the metabolic profile is
  completely different. Monday morning is rich,
  Tuesday is barren.

  Spatial Distribution

  Same logic for space. An effect with radius_km: 2
  centered on downtown contributes to metabolism at
  points within 2km of downtown. An effect with
  location_type: 'remote' contributes everywhere
  (it's spatially unbounded). An effect at suburb
  coordinates contributes to the suburb's
  metabolism.

  Two locations one block apart might have radically
   different metabolic profiles if different effects
   target them. The community garden and the tool
  library share a neighborhood but have completely
  independent metabolic flows.

  What a Real Metabolize Should Compute

  Instead of a single flat MetabolicFlow, metabolism
   should be queryable over a space-time region:

  "What is the metabolism of 'drills' for the
  downtown tool library
   during weekday afternoons in March?"

  That means:
  1. Collect all accepted effects targeting (entity:
   tool-library, attribute: drills)
  2. For each effect, check: does its envelope
  overlap with the query region (downtown + weekday
  afternoons + March)?
  3. For overlapping effects, compute how much of
  the delta falls within the query region
  4. Sum production, sum consumption, compute net
  5. Divide by the temporal duration of the query
  region to get rates

  Step 3 is the hard part. A recurring effect that
  says "every weekday 9-5" partially overlaps with a
   query for "weekday afternoons" — only the 12-5
  portion. An effect with a 5km radius partially
  overlaps with a 1km query region — you'd need to
  decide whether to treat this as full or
  proportional.

  The Metabolic Profile

  Rather than a single number, the useful output is
  a profile — metabolism sampled over time for a
  given spatial region:

  Tool Library — Drills — Downtown Location — March
  2026

  Mon  Tue  Wed  Thu  Fri  Sat  Sun
   +3   -1   +2   -2   +1   -5   +0   ← net per day

  Weekly net: -2
  Weekly production: +6 (donations, returns)
  Weekly consumption: -8 (borrowings)
  Weeks until exhaustion at current rate: 10

  And for spatial distribution:

  Drills — Weekday Average — March 2026

  Downtown:  net -2/week  (high traffic)
  Suburbs:   net +1/week  (more returns than
  borrows)
  Eastside:  net  0/week  (balanced)
  System-wide: net -1/week

  Metabolism of Non-Numeric Attributes

  Metabolism isn't just about quantities. Consider:

  - Skills: Effects can append skills to a person's
  profile (learned welding), or remove them
  (certification expired). The metabolic question:
  is this community gaining or losing certified
  welders?
  - Availability: Effects can shift time windows.
  The metabolic question: is total available
  volunteer time growing or shrinking?
  - Trust/Affinity: Effects can shift relationship
  scores. The metabolic question: is the social
  fabric of this commons strengthening or fraying?

  For non-numeric attributes, "rate" doesn't apply
  directly, but the pattern does — are append
  effects outpacing remove effects? Is the set
  growing or shrinking?

  Sustainability as a Space-Time Judgment

  "Is this commons sustainable?" is not a yes/no.
  It's a space-time question:

  - Sustainable where? — Downtown might be depleting
   while suburbs accumulate.
  - Sustainable when? — Summer might be sustainable
  (lots of volunteers) while winter isn't.
  - Sustainable at what resolution? — This week is
  fine. This month is fine. This year? The trend
  line says no.

  True sustainability assessment requires:
  1. The current net rate (first derivative — are we
   growing or shrinking?)
  2. The rate of change of the net rate (second
  derivative — is the depletion accelerating or
  slowing?)
  3. Seasonality — does the flow pattern repeat
  yearly? Are we in a predictable trough?
  4. Dependency health — are the effects we depend
  on themselves sustainable?

  What the Current Implementation Gets Right and
  Wrong

  Right: The basic framing — production,
  consumption, net, sustainability flag,
  time-to-exhaustion. These are the right questions.

  Wrong: It computes a single flat aggregate across
  all space and all time. It uses earliest-to-latest
   span as the rate denominator, which distorts
  horribly for sporadic effects. It doesn't account
  for recurring envelopes at all. It can't answer
  "what's the metabolism on Tuesdays?" or "what's
  the metabolism at this location?"

  The current implementation is a useful first
  approximation — "roughly how much is coming in and
   going out?" — but it's not spatiotemporally
  honest. Want me to rebuild it with proper
  space-time windowed queries?