ok so i wonder:

Independant demand level (with priority)
we derive: buffer we want for independant demand (when we solve plan this will auto-expand into lower)
attempt satisfying this level with a plan
from plan derive: replacement of used up resources (up to levels desired in future)
from plan derive: admin requirements for overall network up to this point
attempt satisfying additions
then attempt next highest priority (while substituting recipes and recipe-flows <entire networks of processes> with ones that better reduce SNLT and max-need-satisfaction) until full need-satisfaction

at each point if not possible, scale down on independent needs to satisfy? (the changes will ripple down right? across all those other categories)

## The Ripple Effect of Scaling Down

When you can't fully satisfy an independent need, you scale it down, and that **cascades through all derived categories**:

```
Original Plan (FULL need satisfaction):
────────────────────────────────────
Independent Need: 100 units food
    ├── Replacement: 100 units (to maintain stocks)
    ├── Buffers: 30 units (for uncertainty)
    └── Admin: 5 hours (coordination)
        ├── All inputs scale accordingly
        ├── Seeds: 20 units
        ├── Water: 1000 L
        ├── Land: 2 acres
        └── Labor: 200 hours

When you scale down to 80 units food:
────────────────────────────────────
Independent Need: 80 units food (20% reduction)
    ├── Replacement: 80 units (auto-reduces 20%)
    ├── Buffers: 24 units (auto-reduces 20%)
    └── Admin: 4 hours (approx reduction)
        ├── All inputs scale down
        ├── Seeds: 16 units
        ├── Water: 800 L
        ├── Land: 1.6 acres
        └── Labor: 160 hours

The entire tree resizes proportionally
```

## The Complete Loop Abstracted

```
WHILE independent_demands exist:

    // Start with most critical need at its desired level
    need = next_most_critical()
    target_level = need.desired_level

    // Attempt to plan at target level
    plan = create_plan(need, target_level)

    IF plan.feasible:
        // Plan automatically includes:
        // - Replacement (from plan's resource usage)
        // - Buffers (derived from volatility)
        // - Admin (from network coordination)
        commit(plan)

        // After commit, try to optimize
        IF system_mode == NORMAL:
            substitute_flows_to_minimize_SNLT(need)

    ELSE:
        // Scale down and retry
        scaled_level = find_max_feasible_level(need)
        plan = create_plan(need, scaled_level)
        commit(plan)

        // The scaling ripples through all categories:
        // - Less food → less replacement needed
        // - Less food → smaller buffers required
        // - Less food → less admin overhead
        // - All inputs reduce proportionally

        // Record the shortfall for learning
        record_unmet_demand(need, target_level - scaled_level)

    // Move to next most critical need
```

## Key Insight

The **derived demands** (replacement, buffers, admin) are not separate decisions—they're **mathematical functions** of the plan itself:

```
replacement = f(plan.resource_usage)
buffers = g(plan.volatility_profile, plan.lead_times)
admin = h(plan.network_complexity, plan.coordination_needs)
```

So when you scale the independent need, **everything else auto-scales** through these functions. The ripple is automatic and consistent.

REPLACE whole subgraphs
