/**
 * Commune & Account — SNLT-based communal labor-credit system.
 *
 * This implements a Social Necessary Labor Time (SNLT) elastic claim model
 * as an application-layer extension ON TOP of ValueFlows, not instead of it.
 *
 * Integration with VF:
 *   - Labor is credited via `work` EconomicEvents recorded in the Observer.
 *   - `Account.creditFromEvent(event)` reads effortQuantity from a work event.
 *   - `Account.claimGoods(event)` can be tied to consume/transfer events.
 *   - The `Commune` holds the global consumption pool, updated as events flow.
 *
 * Usage:
 *   const commune = new Commune({ communalDeductionRate: 0.5 });
 *   const account = new Account(commune, agentId);
 *   observer.subscribe(e => {
 *     if (e.type === 'recorded' && e.event.action === 'work') {
 *       const account = commune.accountFor(e.event.provider);
 *       account?.creditFromEvent(e.event);
 *     }
 *   });
 */

import type { EconomicEvent } from '../schemas';

// =============================================================================
// COMMUNE — global pool and deduction parameters
// =============================================================================

export interface CommuneOptions {
    /** Fraction of each labor credit deducted for communal purposes (0–1). */
    communalDeductionRate?: number;
    /** Initial consumption pool (SNLT units). Grows as goods are produced. */
    initialConsumptionPool?: number;
}

export class Commune {
    /** Sum of SNLT of all goods currently available for claiming. */
    public current_consumption_pool: number;
    /** Fraction deducted for communal fund (e.g. 0.5 = 50%). */
    public communal_deduction_rate: number;

    private accounts = new Map<string, Account>();

    constructor(options: CommuneOptions = {}) {
        this.communal_deduction_rate = options.communalDeductionRate ?? 0.5;
        this.current_consumption_pool = options.initialConsumptionPool ?? 0;
    }

    /** Register or retrieve the Account for a given VF agent ID. */
    accountFor(agentId: string): Account | undefined {
        return this.accounts.get(agentId);
    }

    /** Ensure an Account exists for this agent. */
    ensureAccount(agentId: string): Account {
        let account = this.accounts.get(agentId);
        if (!account) {
            account = new Account(this, agentId);
            this.accounts.set(agentId, account);
        }
        return account;
    }

    allAccounts(): Account[] {
        return Array.from(this.accounts.values());
    }

    /**
     * Sum of all members' current potential claim capacities.
     * Used as the denominator for elastic share calculation.
     */
    get social_total_potential_claims(): number {
        let total = 0;
        for (const account of this.accounts.values()) {
            total += account.current_potential_claim_capacity;
        }
        return total;
    }

    /**
     * Add SNLT value to the pool when goods are produced.
     * Call this when a `produce` EconomicEvent is recorded.
     */
    addToPool(snltValue: number): void {
        this.current_consumption_pool += snltValue;
    }
}

// =============================================================================
// ACCOUNT — per-agent labor credits and claim capacity
// =============================================================================

export class Account {
    /** Agent ID this account belongs to (matches VF Agent.id). */
    readonly agentId: string;

    /** Running total of SNLT hours credited (immutable / additive). */
    public gross_labor_credited: number = 0;

    /** Running total of SNLT value claimed from the pool (immutable / additive). */
    public claimed_capacity: number = 0;

    constructor(private commune: Commune, agentId: string) {
        this.agentId = agentId;
    }

    // =========================================================================
    // DERIVED CLAIM PROPERTIES
    // =========================================================================

    /** Labor credited after communal deduction. */
    get net_claim_capacity(): number {
        return this.gross_labor_credited * (1 - this.commune.communal_deduction_rate);
    }

    /** Remaining unclaimed capacity. */
    get current_potential_claim_capacity(): number {
        return this.net_claim_capacity - this.claimed_capacity;
    }

    /** This account's elastic share of total social potential claims (0–1). */
    get current_share_of_claims(): number {
        const totalPotential = this.commune.social_total_potential_claims;
        if (totalPotential === 0) return 0;
        return this.current_potential_claim_capacity / totalPotential;
    }

    /** Absolute amount this account can claim from the current pool. */
    get current_actual_claim_capacity(): number {
        return this.current_share_of_claims * this.commune.current_consumption_pool;
    }

    // =========================================================================
    // VF-INTEGRATED ACTIONS
    // =========================================================================

    /**
     * Credit labor from a VF `work` EconomicEvent.
     *
     * Reads effortQuantity.hasNumericalValue as SNLT hours.
     * Call from an Observer listener whenever a work event is recorded.
     */
    creditFromEvent(event: EconomicEvent): void {
        if (event.action !== 'work') return;
        const hours = event.effortQuantity?.hasNumericalValue ?? 0;
        this.gross_labor_credited += hours;
    }

    /**
     * Directly credit a quantity of SNLT hours (without a VF event).
     * Use this only for bootstrapping or testing.
     */
    addLabor(snltHours: number): void {
        this.gross_labor_credited += snltHours;
    }

    /**
     * Claim goods from the communal pool.
     *
     * @param snltCostOfGoods - SNLT value of the goods being claimed.
     * @returns true if the claim succeeded, false if insufficient capacity.
     */
    claimGoods(snltCostOfGoods: number): boolean {
        if (this.current_actual_claim_capacity >= snltCostOfGoods) {
            this.claimed_capacity += snltCostOfGoods;
            this.commune.current_consumption_pool -= snltCostOfGoods;
            return true;
        }
        return false;
    }
}
