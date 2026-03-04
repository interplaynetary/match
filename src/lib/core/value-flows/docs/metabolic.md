WHILE system viable AND independent demands exist:

    // Step 0: Assess metabolic state
    metabolic_assessment = assess_metabolism()
    // Returns: SUSTAINABLE, DEGRADING, CRITICAL, or COLLAPSING

    time_horizon = determine_planning_horizon(metabolic_assessment)
    // Longer horizon when degrading, shorter when stable

    need = next_most_critical_need()

    // Step 1: Generate multiple time-phased plans
    plans = []

    for horizon in [IMMEDIATE, SHORT_TERM, MEDIUM_TERM, LONG_TERM]:
        plan = create_plan_with_horizon(
            need = need,
            horizon = horizon,
            constraints = {
                max_depletion_rate: f(horizon),
                min_regeneration_investment: g(horizon),
                transformation_allocation: h(horizon)
            }
        )
        plans.append(plan)

    // Step 2: Evaluate metabolic impact of each plan
    for plan in plans:
        plan.metabolic_score = calculate_metabolic_impact(plan, time_horizon)
        // Factors:
        // - Depletion rate of non-renewables
        // - Regeneration rate of renewables
        // - Waste generation and cycling
        // - Long-term productive capacity
        // - Adaptability/flexibility gained

    // Step 3: Choose plan based on metabolic state
    chosen_plan = select_plan_by_metabolic_state(plans, metabolic_assessment)

    // Metabolic state determines weighting:
    // SUSTAINABLE: Balance present needs with maintenance
    // DEGRADING: Favor regeneration over present consumption
    // CRITICAL: Invest heavily in transformation
    // COLLAPSING: Emergency protocols (preserve core capacity)

    // Step 4: Implement chosen plan
    if feasible(chosen_plan):
        commit(chosen_plan)
        update_metabolic_records(chosen_plan)
    else:
        // Scale down while preserving metabolic investment
        scaled_plan = scale_to_metabolic_minimums(chosen_plan)
        commit(scaled_plan)
        record_metabolic_deficit(need, chosen_plan - scaled_plan)

    // Step 5: Update metabolic projections
    project_future_metabolism()
    if projected_collapse_within(time_horizon):
        trigger_metabolic_transformation()

The Metabolic Feedback Loops
Your SNLT tracking becomes a metabolic sensor network:

Metabolic Indicators derived from SNLT:

1. Energy Return on Investment (EROI)
   SNLT_out / SNLT_in for each process
   Declining EROI indicates metabolic stress

2. Regeneration Rate
   Rate at which renewable stocks rebuild
   Compared to consumption rate

3. Depletion Acceleration
   Second derivative of non-renewable use
   Increasing acceleration signals crisis

4. Metabolic Diversity
   Number of viable paths to meet each need
   Declining diversity increases fragility

5. Transformation Capacity
   Resources allocated to experimentation
   Low transformation capacity = locked-in
