/**
 * VF Query Module — Standard queries from the VF specification.
 *
 * Implements all named queries from the VF "Query Naming" spec (inverses.md),
 * providing a unified facade over Observer, PlanStore, RecipeStore, and ProcessRegistry.
 *
 * @see https://valueflo.ws/specification/inverses/
 */

import type {
    EconomicEvent,
    EconomicResource,
    Process,
    Commitment,
    Intent,
    Claim,
    Agreement,
    AgreementBundle,
    Proposal,
    ProposalList,
    Plan,
    ResourceSpecification,
    ProcessSpecification,
    RecipeFlow,
    RecipeProcess,
    RecipeGroup,
    AgentRelationship,
    AgentRelationshipRole,
    Scenario,
    ScenarioDefinition,
    VfAction,
} from './schemas';
import type { Observer, ClaimState } from './observation/observer';
import type { PlanStore } from './planning/planning';
import type { RecipeStore } from './knowledge/recipes';
import type { ProcessRegistry } from './process-registry';
import type { AgentStore } from './agents';
import { trace, track } from './algorithms/track-trace';
import type { FlowNode } from './algorithms/track-trace';
import { criticalPath as cpAlgo } from './algorithms/critical-path';
import type { CriticalPathResult } from './algorithms/critical-path';
import { rollupStandardCost as rollupStd, rollupActualCost as rollupActual } from './algorithms/rollup';
import type { RollupResult, UnitConverter } from './algorithms/rollup';
import { distributeIncome as distIncome } from './algorithms/value-equations';
import type { ValueEquation, ValueEquationResult } from './algorithms/value-equations';
import { cashFlowReport } from './algorithms/resource-flows';
import type { CashFlowReport, PeriodGranularity } from './algorithms/resource-flows';
import { dependentDemand as depDemand } from './algorithms/dependent-demand';
import type { DependentDemandResult } from './algorithms/dependent-demand';

// =============================================================================
// VF QUERIES — Unified query interface
// =============================================================================

export class VfQueries {
    constructor(
        private readonly observer: Observer,
        private readonly planStore: PlanStore,
        private readonly recipes: RecipeStore,
        private readonly processes: ProcessRegistry,
        private readonly agents?: AgentStore,
    ) {}

    // =========================================================================
    // AGENT QUERIES (inverses.md §Agent)
    // =========================================================================

    /** All processes where agent is inScopeOf */
    agentProcesses(agentId: string): Process[] {
        return this.processes.all().filter(p =>
            p.inScopeOf?.includes(agentId),
        );
    }

    /** All resources where agent is primaryAccountable */
    inventoriedEconomicResources(agentId: string): EconomicResource[] {
        return this.observer.allResources().filter(r =>
            r.primaryAccountable === agentId,
        );
    }

    /** Commitments where agent is provider */
    commitmentsAsProvider(agentId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.provider === agentId,
        );
    }

    /** Commitments where agent is receiver */
    commitmentsAsReceiver(agentId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.receiver === agentId,
        );
    }

    /** Commitments where agent appears in inScopeOf (inverses.md §Agent commitmentsInScope) */
    commitmentsInScope(agentId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.inScopeOf?.includes(agentId),
        );
    }

    /** Events where agent is provider */
    economicEventsAsProvider(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e => e.provider === agentId);
    }

    /** Events where agent is receiver */
    economicEventsAsReceiver(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e => e.receiver === agentId);
    }

    /** Events where agent is in inScopeOf (inverses.md §Agent economicEventsInScope) */
    economicEventsInScope(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.inScopeOf?.includes(agentId),
        );
    }

    /** Intents where agent is provider */
    intentsAsProvider(agentId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.provider === agentId,
        );
    }

    /** Intents where agent is receiver */
    intentsAsReceiver(agentId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.receiver === agentId,
        );
    }

    /** Intents where agent appears in inScopeOf (inverses.md §Agent intentsInScope) */
    intentsInScope(agentId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.inScopeOf?.includes(agentId),
        );
    }

    /** All plans where agent has processes in scope */
    agentPlans(agentId: string): Plan[] {
        const planIds = new Set(
            this.agentProcesses(agentId)
                .map(p => p.plannedWithin)
                .filter(Boolean) as string[],
        );
        return this.planStore.allPlans().filter(p => planIds.has(p.id));
    }

    /** Proposals that are inScopeOf a given agent (inverses.md §Agent proposalsInScope) */
    proposalsInScope(agentId: string): Proposal[] {
        return this.planStore.allProposals().filter(p =>
            p.inScopeOf?.includes(agentId),
        );
    }

    /**
     * Proposals proposed TO a given agent (inverses.md §Agent proposalsTo).
     * A proposal is "to" an agent when Proposal.proposedTo contains the agentId.
     */
    proposalsTo(agentId: string): Proposal[] {
        return this.planStore.allProposals().filter(p =>
            p.proposedTo?.includes(agentId),
        );
    }

    /** Scenarios where agent is inScopeOf (inverses.md §Agent scenariosInScope) */
    scenariosInScope(agentId: string): Scenario[] {
        return this.planStore.allScenarios().filter(s =>
            s.inScopeOf === agentId,
        );
    }

    /**
     * AgentRelationships where agent is the subject (inverses.md §Agent relationshipsAsSubject).
     */
    relationshipsAsSubject(agentId: string): AgentRelationship[] {
        if (!this.agents) return [];
        return this.agents.allRelationships().filter(r => r.subject === agentId);
    }

    /**
     * AgentRelationships where agent is the object (inverses.md §Agent relationshipsAsObject).
     */
    relationshipsAsObject(agentId: string): AgentRelationship[] {
        if (!this.agents) return [];
        return this.agents.allRelationships().filter(r => r.object === agentId);
    }

    /**
     * All economic events where agent is provider, receiver, or inScopeOf.
     * (inverses.md §Agent economicEvents)
     */
    agentEconomicEvents(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.provider === agentId ||
            e.receiver === agentId ||
            e.inScopeOf?.includes(agentId),
        );
    }

    // =========================================================================
    // PROCESS QUERIES (inverses.md §Process)
    // =========================================================================

    /** All events input to or output of a process */
    processEvents(processId: string): EconomicEvent[] {
        return this.observer.eventsForProcess(processId);
    }

    /** All commitments for a process */
    processCommitments(processId: string): Commitment[] {
        return this.planStore.commitmentsForProcess(processId);
    }

    /** All intents for a process */
    processIntents(processId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.inputOf === processId || i.outputOf === processId,
        );
    }

    /** Events that don't fulfill any commitment (unplanned work) */
    unplannedEconomicEvents(processId: string): EconomicEvent[] {
        return this.observer.unplannedEvents(processId);
    }

    /** Unplanned input events only */
    unplannedInputs(processId: string): EconomicEvent[] {
        return this.observer.eventsForProcess(processId)
            .filter(e => e.inputOf === processId && !e.fulfills);
    }

    /** Unplanned output events only */
    unplannedOutputs(processId: string): EconomicEvent[] {
        return this.observer.eventsForProcess(processId)
            .filter(e => e.outputOf === processId && !e.fulfills);
    }

    /** All agents involved in a process (from events, commitments, intents, inScopeOf) */
    involvedAgents(processId: string): string[] {
        const agents = new Set<string>();
        const process = this.processes.get(processId);
        if (process?.inScopeOf) process.inScopeOf.forEach(a => agents.add(a));

        for (const e of this.observer.eventsForProcess(processId)) {
            agents.add(e.provider);
            agents.add(e.receiver);
        }
        for (const c of this.planStore.commitmentsForProcess(processId)) {
            if (c.provider) agents.add(c.provider);
            if (c.receiver) agents.add(c.receiver);
        }
        for (const i of this.processIntents(processId)) {
            if (i.provider) agents.add(i.provider);
            if (i.receiver) agents.add(i.receiver);
        }
        return [...agents];
    }

    /** Working agents: providers of work events in a process */
    workingAgents(processId: string): string[] {
        return [...new Set(
            this.observer.eventsForProcess(processId)
                .filter(e => e.inputOf === processId && e.action === 'work')
                .map(e => e.provider),
        )];
    }

    /**
     * Next processes from a given process.
     * A "next" process is one that consumes resources produced by this process.
     * (inverses.md §Process nextProcesses)
     */
    nextProcesses(processId: string): Process[] {
        // Get resourceInventoriedAs for all output events of this process
        const outputResourceIds = new Set(
            this.observer.eventsForProcess(processId)
                .filter(e => e.outputOf === processId && e.resourceInventoriedAs)
                .map(e => e.resourceInventoriedAs as string),
        );
        if (outputResourceIds.size === 0) return [];

        // Find processes with input events referencing those resources
        const result = new Set<string>();
        for (const e of this.observer.allEvents()) {
            if (e.inputOf && e.resourceInventoriedAs && outputResourceIds.has(e.resourceInventoriedAs)) {
                result.add(e.inputOf);
            }
        }
        return [...result]
            .map(id => this.processes.get(id))
            .filter((p): p is Process => p !== undefined);
    }

    /**
     * Previous processes of a given process.
     * A "previous" process is one that produces resources consumed by this process.
     * (inverses.md §Process previousProcesses)
     */
    previousProcesses(processId: string): Process[] {
        // Get resourceInventoriedAs for all input events of this process
        const inputResourceIds = new Set(
            this.observer.eventsForProcess(processId)
                .filter(e => e.inputOf === processId && e.resourceInventoriedAs)
                .map(e => e.resourceInventoriedAs as string),
        );
        if (inputResourceIds.size === 0) return [];

        // Find processes with output events that produced those resources
        const result = new Set<string>();
        for (const e of this.observer.allEvents()) {
            if (e.outputOf && e.resourceInventoriedAs && inputResourceIds.has(e.resourceInventoriedAs)) {
                result.add(e.outputOf);
            }
        }
        return [...result]
            .map(id => this.processes.get(id))
            .filter((p): p is Process => p !== undefined);
    }

    // =========================================================================
    // ECONOMIC EVENT QUERIES (inverses.md §EconomicEvent)
    // =========================================================================

    /** All other flows belonging to the same Agreement as this event. */
    reciprocalEvents(eventId: string): EconomicEvent[] {
        const event = this.observer.getEvent(eventId);
        if (!event?.realizationOf) return [];
        return this.observer.allEvents().filter(e =>
            e.id !== eventId &&
            e.realizationOf === event.realizationOf,
        );
    }

    /** Trace: ordered incoming value flows (backwards to origins) */
    traceEvent(eventOrResourceId: string): FlowNode[] {
        return trace(eventOrResourceId, this.observer, this.processes);
    }

    /** Track: ordered outgoing value flows (forwards to destinations) */
    trackEvent(eventOrResourceId: string): FlowNode[] {
        return track(eventOrResourceId, this.observer, this.processes);
    }

    // =========================================================================
    // ECONOMIC RESOURCE QUERIES (inverses.md §EconomicResource)
    // =========================================================================

    /** Resources contained in this resource (EconomicResource.containedIn inverse) */
    contains(resourceId: string): EconomicResource[] {
        return this.observer.allResources().filter(r => r.containedIn === resourceId);
    }

    /** Intents referencing this resource */
    resourceIntents(resourceId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.resourceInventoriedAs === resourceId,
        );
    }

    /** Commitments referencing this resource */
    resourceCommitments(resourceId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.resourceInventoriedAs === resourceId,
        );
    }

    /**
     * All economic events where this resource is the "from" resource.
     * Includes process events, raise/lower, provider-side of transfers.
     * (inverses.md §EconomicResource economicEventsInOutFrom)
     */
    economicEventsFrom(resourceId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.resourceInventoriedAs === resourceId,
        );
    }

    /**
     * All events where this resource is the "to" resource (receiver side of transfer/move).
     * (inverses.md §EconomicResource economicEventsTo)
     */
    economicEventsTo(resourceId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.toResourceInventoriedAs === resourceId,
        );
    }

    /**
     * All events relating to this resource (from or to).
     * (inverses.md §EconomicResource economicEvents)
     */
    resourceEconomicEvents(resourceId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.resourceInventoriedAs === resourceId ||
            e.toResourceInventoriedAs === resourceId,
        );
    }

    // =========================================================================
    // PROPOSAL QUERIES (inverses.md §Proposal)
    // =========================================================================

    /** All offer proposals */
    offers(): Proposal[] {
        return this.planStore.allProposals().filter(p => p.purpose === 'offer');
    }

    /** All request proposals */
    requests(): Proposal[] {
        return this.planStore.allProposals().filter(p => p.purpose === 'request');
    }

    /** Check if a proposal is an offer */
    isOffer(proposalId: string): boolean {
        const p = this.planStore.getProposal(proposalId);
        if (p?.purpose === 'offer') return true;
        // Also true if any publishes Intent has a provider (VF spec alternative check)
        if (p?.publishes?.length) {
            return p.publishes.some(intentId => {
                const intent = this.planStore.getIntent(intentId);
                return intent?.provider != null;
            });
        }
        return false;
    }

    /** Check if a proposal is a request */
    isRequest(proposalId: string): boolean {
        const p = this.planStore.getProposal(proposalId);
        if (p?.purpose === 'request') return true;
        // Also true if any reciprocal Intent has a receiver
        if (p?.reciprocal?.length) {
            return p.reciprocal.some(intentId => {
                const intent = this.planStore.getIntent(intentId);
                return intent?.receiver != null;
            });
        }
        return false;
    }

    // =========================================================================
    // INTENT QUERIES (inverses.md §Intent)
    // =========================================================================

    /** Events and commitments that satisfy an intent */
    intentSatisfiedBy(intentId: string): {
        events: EconomicEvent[];
        commitments: Commitment[];
    } {
        return {
            events: this.observer.satisfiedBy(intentId),
            commitments: Array.from(this.planStore.allCommitments())
                .filter(c => c.satisfies === intentId),
        };
    }

    // =========================================================================
    // AGREEMENT QUERIES (inverses.md §Agreement)
    // =========================================================================

    /** Unplanned events for an agreement (realizationOf, no commitment) */
    agreementUnplannedEvents(agreementId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.realizationOf === agreementId,
        );
    }

    /** All agents involved in an agreement (from commitments and events) */
    agreementInvolvedAgents(agreementId: string): string[] {
        const agents = new Set<string>();
        for (const c of this.planStore.commitmentsForAgreement(agreementId)) {
            if (c.provider) agents.add(c.provider);
            if (c.receiver) agents.add(c.receiver);
        }
        for (const e of this.agreementEvents(agreementId)) {
            agents.add(e.provider);
            agents.add(e.receiver);
        }
        return [...agents];
    }

    /**
     * All events for an agreement — both direct (realizationOf) and
     * indirect (fulfilling a commitment that is clauseOf the agreement).
     */
    agreementEvents(agreementId: string): EconomicEvent[] {
        const eventIds = new Set<string>();
        const events: EconomicEvent[] = [];

        // Direct: realizationOf
        for (const e of this.observer.allEvents()) {
            if (e.realizationOf === agreementId) {
                eventIds.add(e.id);
                events.push(e);
            }
        }

        // Indirect: fulfills a commitment that is clauseOf
        for (const c of this.planStore.commitmentsForAgreement(agreementId)) {
            for (const e of this.observer.fulfilledBy(c.id)) {
                if (!eventIds.has(e.id)) {
                    eventIds.add(e.id);
                    events.push(e);
                }
            }
        }

        return events;
    }

    // =========================================================================
    // COMMITMENT QUERIES (inverses.md §Commitment)
    // =========================================================================

    /** Events that fulfill a commitment */
    commitmentFulfilledBy(commitmentId: string): EconomicEvent[] {
        return this.observer.fulfilledBy(commitmentId);
    }

    /** Agents involved in a commitment */
    commitmentInvolvedAgents(commitmentId: string): string[] {
        const c = this.planStore.getCommitment(commitmentId);
        if (!c) return [];
        return [c.provider, c.receiver].filter((a): a is string => Boolean(a));
    }

    // =========================================================================
    // PLAN QUERIES (inverses.md §Plan)
    // =========================================================================

    /** All agents responsible for processes in a plan */
    planInvolvedAgents(planId: string): string[] {
        const agents = new Set<string>();
        for (const p of this.processes.forPlan(planId)) {
            for (const a of this.involvedAgents(p.id)) {
                agents.add(a);
            }
        }
        return [...agents];
    }

    /** Earliest process beginning in a plan */
    planStartDate(planId: string): string | undefined {
        const dates = this.processes.forPlan(planId)
            .map(p => p.hasBeginning)
            .filter(Boolean) as string[];
        return dates.sort()[0];
    }

    /** Latest process end in a plan */
    planEndDate(planId: string): string | undefined {
        const dates = this.processes.forPlan(planId)
            .map(p => p.hasEnd)
            .filter(Boolean) as string[];
        return dates.sort().pop();
    }

    /** Check if all processes in a plan are finished */
    planFinished(planId: string): boolean {
        const procs = this.processes.forPlan(planId);
        return procs.length > 0 && procs.every(p => p.finished);
    }

    /** All inScopeOf agents across the plan's processes (inverses.md §Plan inScopeOf) */
    planInScopeOf(planId: string): string[] {
        const agents = new Set<string>();
        for (const p of this.processes.forPlan(planId)) {
            if (p.inScopeOf) p.inScopeOf.forEach(a => agents.add(a));
        }
        return [...agents];
    }

    // =========================================================================
    // SCENARIO QUERIES (inverses.md §Scenario)
    // =========================================================================

    /**
     * Plans that refine a given scenario (Plan.refinementOf).
     * (inverses.md §Scenario plans)
     */
    scenarioPlans(scenarioId: string): Plan[] {
        return this.planStore.plansForScenario(scenarioId);
    }

    /**
     * Scenarios nested under a given scenario (Scenario.refinementOf).
     * (inverses.md §Scenario refinements)
     */
    scenarioRefinements(scenarioId: string): Scenario[] {
        return this.planStore.scenarioRefinements(scenarioId);
    }

    /**
     * Processes nested in a scenario (Process.nestedIn).
     * (inverses.md §Scenario processes)
     */
    scenarioProcesses(scenarioId: string): Process[] {
        return this.processes.all().filter(p => p.nestedIn === scenarioId);
    }

    /**
     * All scenarios associated with a ScenarioDefinition.
     * (inverses.md §ScenarioDefinition scenarios)
     */
    definitionScenarios(definitionId: string): Scenario[] {
        return this.planStore.scenariosForDefinition(definitionId);
    }

    // =========================================================================
    // RESOURCE SPECIFICATION QUERIES (inverses.md §ResourceSpecification)
    // =========================================================================

    /** Resources conforming to a spec */
    conformingResources(specId: string): EconomicResource[] {
        return this.observer.conformingResources(specId);
    }

    /** Events referencing a spec */
    conformingEconomicEvents(specId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.resourceConformsTo === specId,
        );
    }

    /** Commitments referencing a spec */
    conformingCommitments(specId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.resourceConformsTo === specId,
        );
    }

    /** Intents referencing a spec */
    conformingIntents(specId: string): Intent[] {
        return Array.from(this.planStore.allIntents()).filter(i =>
            i.resourceConformsTo === specId,
        );
    }

    /** Recipe flows referencing a spec */
    conformingRecipeFlows(specId: string): RecipeFlow[] {
        return this.recipes.allRecipes().flatMap(r => {
            const procs = this.recipes.processesForRecipe(r.id);
            return procs.flatMap(rp => {
                const { inputs, outputs } = this.recipes.flowsForProcess(rp.id);
                return [...inputs, ...outputs].filter(f =>
                    f.resourceConformsTo === specId,
                );
            });
        });
    }

    // =========================================================================
    // PROCESS SPECIFICATION QUERIES (inverses.md §ProcessSpecification)
    // =========================================================================

    /** Processes based on a spec */
    conformingProcesses(specId: string): Process[] {
        return this.processes.forSpec(specId);
    }

    /** Recipe processes conforming to a spec */
    conformingRecipeProcesses(specId: string): RecipeProcess[] {
        const results: RecipeProcess[] = [];
        for (const r of this.recipes.allRecipes()) {
            for (const rp of this.recipes.processesForRecipe(r.id)) {
                if (rp.processConformsTo === specId) results.push(rp);
            }
        }
        return results;
    }

    /** Commitments requiring a resource at a specific stage */
    commitmentsRequiringStage(stageSpecId: string): Commitment[] {
        return Array.from(this.planStore.allCommitments()).filter(c =>
            c.stage === stageSpecId,
        );
    }

    /** Resources currently at a specific stage */
    resourcesCurrentlyAtStage(stageSpecId: string): EconomicResource[] {
        return this.observer.allResources().filter(r =>
            r.stage === stageSpecId,
        );
    }

    /** Recipe flows requiring a resource at a specific stage */
    recipeFlowsRequiringStage(stageSpecId: string): RecipeFlow[] {
        return this.recipes.allRecipes().flatMap(r => {
            const procs = this.recipes.processesForRecipe(r.id);
            return procs.flatMap(rp => {
                const { inputs, outputs } = this.recipes.flowsForProcess(rp.id);
                return [...inputs, ...outputs].filter(f =>
                    f.stage === stageSpecId,
                );
            });
        });
    }

    // =========================================================================
    // AGREEMENT BUNDLE QUERIES (GAP-J)
    // =========================================================================

    /** All agreements in a bundle */
    bundleAgreements(bundleId: string): Agreement[] {
        return this.planStore.agreementsInBundle(bundleId);
    }

    // =========================================================================
    // CLAIM QUERIES (inverses.md §Claim)
    // =========================================================================

    /** All Claims where agentId is provider or receiver. */
    claimsForAgent(agentId: string): Claim[] {
        return this.planStore.claimsForAgent(agentId);
    }

    /** Claims where agent is the provider (obligated to settle). */
    claimsAsProvider(agentId: string): Claim[] {
        return this.planStore.allClaims().filter(c => c.provider === agentId);
    }

    /** Claims where agent is the receiver (entitled to settlement). */
    claimsAsReceiver(agentId: string): Claim[] {
        return this.planStore.allClaims().filter(c => c.receiver === agentId);
    }

    /**
     * Claims triggered by a specific EconomicEvent.
     * (inverses.md §EconomicEvent claimsTriggeredBy)
     */
    claimsTriggeredBy(eventId: string): Claim[] {
        return this.planStore.allClaims().filter(c => c.triggeredBy === eventId);
    }

    /**
     * Events that settle a given Claim.
     * (inverses.md §Claim settledBy)
     */
    settlementEvents(claimId: string): EconomicEvent[] {
        return this.observer.settledBy(claimId);
    }

    /** Current settlement state for a Claim (totals, finishing status). */
    claimState(claimId: string): ClaimState | undefined {
        return this.observer.getClaimState(claimId);
    }

    // =========================================================================
    // PROPOSAL LIST QUERIES (GAP-K)
    // =========================================================================

    /** All proposals in a ProposalList */
    listProposals(listId: string): Proposal[] {
        return this.planStore.proposalsInList(listId);
    }

    // =========================================================================
    // AGENT RELATIONSHIP QUERIES (GAP-B, inverses.md §AgentRelationshipRole)
    // =========================================================================

    /**
     * All AgentRelationships for a given role.
     * (inverses.md §AgentRelationshipRole agentRelationships)
     */
    relationshipsForRole(roleId: string): AgentRelationship[] {
        if (!this.agents) return [];
        return this.agents.allRelationships().filter(r => r.relationship === roleId);
    }

    /**
     * All relationships where a scope agent is specified.
     */
    relationshipsInScope(scopeAgentId: string): AgentRelationship[] {
        if (!this.agents) return [];
        return this.agents.allRelationships().filter(r => r.inScopeOf === scopeAgentId);
    }

    // =========================================================================
    // RECIPE GROUP QUERIES (GAP-D)
    // =========================================================================

    /** Get all recipes in a RecipeGroup */
    recipeGroupRecipes(groupId: string): import('./schemas').Recipe[] {
        return this.recipes.recipesForGroup(groupId);
    }

    // =========================================================================
    // ALGORITHMS — Critical Path, Rollup, Value Equations, Cash Flows, Demand
    // =========================================================================

    /**
     * Compute the critical path for a plan's processes.
     *
     * Returns process nodes with earliestStart/Finish, latestStart/Finish,
     * float, and whether each is on the critical path (float = 0).
     *
     * @see algorithms/critical-path.md
     */
    criticalPath(planId: string, defaultDurationMs?: number): CriticalPathResult {
        return cpAlgo(planId, this.planStore, this.processes, defaultDurationMs);
    }

    /**
     * Standard cost rollup — traverse a recipe and sum all input values.
     *
     * @param recipeId - The recipe to roll up
     * @param converter - Maps (quantity, unit) → value in common unit
     * @param commonUnit - Label for the result unit (e.g. 'USD', 'hours')
     * @param scaleFactor - Recipe output multiplier (default 1)
     * @see algorithms/rollup.md
     */
    rollupStandardCost(
        recipeId: string,
        converter: UnitConverter,
        commonUnit?: string,
        scaleFactor?: number,
    ): RollupResult {
        return rollupStd(recipeId, this.recipes, converter, commonUnit, scaleFactor);
    }

    /**
     * Actual cost rollup — trace backwards from a resource/event, sum all input events.
     *
     * @param startId - Resource ID or EconomicEvent ID to trace from
     * @param converter - Maps (quantity, unit) → value in common unit
     * @param commonUnit - Label for the result unit
     * @see algorithms/rollup.md
     */
    rollupActualCost(
        startId: string,
        converter: UnitConverter,
        commonUnit?: string,
    ): RollupResult {
        return rollupActual(startId, this.observer, this.processes, converter, commonUnit);
    }

    /**
     * Distribute income from an event to contributors using a value equation.
     *
     * Traces backwards from the income event, scores each contributing event
     * by the equation formula, and returns per-agent income shares.
     *
     * @param incomeEventId - Event that brought in income (transfer, deliverService…)
     * @param equation - How to score contributions (use built-in or define custom)
     * @see algorithms/equations.md
     */
    distributeIncome(
        incomeEventId: string,
        equation: ValueEquation,
    ): ValueEquationResult {
        return distIncome(incomeEventId, this.observer, this.processes, equation);
    }

    /**
     * Generate a cash flow report for an agent over a date range.
     *
     * Combines actual flows (from events) and forecasted flows
     * (from commitments/intents) on a period timeline.
     *
     * @see algorithms/cashflows.md
     */
    cashFlow(params: {
        agentId: string;
        reportStart: Date;
        reportEnd: Date;
        granularity?: PeriodGranularity;
        resourceSpecId?: string;
    }): CashFlowReport {
        return cashFlowReport({
            ...params,
            observer: this.observer,
            planStore: this.planStore,
        });
    }

    /**
     * Perform a full recursive dependent demand explosion into an existing plan.
     *
     * Checks inventory, nets against available stock, finds recipes for each
     * unsatisfied input, back-schedules sub-processes, and recurses down the
     * BOM tree until all demands are either satisfied or marked as purchase intents.
     *
     * @see algorithms/dependent-demand.md
     */
    dependentDemand(params: {
        planId: string;
        demandSpecId: string;
        demandQuantity: number;
        dueDate: Date;
        agents?: { provider?: string; receiver?: string };
    }): DependentDemandResult {
        return depDemand({
            ...params,
            recipeStore: this.recipes,
            planStore: this.planStore,
            processes: this.processes,
            observer: this.observer,
        });
    }
}
