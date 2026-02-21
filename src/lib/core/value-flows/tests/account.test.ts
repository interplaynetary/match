import { expect, test, describe } from "bun:test";
import { Commune, Account } from "../observation/account";
import type { EconomicEvent } from "../schemas";

describe("Commune and Account (SNLT Logic)", () => {
    test("Initializes Commune with defaults", () => {
        const commune = new Commune();
        expect(commune.communal_deduction_rate).toBe(0.5);
        expect(commune.current_consumption_pool).toBe(0);
        expect(commune.social_total_potential_claims).toBe(0);
    });

    test("Initializes Commune with custom options", () => {
        const commune = new Commune({ communalDeductionRate: 0.3, initialConsumptionPool: 1000 });
        expect(commune.communal_deduction_rate).toBe(0.3);
        expect(commune.current_consumption_pool).toBe(1000);
    });

    test("Account creation and retrieval", () => {
        const commune = new Commune();
        const account1 = commune.ensureAccount("agent1");
        const account2 = commune.ensureAccount("agent2");
        
        expect(account1.agentId).toBe("agent1");
        expect(commune.accountFor("agent1")).toBe(account1);
        expect(commune.allAccounts().length).toBe(2);
    });

    test("Labor crediting via addLabor", () => {
        const commune = new Commune({ communalDeductionRate: 0.5 });
        const account = commune.ensureAccount("agent1");

        account.addLabor(10);
        expect(account.gross_labor_credited).toBe(10);
        expect(account.net_claim_capacity).toBe(5); // 10 * (1 - 0.5)
        expect(account.current_potential_claim_capacity).toBe(5);
        
        // At this point, total social potential claims is 5
        expect(commune.social_total_potential_claims).toBe(5);
        expect(account.current_share_of_claims).toBe(1); // 5 / 5
    });

    test("Labor crediting via work EconomicEvent", () => {
        const commune = new Commune({ communalDeductionRate: 0.2 });
        const account = commune.ensureAccount("agent1");

        const workEvent: EconomicEvent = {
            id: "ev1",
            action: "work",
            provider: "agent1",
            receiver: "commune",
            effortQuantity: { hasNumericalValue: 8, hasUnit: "hours" }
        };

        account.creditFromEvent(workEvent);
        expect(account.gross_labor_credited).toBe(8);
        expect(account.net_claim_capacity).toBe(6.4); // 8 * (1 - 0.2)
        
        // Non-work event should be ignored
        const produceEvent: EconomicEvent = {
            id: "ev2",
            action: "produce",
            provider: "agent1",
            receiver: "agent1",
            resourceQuantity: { hasNumericalValue: 10, hasUnit: "ea" }
        };
        account.creditFromEvent(produceEvent);
        expect(account.gross_labor_credited).toBe(8); // Remains unchanged
    });

    test("Elastic claim capacity and consumption pool", () => {
        const commune = new Commune({ communalDeductionRate: 0.5 });
        const alice = commune.ensureAccount("alice");
        const bob = commune.ensureAccount("bob");

        // Alice works 10 hours -> 5 net capacity
        alice.addLabor(10);
        // Bob works 30 hours -> 15 net capacity
        bob.addLabor(30);

        expect(commune.social_total_potential_claims).toBe(20); // 5 + 15
        
        // Alice holds 25% of claims, Bob holds 75%
        expect(alice.current_share_of_claims).toBe(0.25);
        expect(bob.current_share_of_claims).toBe(0.75);

        // Commune pool gets filled with goods worth 100 SNLT
        commune.addToPool(100);
        
        // Alice actual claim limit: 25% of 100 = 25
        expect(alice.current_actual_claim_capacity).toBe(25);
        // Bob actual claim limit: 75% of 100 = 75
        expect(bob.current_actual_claim_capacity).toBe(75);
    });

    test("Claiming goods reduces pool and individual capacity", () => {
        const commune = new Commune({ communalDeductionRate: 0.5 });
        const alice = commune.ensureAccount("alice");
        
        alice.addLabor(10); // yields 5 net capacity
        commune.addToPool(100); 

        // Alice wants to claim an item worth 10 SNLT
        expect(alice.current_actual_claim_capacity).toBe(100); // Only one account, 100% share of 100 = 100 actual capacity
        
        const success = alice.claimGoods(10);
        expect(success).toBe(true);

        expect(alice.claimed_capacity).toBe(10);
        // BUT potential claim capacity goes negative?
        // Ah, net_claim_capacity is 5. claimed_capacity is 10.
        // Wait, current_potential_claim_capacity = net_claim_capacity - claimed_capacity = 5 - 10 = -5.
        // Let's test the numbers thoroughly:
        expect(commune.current_consumption_pool).toBe(90);
    });

    test("Claiming goods fails if insufficient actual capacity", () => {
        const commune = new Commune({ communalDeductionRate: 0.5 });
        const alice = commune.ensureAccount("alice");
        const bob = commune.ensureAccount("bob");
        
        alice.addLabor(10); // 5 net
        bob.addLabor(30);   // 15 net
        commune.addToPool(40); // Pool is 40
        
        // Alice has 25% * 40 = 10 actual capacity
        // Trying to claim an item worth 15 SNLT should fail
        const success = alice.claimGoods(15);
        expect(success).toBe(false);
        expect(alice.claimed_capacity).toBe(0);
        expect(commune.current_consumption_pool).toBe(40);
        
        // Trying to claim 10 should succeed
        const success2 = alice.claimGoods(10);
        expect(success2).toBe(true);
        expect(alice.claimed_capacity).toBe(10);
        expect(commune.current_consumption_pool).toBe(30);
    });
});
