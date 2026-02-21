/**
 * Planning — Instantiate recipes into scheduled Plans.
 *
 * The full VF lifecycle:
 *   Recipe (template) → Plan (schedule) → Events (observation)
 *
 * Key VF subtleties captured:
 *
 *   1. INTENTS vs COMMITMENTS
 *      - Intent: unilateral desire (provider OR receiver, not both)
 *      - Commitment: bilateral agreement (provider AND receiver)
 *      - Events either fulfill Commitments, or satisfy Intents directly
 *      - Intents can be published via Proposals for matching
 *
 *   2. RECIPE EXCHANGES
 *      - Recipes include RecipeExchange nodes (not just processes)
 *      - RecipeExchange → Agreement + reciprocal Commitments
 *
 *   3. SHARED PROCESSES
 *      - Process is the SAME instance in planning and observation
 *      - Uses shared ProcessRegistry, not a local map
 *
 *   4. PROPOSALS
 *      - Publish Intents (offers/requests) for matching
 *      - Primary + reciprocal intents grouped together
 */

import { nanoid } from 'nanoid';
import type {
    Plan,
    Process,
    Commitment,
    Intent,
    Measure,
    RecipeFlow,
    RecipeProcess,
    Agreement,
    Proposal,
    RecipeExchange,
} from '../schemas';
import { RecipeStore } from '../knowledge/recipes';
import { ProcessRegistry } from '../process-registry';
import { Observer } from '../observation/observer';

// =============================================================================
// PLAN STORE
// =============================================================================

export class PlanStore {
    private plans = new Map<string, Plan>();
    private commitments = new Map<string, Commitment>();
    private intents = new Map<string, Intent>();
    private agreements = new Map<string, Agreement>();
    private proposals = new Map<string, Proposal>();

    constructor(
        readonly processes: ProcessRegistry,
        private generateId: () => string = () => nanoid(),
    ) {}

    // =========================================================================
    // CRUD — Plans
    // =========================================================================

    addPlan(plan: Omit<Plan, 'id'> & { id?: string }): Plan {
        const p: Plan = { id: plan.id ?? this.generateId(), ...plan };
        this.plans.set(p.id, p);
        return p;
    }

    getPlan(id: string): Plan | undefined { return this.plans.get(id); }
    allPlans(): Plan[] { return Array.from(this.plans.values()); }

    // =========================================================================
    // CRUD — Commitments
    // =========================================================================

    addCommitment(commitment: Omit<Commitment, 'id'> & { id?: string }): Commitment {
        const c: Commitment = { id: commitment.id ?? this.generateId(), ...commitment };
        this.commitments.set(c.id, c);
        return c;
    }

    getCommitment(id: string): Commitment | undefined { return this.commitments.get(id); }

    allCommitments(): Commitment[] { return Array.from(this.commitments.values()); }

    commitmentsForProcess(processId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.inputOf === processId || c.outputOf === processId);
    }

    commitmentsForAgreement(agreementId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.clauseOf === agreementId);
    }

    // =========================================================================
    // CRUD — Intents
    // =========================================================================

    /**
     * Create an Intent.
     *
     * VF rule: An Intent has a provider OR a receiver, but not both initially.
     * Provider means "I will provide this" (offer).
     * Receiver means "I need this" (request).
     */
    addIntent(intent: Omit<Intent, 'id'> & { id?: string }): Intent {
        const i: Intent = { id: intent.id ?? this.generateId(), ...intent };
        this.intents.set(i.id, i);
        return i;
    }

    getIntent(id: string): Intent | undefined { return this.intents.get(id); }

    intentsForPlan(planId: string): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.plannedWithin === planId);
    }

    /**
     * Get all open (unfinished) intents.
     */
    openIntents(): Intent[] {
        return Array.from(this.intents.values()).filter(i => !i.finished);
    }

    /**
     * Get all offers (intents with a provider but no receiver).
     */
    offers(): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.provider && !i.receiver && !i.finished);
    }

    /**
     * Get all requests (intents with a receiver but no provider).
     */
    requests(): Intent[] {
        return Array.from(this.intents.values())
            .filter(i => i.receiver && !i.provider && !i.finished);
    }

    /**
     * Promote an Intent to a Commitment.
     *
     * When an Intent finds its match (offer meets request), the two agents
     * agree and the Intent becomes a Commitment with both provider and receiver.
     * The Commitment's `satisfies` field links back to the Intent.
     */
    promoteToCommitment(
        intentId: string,
        counterparty: { provider?: string; receiver?: string },
    ): Commitment {
        const intent = this.intents.get(intentId);
        if (!intent) throw new Error(`Intent ${intentId} not found`);

        const provider = intent.provider ?? counterparty.provider;
        const receiver = intent.receiver ?? counterparty.receiver;
        if (!provider || !receiver) {
            throw new Error(`Cannot promote: need both provider and receiver`);
        }

        const commitment = this.addCommitment({
            action: intent.action,
            inputOf: intent.inputOf,
            outputOf: intent.outputOf,
            resourceInventoriedAs: intent.resourceInventoriedAs,
            resourceConformsTo: intent.resourceConformsTo,
            resourceClassifiedAs: intent.resourceClassifiedAs,
            resourceQuantity: intent.resourceQuantity,
            effortQuantity: intent.effortQuantity,
            stage: intent.stage,
            state: intent.state,
            provider,
            receiver,
            due: intent.due,
            hasBeginning: intent.hasBeginning,
            hasEnd: intent.hasEnd,
            plannedWithin: intent.plannedWithin,
            satisfies: intentId,
            finished: false,
        });

        // Mark intent as satisfied (a commitment now covers it)
        intent.finished = true;

        return commitment;
    }

    // =========================================================================
    // CRUD — Agreements
    // =========================================================================

    addAgreement(agreement: Omit<Agreement, 'id'> & { id?: string }): Agreement {
        const a: Agreement = { id: agreement.id ?? this.generateId(), ...agreement };
        this.agreements.set(a.id, a);
        return a;
    }

    getAgreement(id: string): Agreement | undefined { return this.agreements.get(id); }

    allAgreements(): Agreement[] { return Array.from(this.agreements.values()); }

    // =========================================================================
    // CRUD — Proposals (publish Intents)
    // =========================================================================

    /**
     * Create a Proposal that publishes Intents for matching.
     *
     * A Proposal groups:
     *   - Primary Intents: what we're offering/requesting
     *   - Reciprocal Intents: what we want in return
     */
    addProposal(proposal: Omit<Proposal, 'id'> & { id?: string }): Proposal {
        const p: Proposal = { id: proposal.id ?? this.generateId(), ...proposal };
        this.proposals.set(p.id, p);
        return p;
    }

    getProposal(id: string): Proposal | undefined { return this.proposals.get(id); }

    allProposals(): Proposal[] { return Array.from(this.proposals.values()); }

    /**
     * Convenience: create an offer proposal.
     *
     * Creates an Intent with a provider (the offerer) and wraps it in a Proposal.
     */
    publishOffer(params: {
        provider: string;
        action: Intent['action'];
        resourceConformsTo?: string;
        resourceClassifiedAs?: string[];
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        note?: string;
        reciprocal?: {
            action: Intent['action'];
            resourceConformsTo?: string;
            resourceQuantity?: Measure;
        };
    }): { proposal: Proposal; primaryIntent: Intent; reciprocalIntent?: Intent } {
        const primaryIntent = this.addIntent({
            action: params.action,
            provider: params.provider,
            resourceConformsTo: params.resourceConformsTo,
            resourceClassifiedAs: params.resourceClassifiedAs,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            note: params.note,
            finished: false,
        });

        let reciprocalIntent: Intent | undefined;
        if (params.reciprocal) {
            reciprocalIntent = this.addIntent({
                action: params.reciprocal.action,
                receiver: params.provider, // offerer expects to receive
                resourceConformsTo: params.reciprocal.resourceConformsTo,
                resourceQuantity: params.reciprocal.resourceQuantity,
                finished: false,
            });
        }

        const proposal = this.addProposal({
            purpose: 'offer',
            publishes: [primaryIntent.id],
            reciprocal: reciprocalIntent ? [reciprocalIntent.id] : undefined,
        });

        return { proposal, primaryIntent, reciprocalIntent };
    }

    /**
     * Convenience: create a request proposal.
     */
    publishRequest(params: {
        receiver: string;
        action: Intent['action'];
        resourceConformsTo?: string;
        resourceClassifiedAs?: string[];
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        note?: string;
    }): { proposal: Proposal; primaryIntent: Intent } {
        const primaryIntent = this.addIntent({
            action: params.action,
            receiver: params.receiver,
            resourceConformsTo: params.resourceConformsTo,
            resourceClassifiedAs: params.resourceClassifiedAs,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            note: params.note,
            finished: false,
        });

        const proposal = this.addProposal({
            purpose: 'request',
            publishes: [primaryIntent.id],
        });

        return { proposal, primaryIntent };
    }

    // =========================================================================
    // NON-PROCESS FLOWS — Standalone transfer commitments in a Plan
    // =========================================================================

    /**
     * Add a standalone Commitment directly to a Plan (no Process).
     *
     * VF supports non-process flows: transfers, exchanges, and other flows
     * that happen outside of any production process but are still part of
     * a plan's execution.
     */
    addNonProcessCommitment(params: {
        planId: string;
        action: Commitment['action'];
        provider: string;
        receiver: string;
        resourceConformsTo?: string;
        resourceQuantity?: Measure;
        effortQuantity?: Measure;
        due?: string;
        clauseOf?: string;
        note?: string;
    }): Commitment {
        return this.addCommitment({
            action: params.action,
            provider: params.provider,
            receiver: params.receiver,
            resourceConformsTo: params.resourceConformsTo,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            due: params.due,
            clauseOf: params.clauseOf,
            plannedWithin: params.planId,
            note: params.note,
            created: new Date().toISOString(),
            finished: false,
        });
    }

    // =========================================================================
    // RECIPE INSTANTIATION
    // =========================================================================

    /**
     * Instantiate a recipe into a Plan with Processes, Commitments,
     * Intents (for unassigned flows), and Agreements (from RecipeExchanges).
     *
     * @param recipeStore - The knowledge base
     * @param recipeId - Which recipe to instantiate
     * @param quantity - Desired output quantity (will scale)
     * @param dueDate - When the final output is needed
     * @param agents - Optional agents for commitments. Unassigned flows
     *                 become Intents (with only provider or receiver).
     * @param scheduling - 'back' (default: from due date backwards)
     *                     or 'forward' (from start date forwards)
     * @param startDate - Required when scheduling='forward'
     * @param observer - Optional: if provided, checks inventory before creating
     *                   processes (VF dependent demand algorithm)
     */
    instantiateRecipe(
        recipeStore: RecipeStore,
        recipeId: string,
        quantity: number,
        dueDate: Date,
        agents?: { provider?: string; receiver?: string },
        scheduling: 'back' | 'forward' = 'back',
        startDate?: Date,
        observer?: Observer,
    ): {
        plan: Plan;
        processes: Process[];
        commitments: Commitment[];
        intents: Intent[];
        agreements: Agreement[];
        allocated: Array<{ specId: string; resourceId: string; quantity: number }>;
    } {
        const recipe = recipeStore.getRecipe(recipeId);
        if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

        const chain = recipeStore.getProcessChain(recipeId);
        if (chain.length === 0) throw new Error(`Recipe ${recipeId} has no processes`);

        const scaleFactor = this.computeScaleFactor(recipeStore, chain, recipe.primaryOutput, quantity);

        const plan = this.addPlan({
            name: `Plan: ${recipe.name} × ${quantity}`,
            note: `Instantiated from recipe ${recipe.name}`,
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
        });

        // Schedule processes
        const processes: Process[] = [];
        const commitments: Commitment[] = [];
        const intents: Intent[] = [];
        const allocated: Array<{ specId: string; resourceId: string; quantity: number }> = [];

        // Determine ordering based on scheduling direction
        const orderedChain = scheduling === 'back' ? [...chain].reverse() : [...chain];
        let cursor = scheduling === 'back' ? dueDate : (startDate ?? new Date());

        for (const rp of orderedChain) {
            const durationHours = rp.hasDuration
                ? rp.hasDuration.hasNumericalValue * (rp.hasDuration.hasUnit === 'days' ? 24 : 1)
                : 1;

            let processBegin: Date;
            let processEnd: Date;

            if (scheduling === 'back') {
                processEnd = new Date(cursor);
                processBegin = new Date(processEnd.getTime() - durationHours * 3600000);
                cursor = processBegin;
            } else {
                processBegin = new Date(cursor);
                processEnd = new Date(processBegin.getTime() + durationHours * 3600000);
                cursor = processEnd;
            }

            // Create Process via shared registry
            const process = this.processes.register({
                name: rp.name,
                note: rp.note,
                basedOn: rp.processConformsTo,
                classifiedAs: rp.processClassifiedAs,
                plannedWithin: plan.id,
                hasBeginning: processBegin.toISOString(),
                hasEnd: processEnd.toISOString(),
                finished: false,
            });
            processes.push(process);

            // Create flows (Commitments or Intents)
            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

            for (const flow of inputs) {
                // --- Inventory-aware demand (VF dependent demand) ---
                // If observer is provided, check if a resource already exists
                // that could satisfy this input. If so, allocate it instead
                // of demanding new production.
                let adjustedFlow = flow;
                if (observer && flow.resourceConformsTo) {
                    const available = observer.conformingResources(flow.resourceConformsTo)
                        .filter(r => {
                            const qty = r.accountingQuantity?.hasNumericalValue ?? 0;
                            return qty > 0;
                        });

                    const needed = (flow.resourceQuantity?.hasNumericalValue ?? 0) * scaleFactor;
                    let remaining = needed;

                    for (const r of available) {
                        if (remaining <= 0) break;
                        const avail = r.accountingQuantity?.hasNumericalValue ?? 0;
                        const take = Math.min(avail, remaining);
                        allocated.push({
                            specId: flow.resourceConformsTo,
                            resourceId: r.id,
                            quantity: take,
                        });
                        remaining -= take;
                    }

                    // Only create demand for unmet portion
                    if (remaining <= 0) continue;
                    if (remaining < needed && flow.resourceQuantity) {
                        adjustedFlow = { ...flow, resourceQuantity: {
                            hasNumericalValue: remaining / scaleFactor,
                            hasUnit: flow.resourceQuantity.hasUnit,
                        }};
                    }
                }

                const result = this.createFlowFromRecipe(
                    adjustedFlow, process.id, 'input', scaleFactor, processBegin, plan.id, agents,
                );
                if ('provider' in result && result.provider && 'receiver' in result && result.receiver) {
                    commitments.push(result as Commitment);
                } else {
                    intents.push(result as Intent);
                }
            }

            for (const flow of outputs) {
                const result = this.createFlowFromRecipe(
                    flow, process.id, 'output', scaleFactor, processEnd, plan.id, agents,
                );
                if ('provider' in result && result.provider && 'receiver' in result && result.receiver) {
                    commitments.push(result as Commitment);
                } else {
                    intents.push(result as Intent);
                }
            }
        }

        // --- Generate Agreements from RecipeExchanges ---
        const agreements: Agreement[] = [];
        if (recipe.recipeExchanges) {
            for (const rexId of recipe.recipeExchanges) {
                const rex = recipeStore.getRecipeExchange(rexId);
                if (!rex) continue;

                const exchangeFlows = recipeStore.flowsForExchange(rexId);
                const primaryIds: string[] = [];
                const reciprocalIds: string[] = [];

                for (const flow of exchangeFlows) {
                    const commitment = this.createCommitmentFromFlow(
                        flow, undefined, undefined, scaleFactor, dueDate, plan.id, agents,
                    );
                    commitments.push(commitment);
                    // First flow = primary, rest = reciprocal
                    if (primaryIds.length === 0) {
                        primaryIds.push(commitment.id);
                    } else {
                        reciprocalIds.push(commitment.id);
                    }
                }

                const agreement = this.addAgreement({
                    name: rex.name,
                    note: rex.note,
                    created: new Date().toISOString(),
                    stipulates: primaryIds,
                    stipulatesReciprocal: reciprocalIds.length > 0 ? reciprocalIds : undefined,
                });
                agreements.push(agreement);

                // Set clauseOf on each commitment
                for (const cId of [...primaryIds, ...reciprocalIds]) {
                    const c = this.getCommitment(cId);
                    if (c) c.clauseOf = agreement.id;
                }
            }
        }

        // --- Create independent demand (the plan's deliverable) ---
        // The final output commitment/intent represents what the plan is for
        const finalOutputs = commitments.filter(c => c.outputOf === processes[processes.length - 1]?.id);
        const independentDemandIds = finalOutputs.map(c => c.id);
        if (independentDemandIds.length > 0) {
            plan.hasIndependentDemand = independentDemandIds;
            for (const c of finalOutputs) {
                c.independentDemandOf = plan.id;
            }
        }

        return { plan, processes, commitments, intents, agreements, allocated };
    }

    /**
     * Connect all plan constructs to the Observer for tracking.
     */
    registerWithObserver(
        observer: Observer,
        result: { commitments: Commitment[]; intents: Intent[] },
    ): void {
        // Processes are already shared via ProcessRegistry
        for (const commitment of result.commitments) {
            observer.registerCommitment(commitment);
        }
        for (const intent of result.intents) {
            observer.registerIntent(intent);
        }
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    private computeScaleFactor(
        recipeStore: RecipeStore,
        chain: RecipeProcess[],
        primaryOutputSpec: string | undefined,
        desiredQuantity: number,
    ): number {
        if (!primaryOutputSpec) return desiredQuantity;
        const lastProcess = chain[chain.length - 1];
        if (!lastProcess) return desiredQuantity;
        const { outputs } = recipeStore.flowsForProcess(lastProcess.id);
        const primaryFlow = outputs.find(f => f.resourceConformsTo === primaryOutputSpec);
        if (primaryFlow?.resourceQuantity) {
            return desiredQuantity / primaryFlow.resourceQuantity.hasNumericalValue;
        }
        return desiredQuantity;
    }

    /**
     * Create a Commitment or Intent from a RecipeFlow.
     *
     * If both provider and receiver are known → Commitment.
     * If only one is known → Intent (unilateral, awaiting matching).
     */
    private createFlowFromRecipe(
        flow: RecipeFlow,
        processId: string,
        direction: 'input' | 'output',
        scaleFactor: number,
        dueDate: Date,
        planId: string,
        agents?: { provider?: string; receiver?: string },
    ): Commitment | Intent {
        const scaledResourceQty = this.scaleQuantity(flow.resourceQuantity, scaleFactor);
        const scaledEffortQty = this.scaleQuantity(flow.effortQuantity, scaleFactor);

        const provider = agents?.provider;
        const receiver = agents?.receiver;

        // If we have both agents → Commitment. Otherwise → Intent.
        if (provider && receiver) {
            return this.addCommitment({
                action: flow.action,
                inputOf: direction === 'input' ? processId : undefined,
                outputOf: direction === 'output' ? processId : undefined,
                resourceConformsTo: flow.resourceConformsTo,
                resourceClassifiedAs: flow.resourceClassifiedAs,
                resourceQuantity: scaledResourceQty,
                effortQuantity: scaledEffortQty,
                stage: flow.stage,
                state: flow.state,
                provider,
                receiver,
                due: dueDate.toISOString(),
                created: new Date().toISOString(),
                plannedWithin: planId,
                finished: false,
            });
        } else {
            // Create Intent: only provider or only receiver
            return this.addIntent({
                action: flow.action,
                inputOf: direction === 'input' ? processId : undefined,
                outputOf: direction === 'output' ? processId : undefined,
                resourceConformsTo: flow.resourceConformsTo,
                resourceClassifiedAs: flow.resourceClassifiedAs,
                resourceQuantity: scaledResourceQty,
                effortQuantity: scaledEffortQty,
                stage: flow.stage,
                state: flow.state,
                provider: provider,     // may be undefined
                receiver: receiver,     // may be undefined
                due: dueDate.toISOString(),
                plannedWithin: planId,
                finished: false,
            });
        }
    }

    private createCommitmentFromFlow(
        flow: RecipeFlow,
        processId: string | undefined,
        direction: 'input' | 'output' | undefined,
        scaleFactor: number,
        dueDate: Date,
        planId: string,
        agents?: { provider?: string; receiver?: string },
    ): Commitment {
        return this.addCommitment({
            action: flow.action,
            inputOf: direction === 'input' ? processId : undefined,
            outputOf: direction === 'output' ? processId : undefined,
            resourceConformsTo: flow.resourceConformsTo,
            resourceClassifiedAs: flow.resourceClassifiedAs,
            resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
            effortQuantity: this.scaleQuantity(flow.effortQuantity, scaleFactor),
            stage: flow.stage,
            state: flow.state,
            provider: agents?.provider ?? 'unassigned',
            receiver: agents?.receiver ?? 'unassigned',
            due: dueDate.toISOString(),
            created: new Date().toISOString(),
            plannedWithin: planId,
            finished: false,
        });
    }

    private scaleQuantity(qty: Measure | undefined, factor: number): Measure | undefined {
        if (!qty) return undefined;
        return {
            hasNumericalValue: qty.hasNumericalValue * factor,
            hasUnit: qty.hasUnit,
        };
    }
}
