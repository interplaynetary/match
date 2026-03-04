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
    Claim,
    Measure,
    RecipeFlow,
    RecipeProcess,
    Agreement,
    AgreementBundle,
    Proposal,
    ProposalList,
    RecipeExchange,
    Scenario,
    ScenarioDefinition,
} from '../schemas';
import { ACTION_DEFINITIONS } from '../schemas';
import type { TemporalExpression } from '../utils/time';
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
    private claims = new Map<string, Claim>();
    private agreements = new Map<string, Agreement>();
    private agreementBundles = new Map<string, AgreementBundle>();
    private proposals = new Map<string, Proposal>();
    private proposalLists = new Map<string, ProposalList>();
    private scenarios = new Map<string, Scenario>();
    private scenarioDefinitions = new Map<string, ScenarioDefinition>();

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

    commitmentsForPlan(planId: string): Commitment[] {
        return Array.from(this.commitments.values())
            .filter(c => c.plannedWithin === planId);
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
        if (intent.provider && intent.receiver) {
            throw new Error(
                `VF constraint violation: Intent cannot have both provider and receiver. ` +
                `Use addCommitment() for bilateral flows.`
            );
        }
        const i: Intent = { id: intent.id ?? this.generateId(), ...intent };
        this.intents.set(i.id, i);
        return i;
    }

    getIntent(id: string): Intent | undefined { return this.intents.get(id); }

    allIntents(): Intent[] { return Array.from(this.intents.values()); }

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

    // =========================================================================
    // BULK OPERATIONS — merge / retract
    // =========================================================================

    /** All processes registered in the shared ProcessRegistry. */
    allProcesses(): Process[] { return this.processes.all(); }

    /**
     * Import all records from a sub-PlanStore into this one.
     * Caller is responsible for ensuring disjoint IDs.
     */
    merge(sub: PlanStore): void {
        for (const proc of sub.allProcesses()) this.processes.register(proc);
        for (const c of sub.allCommitments()) this.commitments.set(c.id, c);
        for (const i of sub.allIntents()) this.intents.set(i.id, i);
        for (const p of sub.allPlans()) this.plans.set(p.id, p);
    }

    /**
     * Batch-delete records by ID. Used by backtracking and surgical retraction.
     * Missing IDs are silently ignored.
     */
    removeRecords(ids: {
        processIds?: string[];
        commitmentIds?: string[];
        intentIds?: string[];
    }): void {
        for (const id of ids.processIds ?? []) this.processes.unregister(id);
        for (const id of ids.commitmentIds ?? []) this.commitments.delete(id);
        for (const id of ids.intentIds ?? []) this.intents.delete(id);
    }

    removeRecordsForPlan(planId: string): void {
        for (const p of this.processes.forPlan(planId)) this.processes.unregister(p.id);
        for (const c of this.commitmentsForPlan(planId)) this.commitments.delete(c.id);
        for (const i of this.intentsForPlan(planId)) this.intents.delete(i.id);
    }

    // =========================================================================
    // CRUD — Claims
    // =========================================================================

    /**
     * Add a Claim — a receiver-initiated obligation triggered by an event.
     * Typically auto-created after recording the triggering EconomicEvent.
     * The `triggeredBy` field links back to the event that generated this claim.
     */
    addClaim(claim: Omit<Claim, 'id'> & { id?: string }): Claim {
        const c: Claim = { id: claim.id ?? this.generateId(), ...claim };
        this.claims.set(c.id, c);
        return c;
    }

    getClaim(id: string): Claim | undefined { return this.claims.get(id); }

    allClaims(): Claim[] { return Array.from(this.claims.values()); }

    /** Claims where agentId is provider or receiver. */
    claimsForAgent(agentId: string): Claim[] {
        return Array.from(this.claims.values()).filter(c =>
            c.provider === agentId || c.receiver === agentId,
        );
    }

    // =========================================================================
    // CRUD — Intent promotion
    // =========================================================================

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

        // --- minimumQuantity validation ---
        const committedQty = intent.resourceQuantity ?? intent.effortQuantity;
        if (intent.minimumQuantity && committedQty) {
            if (committedQty.hasNumericalValue < intent.minimumQuantity.hasNumericalValue) {
                throw new Error(
                    `Quantity ${committedQty.hasNumericalValue} is below minimum ` +
                    `${intent.minimumQuantity.hasNumericalValue} ${intent.minimumQuantity.hasUnit} ` +
                    `for Intent ${intentId}`,
                );
            }
        }

        // --- availableQuantity check and decrement ---
        if (intent.availableQuantity && committedQty) {
            if (committedQty.hasNumericalValue > intent.availableQuantity.hasNumericalValue) {
                throw new Error(
                    `Requested quantity ${committedQty.hasNumericalValue} exceeds available ` +
                    `${intent.availableQuantity.hasNumericalValue} ${intent.availableQuantity.hasUnit} ` +
                    `for Intent ${intentId}`,
                );
            }
            intent.availableQuantity.hasNumericalValue -= committedQty.hasNumericalValue;
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
            atLocation: intent.atLocation,
            due: intent.due,
            hasBeginning: intent.hasBeginning,
            hasEnd: intent.hasEnd,
            hasPointInTime: intent.hasPointInTime,
            plannedWithin: intent.plannedWithin,
            satisfies: intentId,
            availability_window: intent.availability_window,
            finished: false,
        });

        // Mark intent as satisfied only when it is NOT recurring.
        // If availableQuantity is tracked, only finish when it's depleted.
        // A recurring Intent (availability_window set) always stays open.
        if (!intent.availability_window) {
            const depleted = !intent.availableQuantity ||
                intent.availableQuantity.hasNumericalValue <= 0;
            if (depleted) intent.finished = true;
        }

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
    // CRUD — AgreementBundles (GAP-J)
    // =========================================================================

    /**
     * Add an AgreementBundle — groups multiple agreements for a single transaction
     * (e.g. all line items in an order).
     * VF spec: exchanges.md, model-text.md §vf:AgreementBundle.
     */
    addAgreementBundle(bundle: Omit<AgreementBundle, 'id'> & { id?: string }): AgreementBundle {
        const b: AgreementBundle = { id: bundle.id ?? this.generateId(), ...bundle };
        this.agreementBundles.set(b.id, b);
        return b;
    }

    getAgreementBundle(id: string): AgreementBundle | undefined { return this.agreementBundles.get(id); }
    allAgreementBundles(): AgreementBundle[] { return Array.from(this.agreementBundles.values()); }

    /** Get all agreements that belong to a bundle. */
    agreementsInBundle(bundleId: string): Agreement[] {
        const bundle = this.agreementBundles.get(bundleId);
        if (!bundle) return [];
        return (bundle.bundles ?? [])
            .map(id => this.agreements.get(id))
            .filter((a): a is Agreement => a !== undefined);
    }

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

    // =========================================================================
    // CRUD — ProposalLists (GAP-K)
    // =========================================================================

    /**
     * Add a ProposalList — groups proposals into a user-defined set
     * (e.g. a price list, or all proposals for a given event/fair).
     * VF spec: proposals.md, model-text.md §vf:ProposalList.
     */
    addProposalList(list: Omit<ProposalList, 'id'> & { id?: string }): ProposalList {
        const pl: ProposalList = { id: list.id ?? this.generateId(), ...list };
        this.proposalLists.set(pl.id, pl);
        return pl;
    }

    getProposalList(id: string): ProposalList | undefined { return this.proposalLists.get(id); }
    allProposalLists(): ProposalList[] { return Array.from(this.proposalLists.values()); }

    /** Get all proposals that belong to a list. */
    proposalsInList(listId: string): Proposal[] {
        const list = this.proposalLists.get(listId);
        if (!list) return [];
        return (list.lists ?? [])
            .map(id => this.proposals.get(id))
            .filter((p): p is Proposal => p !== undefined);
    }

    // =========================================================================
    // CRUD — Scenarios (GAP-E)
    // =========================================================================

    /**
     * Add a ScenarioDefinition — a named type/template for a category of scenarios.
     * VF spec: model-text.md §vf:ScenarioDefinition, estimates.md.
     */
    addScenarioDefinition(def: Omit<ScenarioDefinition, 'id'> & { id?: string }): ScenarioDefinition {
        const sd: ScenarioDefinition = { id: def.id ?? this.generateId(), ...def };
        this.scenarioDefinitions.set(sd.id, sd);
        return sd;
    }

    getScenarioDefinition(id: string): ScenarioDefinition | undefined { return this.scenarioDefinitions.get(id); }
    allScenarioDefinitions(): ScenarioDefinition[] { return Array.from(this.scenarioDefinitions.values()); }

    /** Get all scenarios defined by a ScenarioDefinition. */
    scenariosForDefinition(definitionId: string): Scenario[] {
        return Array.from(this.scenarios.values()).filter(s => s.definedAs === definitionId);
    }

    /**
     * Add a Scenario — high-level grouping for analysis, budgeting, or pre-planning.
     * Plans, processes, and intents associate themselves via back-references
     * (Plan.refinementOf, Process.nestedIn, Intent.plannedWithin).
     * VF spec: model-text.md §vf:Scenario, estimates.md.
     */
    addScenario(scenario: Omit<Scenario, 'id'> & { id?: string }): Scenario {
        const s: Scenario = { id: scenario.id ?? this.generateId(), ...scenario };
        this.scenarios.set(s.id, s);
        return s;
    }

    getScenario(id: string): Scenario | undefined { return this.scenarios.get(id); }
    allScenarios(): Scenario[] { return Array.from(this.scenarios.values()); }

    /** Get all scenarios that are refinements (sub-scenarios) of the given scenario. */
    scenarioRefinements(scenarioId: string): Scenario[] {
        return Array.from(this.scenarios.values()).filter(s => s.refinementOf === scenarioId);
    }

    /** Get all plans that refine (are operational implementations of) a given scenario. */
    plansForScenario(scenarioId: string): Plan[] {
        return Array.from(this.plans.values()).filter(p => p.refinementOf === scenarioId);
    }

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
        atLocation?: string;
        availability_window?: TemporalExpression;
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
            atLocation: params.atLocation,
            availability_window: params.availability_window,
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
        atLocation?: string;
        availability_window?: TemporalExpression;
    }): { proposal: Proposal; primaryIntent: Intent } {
        const primaryIntent = this.addIntent({
            action: params.action,
            receiver: params.receiver,
            resourceConformsTo: params.resourceConformsTo,
            resourceClassifiedAs: params.resourceClassifiedAs,
            resourceQuantity: params.resourceQuantity,
            effortQuantity: params.effortQuantity,
            note: params.note,
            atLocation: params.atLocation,
            availability_window: params.availability_window,
            finished: false,
        });

        const proposal = this.addProposal({
            purpose: 'request',
            publishes: [primaryIntent.id],
        });

        return { proposal, primaryIntent };
    }

    // =========================================================================
    // PROPOSAL ACCEPTANCE — Proposal → Agreement → Commitment lifecycle
    // =========================================================================

    /**
     * Accept a Proposal, turning its Intents into Commitments and linking
     * them under a new Agreement. Closes the proposal→agreement→commitment
     * lifecycle loop.
     *
     * Validations (all throw on failure):
     *   - Proposal must exist
     *   - Proposal must not be expired (hasEnd) or not yet open (hasBeginning)
     *   - If proposedTo is set, options.acceptingAgentId must be in the list
     *
     * @param proposalId   - The Proposal being accepted
     * @param counterparty - Fills provider/receiver gaps on Intents
     * @param options.due              - Optional due date for all generated Commitments
     * @param options.acceptingAgentId - Identity of the accepting agent (required when proposedTo is set)
     * @param options.unitQuantity     - For unitBased proposals: scales all commitment quantities
     */
    acceptProposal(
        proposalId: string,
        counterparty: { provider?: string; receiver?: string },
        options?: { due?: string; acceptingAgentId?: string; unitQuantity?: number },
    ): { agreement: Agreement; commitments: Commitment[] } {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

        // --- Temporal validation ---
        const now = new Date().toISOString();
        if (proposal.hasEnd && now > proposal.hasEnd) {
            throw new Error(`Proposal ${proposalId} expired on ${proposal.hasEnd}`);
        }
        if (proposal.hasBeginning && now < proposal.hasBeginning) {
            throw new Error(`Proposal ${proposalId} not yet open (opens ${proposal.hasBeginning})`);
        }

        // --- proposedTo enforcement ---
        if (proposal.proposedTo?.length) {
            const acceptingId = options?.acceptingAgentId;
            if (!acceptingId || !proposal.proposedTo.includes(acceptingId)) {
                throw new Error(
                    `Proposal ${proposalId} is restricted to: ${proposal.proposedTo.join(', ')}`,
                );
            }
        }

        // --- unitBased scaling ---
        const unitScale = proposal.unitBased && options?.unitQuantity != null
            ? options.unitQuantity
            : 1;

        const scaleCommitment = (c: Commitment): void => {
            if (unitScale !== 1) {
                if (c.resourceQuantity) {
                    c.resourceQuantity = {
                        hasNumericalValue: c.resourceQuantity.hasNumericalValue * unitScale,
                        hasUnit: c.resourceQuantity.hasUnit,
                    };
                }
                if (c.effortQuantity) {
                    c.effortQuantity = {
                        hasNumericalValue: c.effortQuantity.hasNumericalValue * unitScale,
                        hasUnit: c.effortQuantity.hasUnit,
                    };
                }
            }
            if (options?.due) c.due = options.due;
        };

        const primaryIds: string[] = [];
        const reciprocalIds: string[] = [];
        const allCommitments: Commitment[] = [];

        // Primary Intents → stipulates
        for (const intentId of proposal.publishes ?? []) {
            const c = this.promoteToCommitment(intentId, counterparty);
            scaleCommitment(c);
            primaryIds.push(c.id);
            allCommitments.push(c);
        }

        // Reciprocal Intents → stipulatesReciprocal
        // Flip counterparty: accepting agent provides the reciprocal flow
        const flipped = { provider: counterparty.receiver, receiver: counterparty.provider };
        for (const intentId of proposal.reciprocal ?? []) {
            const c = this.promoteToCommitment(intentId, flipped);
            scaleCommitment(c);
            reciprocalIds.push(c.id);
            allCommitments.push(c);
        }

        const agreement = this.addAgreement({
            name: proposal.name,
            created: new Date().toISOString(),
            stipulates: primaryIds.length > 0 ? primaryIds : undefined,
            stipulatesReciprocal: reciprocalIds.length > 0 ? reciprocalIds : undefined,
        });

        for (const c of allCommitments) {
            c.clauseOf = agreement.id;
        }

        return { agreement, commitments: allCommitments };
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
     * Pure (no persistence) recipe graph builder — the search-phase counterpart
     * of instantiateRecipe().
     *
     * Returns Process and Commitment objects with pre-generated IDs but does NOT
     * write anything to PlanStore or ProcessRegistry.  `plannedWithin` is left
     * undefined on all objects; promoteToPlan() sets it via scenarioToPlan().
     *
     * If `intentId` is provided, the primary output Commitment (the one outputOf
     * the last process whose resourceConformsTo matches the primary output spec)
     * gets `satisfies: intentId` so that scoreScenario() can count it.
     *
     * RecipeExchanges are intentionally skipped — they represent bilateral
     * commercial agreements that are irrelevant during speculative search.
     * Observer-based inventory allocation is also skipped — the planner's
     * `remaining` map already accounts for available stock.
     */
    buildRecipeGraph(
        recipeStore: RecipeStore,
        recipeId: string,
        quantity: number,
        dueDate: Date,
        intentId?: string,
    ): { processes: Process[]; commitments: Commitment[] } {
        const recipe = recipeStore.getRecipe(recipeId);
        if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

        const chain = recipeStore.getProcessChain(recipeId);
        if (chain.length === 0) throw new Error(`Recipe ${recipeId} has no processes`);

        const scaleFactor = this.computeScaleFactor(recipeStore, chain, recipe.primaryOutput, quantity);

        const processes: Process[] = [];
        const commitments: Commitment[] = [];

        const orderedChain = [...chain].reverse(); // back-schedule from dueDate
        let cursor = dueDate;

        for (const rp of orderedChain) {
            const durationHours = rp.hasDuration
                ? rp.hasDuration.hasNumericalValue * (rp.hasDuration.hasUnit === 'days' ? 24 : 1)
                : 1;

            const processEnd   = new Date(cursor);
            const processBegin = new Date(processEnd.getTime() - durationHours * 3600000);
            cursor = processBegin;

            // Construct Process in-memory (no processes.register() call)
            const process: Process = {
                id: this.generateId(),
                name: rp.name,
                note: rp.note,
                basedOn: rp.processConformsTo,
                classifiedAs: rp.processClassifiedAs,
                hasBeginning: processBegin.toISOString(),
                hasEnd: processEnd.toISOString(),
                finished: false,
                // plannedWithin: intentionally omitted — set by scenarioToPlan()
            };
            processes.push(process);

            const { inputs, outputs } = recipeStore.flowsForProcess(rp.id);

            for (const flow of inputs) {
                const commitment: Commitment = {
                    id: this.generateId(),
                    action: flow.action,
                    inputOf: process.id,
                    resourceConformsTo: flow.resourceConformsTo,
                    resourceClassifiedAs: flow.resourceClassifiedAs,
                    resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
                    effortQuantity:   this.scaleQuantity(flow.effortQuantity, scaleFactor),
                    stage: flow.stage,
                    state: flow.state,
                    due: processBegin.toISOString(),
                    finished: false,
                };
                commitments.push(commitment);
            }

            for (const flow of outputs) {
                const commitment: Commitment = {
                    id: this.generateId(),
                    action: flow.action,
                    outputOf: process.id,
                    resourceConformsTo: flow.resourceConformsTo,
                    resourceClassifiedAs: flow.resourceClassifiedAs,
                    resourceQuantity: this.scaleQuantity(flow.resourceQuantity, scaleFactor),
                    effortQuantity:   this.scaleQuantity(flow.effortQuantity, scaleFactor),
                    stage: flow.stage,
                    state: flow.state,
                    due: dueDate.toISOString(),
                    finished: false,
                };
                commitments.push(commitment);
            }
        }

        // Tag the primary output Commitment with satisfies: intentId so that
        // scoreScenario() can count this intent as satisfied.
        if (intentId) {
            const lastProcess = processes[processes.length - 1];
            const primarySpec = recipe.primaryOutput;
            const primaryOut = commitments.find(c =>
                c.outputOf === lastProcess?.id &&
                (!primarySpec || c.resourceConformsTo === primarySpec),
            );
            if (!primaryOut) {
                throw new Error(
                    `buildRecipeGraph: intentId '${intentId}' provided but primary output ` +
                    `'${primarySpec}' not found in recipe '${recipe.name}' outputs. ` +
                    `Cannot set satisfies link.`
                );
            }
            primaryOut.satisfies = intentId;
        }

        return { processes, commitments };
    }

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
                // --- Durable inputs: existence gate, not quantity netting ---
                // Actions with accountingEffect='noEffect' (use, cite) are existence gates:
                // the resource must be present but is not consumed.
                {
                    const actionDef = ACTION_DEFINITIONS[flow.action];
                    const isDurable = actionDef?.accountingEffect === 'noEffect';

                    if (isDurable && flow.resourceConformsTo) {
                        if (observer) {
                            const exists = observer.conformingResources(flow.resourceConformsTo)
                                .some(r => {
                                    if ((r.accountingQuantity?.hasNumericalValue ?? 0) <= 0) return false;
                                    if (flow.stage && r.stage !== flow.stage) return false;
                                    if (flow.state && r.state !== flow.state) return false;
                                    return true;
                                });
                            if (exists) continue; // Present — no demand created
                        }
                        // Not present — signal that this durable resource must be sourced
                        const durableResult = this.createFlowFromRecipe(
                            flow, process.id, 'input', scaleFactor, processBegin, plan.id, agents,
                        );
                        if ('provider' in durableResult && durableResult.provider
                            && 'receiver' in durableResult && durableResult.receiver) {
                            commitments.push(durableResult as Commitment);
                        } else {
                            intents.push(durableResult as Intent);
                        }
                        continue; // Do NOT fall through to quantity netting
                    }
                }

                // --- Inventory-aware demand (VF dependent demand) ---
                // If observer is provided, check if a resource already exists
                // that could satisfy this input. If so, allocate it instead
                // of demanding new production.
                let adjustedFlow = flow;
                if (observer && flow.resourceConformsTo) {
                    // VF spec (resources.md §Stage and state): dependent demand
                    // "will select only those resources that fit the specified stage and state".
                    const available = observer.conformingResources(flow.resourceConformsTo)
                        .filter(r => {
                            const qty = r.accountingQuantity?.hasNumericalValue ?? 0;
                            if (qty <= 0) return false;
                            if (flow.stage && r.stage !== flow.stage) return false;
                            if (flow.state && r.state !== flow.state) return false;
                            return true;
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

                const hasAnyTag = exchangeFlows.some(f => f.isPrimary !== undefined);
                const isBilateral = exchangeFlows.length === 2;

                for (let i = 0; i < exchangeFlows.length; i++) {
                    const flow = exchangeFlows[i];
                    const commitment = this.createCommitmentFromFlow(
                        flow, undefined, undefined, scaleFactor, dueDate, plan.id, agents,
                    );
                    commitments.push(commitment);

                    if (flow.isPrimary === true) {
                        primaryIds.push(commitment.id);
                    } else if (flow.isPrimary === false) {
                        reciprocalIds.push(commitment.id);
                    } else if (!hasAnyTag && isBilateral && i === 0) {
                        primaryIds.push(commitment.id);   // bilateral: first = primary
                    } else if (!hasAnyTag && isBilateral) {
                        reciprocalIds.push(commitment.id); // bilateral: second = reciprocal
                    } else {
                        // Multilateral (3+ flows) with no tags: all go to stipulates.
                        // Caller must use isPrimary to specify sides explicitly.
                        primaryIds.push(commitment.id);
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
        throw new Error(
            `Recipe scale error: primaryOutput '${primaryOutputSpec}' not found in ` +
            `last process '${lastProcess.name}' outputs. ` +
            `Check that the recipe's primaryOutput matches a recipeOutputOf flow.`
        );
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
        // Validate action direction against VF spec
        const def = ACTION_DEFINITIONS[flow.action];
        if (def && def.inputOutput !== 'outputInput' && def.inputOutput !== 'notApplicable') {
            if (direction === 'input' && def.inputOutput !== 'input') {
                throw new Error(
                    `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                    `cannot be used as a process input.`
                );
            }
            if (direction === 'output' && def.inputOutput !== 'output') {
                throw new Error(
                    `Action '${flow.action}' (inputOutput='${def.inputOutput}') ` +
                    `cannot be used as a process output.`
                );
            }
        }

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
            provider: agents?.provider,
            receiver: agents?.receiver,
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
