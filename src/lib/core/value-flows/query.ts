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
    Agreement,
    Proposal,
    Plan,
    ResourceSpecification,
    ProcessSpecification,
    RecipeFlow,
    RecipeProcess,
    VfAction,
} from './schemas';
import type { Observer } from './observation/observer';
import type { PlanStore } from './planning/planning';
import type { RecipeStore } from './knowledge/recipes';
import type { ProcessRegistry } from './process-registry';
import { trace, track } from './algorithms/track-trace';
import type { FlowNode } from './algorithms/track-trace';

// =============================================================================
// VF QUERIES — Unified query interface
// =============================================================================

export class VfQueries {
    constructor(
        private readonly observer: Observer,
        private readonly planStore: PlanStore,
        private readonly recipes: RecipeStore,
        private readonly processes: ProcessRegistry,
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

    /** Events where agent is provider */
    economicEventsAsProvider(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e => e.provider === agentId);
    }

    /** Events where agent is receiver */
    economicEventsAsReceiver(agentId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e => e.receiver === agentId);
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

    /** All plans where agent has processes in scope */
    agentPlans(agentId: string): Plan[] {
        const planIds = new Set(
            this.agentProcesses(agentId)
                .map(p => p.plannedWithin)
                .filter(Boolean) as string[],
        );
        return this.planStore.allPlans().filter(p => planIds.has(p.id));
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

    // =========================================================================
    // ECONOMIC EVENT QUERIES (inverses.md §EconomicEvent)
    // =========================================================================

    /** Reciprocal events: events on the same Agreement with opposite provider/receiver */
    reciprocalEvents(eventId: string): EconomicEvent[] {
        const event = this.observer.getEvent(eventId);
        if (!event?.realizationOf) return [];
        return this.observer.allEvents().filter(e =>
            e.id !== eventId &&
            e.realizationOf === event.realizationOf &&
            e.provider === event.receiver &&
            e.receiver === event.provider,
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

    /** Events from this resource (resourceInventoriedAs) */
    economicEventsFrom(resourceId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
            e.resourceInventoriedAs === resourceId,
        );
    }

    /** Events to this resource (toResourceInventoriedAs) */
    economicEventsTo(resourceId: string): EconomicEvent[] {
        return this.observer.allEvents().filter(e =>
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
        return this.planStore.getProposal(proposalId)?.purpose === 'offer';
    }

    /** Check if a proposal is a request */
    isRequest(proposalId: string): boolean {
        return this.planStore.getProposal(proposalId)?.purpose === 'request';
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
        return [c.provider, c.receiver].filter(Boolean) as string[];
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

    /** All inScopeOf agents across the plan's processes */
    planInScopeOf(planId: string): string[] {
        const agents = new Set<string>();
        for (const p of this.processes.forPlan(planId)) {
            if (p.inScopeOf) p.inScopeOf.forEach(a => agents.add(a));
        }
        return [...agents];
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
}
