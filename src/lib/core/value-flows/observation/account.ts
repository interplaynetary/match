// this is roughly sketched, and not yet integrated.

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