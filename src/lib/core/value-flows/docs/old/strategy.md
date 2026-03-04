WHILE (system viable AND independent demand not satisfied):

    // STEP 0: Check system state and adjust mode
    system_mode = assess_system_viability()
    // Returns: NORMAL, STRESSED, CRITICAL, or COLLAPSE_IMMINENT

    current_need = next_most_critical_need(level 1)

    // STEP 1: Calculate minimum requirements for each category
    min_requirements = {
        needs: calculate_minimum_to_prevent_death(current_need),
        reproduction: calculate_minimum_to_maintain_system(),
        buffers: calculate_minimum_for_known_risks(),
        admin: calculate_minimum_for_coordination()
    }

    // STEP 2: Check if we can meet all minimums
    available = get_available_resources_for(current_need)

    if can_meet_all_minimums(available, min_requirements):
        // NORMAL MODE: Satisfy all categories
        solution = solve_with_constraints(
            need = current_need,
            must_include = min_requirements,
            optimize_for = MIN_SNLT
        )

    else:
        // RESOURCE CONSTRAINT MODE: Can't meet all minimums
        switch(system_mode):

            case COLLAPSE_IMMINENT:
                // META-PRIORITY: System survival trumps everything
                // Example: seed corn scenario
                solution = solve_for_system_survival(current_need)
                // This may mean deferring current needs

            case CRITICAL:
                // BALANCE MODE: Allocate to prevent worst outcomes
                // Example: medicine scenario
                solution = solve_with_triage(
                    need = current_need,
                    requirements = min_requirements,
                    protocol = PREVENT_IMMEDIATE_DEATH_FIRST
                )

            case STRESSED:
                // PARALLEL MODE: Do multiple things with constrained resources
                // Example: post-disaster shelter scenario
                solution = solve_with_parallel_allocation(
                    need = current_need,
                    requirements = min_requirements,
                    strategy = "some of each, prioritize most time-sensitive"
                )

    // STEP 3: Implement solution
    if solution.found:
        commit_resources(solution)
        update_system_state(solution)

        // STEP 4: SNLT optimization (but only if system stable)
        if system_mode == NORMAL:
            optimize_for_min_SNLT(current_need)

    else:
        // STEP 5: Structured failure with context
        emit_signal({
            demand: current_need,
            reason: solution.failure_reason,
            system_mode: system_mode,
            constraints: min_requirements,
            available: available,
            suggestions: generate_next_actions(system_mode, solution.failure_reason)
        })

    // STEP 6: Update system viability for next iteration
    system_viability = reassess_system_state()
    if not system_viable:
        trigger_emergency_protocol()
        // Could be: external aid, radical transformation, graceful degrowth

    REPEAT UNTIL all independent demands satisfied OR system_non_viable

---

MAIN LOOP: Satisfy most critical need: FOOD (Level 1)

====================================================================
LEVEL 1 CALL: solve_with_recursive_priority(FOOD, current_priority=1)
====================================================================

STEP 1A: Solve FOOD directly (Priority 1 context)
→ No direct supply found
→ Recipe found: GROW_FOOD (needs seeds, water, land, labor)

    ================================================================
    RECURSIVE CALL 1: solve_with_recursive_priority(SEEDS, current_priority=1)
    ================================================================
    // We're still in Priority 1 context because SEEDS is needed for FOOD

    STEP 1A: Solve SEEDS directly
    → No direct supply
    → Recipe: SAVE_SEEDS_FROM_LAST_HARVEST (needs: harvested grain, storage, labor)

        ================================================================
        RECURSIVE CALL 1.1: solve_with_recursive_priority(HARVESTED_GRAIN, current_priority=1)
        ================================================================
        // Still Priority 1 - this grain is needed for seeds needed for food

        STEP 1A: Solve HARVESTED_GRAIN directly
        → No supply (it's last season, we consumed it all)
        → No recipe (can't create harvested grain without growing)
        → No substitute
        → FAIL with reason: NO_SUPPLY_IN_SCOPE (we ate all the grain)
        ================================================================
        RETURN FAILURE for HARVESTED_GRAIN
        ================================================================

    // SEEDS can't be solved because HARVESTED_GRAIN failed
    // But wait! We might have another way to get seeds...

    STEP 1B: Try substitute for SEEDS
    → Substitute found: SEEDS can be replaced by STARTING_CUTTINGS (for some plants)

        ================================================================
        RECURSIVE CALL 1.2: solve_with_recursive_priority(STARTING_CUTTINGS, current_priority=1)
        ================================================================
        // Still Priority 1

        STEP 1A: Solve STARTING_CUTTINGS directly
        → Found supply! Neighboring farm has cuttings
        → Route and commit

        // STEP 2: Now handle replacement for STARTING_CUTTINGS (Priority 2)
        replacement = calculate_replacement(STARTING_CUTTINGS)
        // We took cuttings, need to let plants regrow

            ================================================================
            RECURSIVE CALL 1.2.1: solve_with_recursive_priority(REPLACEMENT_CUTTINGS, current_priority=2)
            ================================================================
            // Now at Priority 2

            STEP 2A: Solve REPLACEMENT_CUTTINGS directly
            → Will happen naturally over time (plants regrow)
            → Just need to protect the mother plants

            STEP 2B: Handle buffers for REPLACEMENT_CUTTINGS (Priority 3)
            buffer = calculate_buffer(REPLACEMENT_CUTTINGS)

                ================================================================
                RECURSIVE CALL 1.2.1.1: solve_with_recursive_priority(BUFFER_CUTTINGS, current_priority=3)
                ================================================================
                // Priority 3
                → Maintain extra mother plants
                → Space them out (diversification)
                ================================================================

            STEP 2C: Handle admin for REPLACEMENT_CUTTINGS (Priority 4)

                ================================================================
                RECURSIVE CALL 1.2.1.2: solve_with_recursive_priority(ADMIN_CUTTINGS, current_priority=4)
                ================================================================
                // Priority 4
                → Record which cuttings went where
                → Track regrowth rates for SNLT
                ================================================================
            ================================================================

        // STEP 3: Handle buffers for STARTING_CUTTINGS (Priority 3)
        buffer = calculate_buffer(STARTING_CUTTINGS)

            ================================================================
            RECURSIVE CALL 1.2.2: solve_with_recursive_priority(BUFFER_CUTTINGS, current_priority=3)
            ================================================================
            // Priority 3
            → Maintain relationship with multiple farms
            → Keep some cuttings in reserve
            ================================================================

        // STEP 4: Handle admin for STARTING_CUTTINGS (Priority 4)

            ================================================================
            RECURSIVE CALL 1.2.3: solve_with_recursive_priority(ADMIN_CUTTINGS, current_priority=4)
            ================================================================
            // Priority 4
            → Track which farm provided cuttings
            → Record success rates for SNLT
            ================================================================

        RETURN SUCCESS for STARTING_CUTTINGS
        ================================================================

    // Back to SEEDS level - we have a solution via substitute
    RETURN SUCCESS for SEEDS (via STARTING_CUTTINGS)
    ================================================================

    ================================================================
    RECURSIVE CALL 2: solve_with_recursive_priority(WATER, current_priority=1)
    ================================================================
    // Still Priority 1 - water needed for FOOD

    STEP 1A: Solve WATER directly
    → Found: rainwater harvesting system
    → Route and commit

    // STEP 2: Handle replacement for WATER (Priority 2)
    replacement = maintain rainwater system

        ================================================================
        RECURSIVE CALL 2.1: solve_with_recursive_priority(MAINTENANCE, current_priority=2)
        ================================================================
        // Priority 2
        → Clean gutters, repair tanks
        → Schedule regular maintenance
        ================================================================

    // STEP 3: Handle buffers for WATER (Priority 3)
    buffer = additional storage for dry periods

        ================================================================
        RECURSIVE CALL 2.2: solve_with_recursive_priority(EXTRA_STORAGE, current_priority=3)
        ================================================================
        // Priority 3
        → Build additional water tanks
        → Diversify water sources (well as backup)
        ================================================================

    // STEP 4: Handle admin for WATER (Priority 4)

        ================================================================
        RECURSIVE CALL 2.3: solve_with_recursive_priority(WATER_RIGHTS, current_priority=4)
        ================================================================
        // Priority 4
        → Record water usage
        → Track rainfall patterns for SNLT
        ================================================================

    RETURN SUCCESS for WATER
    ================================================================

    ================================================================
    RECURSIVE CALL 3: solve_with_recursive_priority(LAND, current_priority=1)
    ================================================================
    // Priority 1 - land needed for FOOD

    STEP 1A: Solve LAND directly
    → Found: community garden plots available
    → Route and commit

    // STEP 2: Handle replacement for LAND (Priority 2)
    replacement = soil fertility maintenance

        ================================================================
        RECURSIVE CALL 3.1: solve_with_recursive_priority(COMPOST, current_priority=2)
        ================================================================
        // Priority 2
        → Create compost from food waste
        → Rotate crops
        ================================================================

    // STEP 3: Handle buffers for LAND (Priority 3)
    buffer = fallow fields for future

        ================================================================
        RECURSIVE CALL 3.2: solve_with_recursive_priority(FALLOW_LAND, current_priority=3)
        ================================================================
        // Priority 3
        → Keep some land unplanted for future expansion
        → Maintain as emergency reserve
        ================================================================

    // STEP 4: Handle admin for LAND (Priority 4)

        ================================================================
        RECURSIVE CALL 3.3: solve_with_recursive_priority(LAND_RIGHTS, current_priority=4)
        ================================================================
        // Priority 4
        → Track plot assignments
        → Record yields per plot for SNLT
        ================================================================

    RETURN SUCCESS for LAND
    ================================================================

    ================================================================
    RECURSIVE CALL 4: solve_with_recursive_priority(LABOR, current_priority=1)
    ================================================================
    // Priority 1 - labor needed for FOOD

    STEP 1A: Solve LABOR directly
    → Found: available community members
    → Route and commit (assign people to work)

    // STEP 2: Handle replacement for LABOR (Priority 2)
    replacement = rest and recovery

        ================================================================
        RECURSIVE CALL 4.1: solve_with_recursive_priority(REST, current_priority=2)
        ================================================================
        // Priority 2
        → Ensure workers have time off
        → Rotate tasks to prevent burnout
        ================================================================

    // STEP 3: Handle buffers for LABOR (Priority 3)
    buffer = additional workers for peak seasons

        ================================================================
        RECURSIVE CALL 4.2: solve_with_recursive_priority(RESERVE_LABOR, current_priority=3)
        ================================================================
        // Priority 3
        → Train extra people
        → Maintain relationships with neighboring communities for mutual aid
        ================================================================

    // STEP 4: Handle admin for LABOR (Priority 4)

        ================================================================
        RECURSIVE CALL 4.3: solve_with_recursive_priority(LABOR_COORD, current_priority=4)
        ================================================================
        // Priority 4
        → Track who worked where
        → Record hours for SNLT
        ================================================================

    RETURN SUCCESS for LABOR
    ================================================================

// All inputs to GROW_FOOD are satisfied
Schedule FOOD production
RECORD PRODUCTION for SNLT

// STEP 2: Now handle replacement for FOOD (Priority 2)
replacement = calculate_replacement(FOOD)
// The food we'll eat needs to be replaced for next season

====================================================================
RECURSIVE CALL 5: solve_with_recursive_priority(REPLACEMENT_FOOD, current_priority=2)
====================================================================
// Now at Priority 2 - replacement for the original Level 1 need

This will recursively solve for next season's food,
with its own seeds, water, land, labor needs,
but now operating at Priority 2 context throughout.

The recursion depth continues, but priority level stays at 2
for the entire replacement sub-tree.
====================================================================

// STEP 3: Handle buffers for FOOD (Priority 3)
buffer = calculate_buffer(FOOD)

====================================================================
RECURSIVE CALL 6: solve_with_recursive_priority(BUFFER_FOOD, current_priority=3)
====================================================================
// Priority 3 context throughout this entire sub-tree
====================================================================

// STEP 4: Handle admin for FOOD (Priority 4)
admin = calculate_admin(FOOD)

====================================================================
RECURSIVE CALL 7: solve_with_recursive_priority(ADMIN_FOOD, current_priority=4)
====================================================================
// Priority 4 context throughout
====================================================================

# RETURN SUCCESS for FOOD
