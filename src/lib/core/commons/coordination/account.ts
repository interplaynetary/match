export class Commune {
  // Global Variables tied to the physical world and the 🏛️ plan
  public current_consumption_pool: number = 2000; // Sum of SNLT of all 🟦 currently in pool
  public communal_deduction_rate: number = 0.5; // Dynamically fetched from current 🏛️ plan

  private accounts: Set<Account> = new Set();

  registerAccount(account: Account) {
    this.accounts.add(account);
  }

  // social_total_potential_claims: Sum of EVERYONE'S current_potential_claim_capacity
  get social_total_potential_claims(): number {
    let total = 0;
    for (const account of this.accounts) {
      total += account.current_potential_claim_capacity;
    }
    return total;
  }
}

export class Account {
  // Individual Immutable / Additive State
  public gross_labor_credited: number = 0;
  public claimed_capacity: number = 0;

  constructor(private commune: Commune) {
    this.commune.registerAccount(this);
  }

  // --- Derived Claim Properties ---

  get net_claim_capacity(): number {
    return this.gross_labor_credited * (1 - this.commune.communal_deduction_rate);
  }

  get current_potential_claim_capacity(): number {
    return this.net_claim_capacity - this.claimed_capacity;
  }

  // --- The Elastic Derivation ---

  get current_share_of_claims(): number {
    const totalPotential = this.commune.social_total_potential_claims;
    if (totalPotential === 0) return 0; // Prevent division by zero
    return this.current_potential_claim_capacity / totalPotential;
  }

  get current_actual_claim_capacity(): number {
    return this.current_share_of_claims * this.commune.current_consumption_pool;
  }

  // --- Example Actions ---

  addLabor(snltHours: number) {
    this.gross_labor_credited += snltHours;
  }

  claimGoods(snltCostOfGoods: number): boolean {
    if (this.current_actual_claim_capacity >= snltCostOfGoods) {
      // User has enough actual capacity to claim the good
      this.claimed_capacity += snltCostOfGoods; // Increases their claimed history
      this.commune.current_consumption_pool -= snltCostOfGoods; // Removes the item from the global pool
      return true;
    }
    return false;
  }
}


import type { Need } from '../indexes/need';
import type { Operation } from '../planning/stockbook';

export class PlanIteration {
    social_total_labor: number = 0;
    total_used_up_means_of_production: number = 0;
    replacement_of_used_up_means_of_production: number = 0;
    insurance: number = 0;
    expansion_of_means_of_production: number = 0;
    individual_consumption: number = 0;

    satisfied_needs: string[] = [];
    pruned_needs: { needId: string; reason: string }[] = [];
}

/**
 * Functional Planning Loop
 *
 * Given a list of needs ranked by criticality, attempt to satisfy them 
 * using available operations while maintaining limits on MOP (Means of Production).
 */
export function runPlanningLoop(
    rankedNeeds: Need[],
    possibleOperations: Operation[], // Blueprints/Recipes of how to produce things
    laborLimit: number
): PlanIteration {
    const plan = new PlanIteration();
    
    // Sort just to be absolutely sure they are ranked by criticality (priority 1 is highest)
    const sortedNeeds = [...rankedNeeds].sort((a, b) => b.priority - a.priority);

    for (const need of sortedNeeds) {
        // 1. Find an operation blueprint that satisfies this need.type_id
        // (In a real system, we look for the one with the lowest total-SNLT cost)
        const bestOperation = possibleOperations
            .filter(op => op.effects.some(e => e.productId === need.type_id))
            .sort((a, b) => a.totalSocialTime - b.totalSocialTime)[0];

        if (!bestOperation) {
            plan.pruned_needs.push({ needId: need.id, reason: "No known operation to produce this." });
            continue;
        }

        // 2. Derive Costs for this specific run
        // We scale the operation costs by the quantity needed
        const effectQty = bestOperation.effects.find(e => e.productId === need.type_id)?.quantity || 1;
        const scale = need.quantity / effectQty;
        
        const laborCost = bestOperation.totalSocialTime * scale;
        
        // 3. Attempt Allocation
        // Check if we hit our global labor limits
        if (plan.social_total_labor + laborCost > laborLimit) {
            plan.pruned_needs.push({ 
                needId: need.id, 
                reason: `Labor limit exceeded (Requires ${laborCost}h, only ${laborLimit - plan.social_total_labor}h left).` 
            });
            continue;
        }

        // 4. Commit to Plan
        plan.social_total_labor += laborCost;
        
        // Accumulate MOP usage (Dead Labor)
        const mopUsed = bestOperation.inputsProducts.reduce((sum, input) => sum + (input.alt || 0) * input.quantity, 0) * scale;
        plan.total_used_up_means_of_production += mopUsed;
        
        // Deduct insurance and expansion bounds (simplified as 10% and 5%)
        plan.replacement_of_used_up_means_of_production += mopUsed;
        plan.insurance += mopUsed * 0.10;
        plan.expansion_of_means_of_production += mopUsed * 0.05;

        // Add to individual consumption (Living Labor transferred to goods)
        plan.individual_consumption += laborCost;

        plan.satisfied_needs.push(need.id);
    }

    return plan;
}