import { expect, test, describe } from "bun:test";
import { PlanStore } from "../planning/planning";
import { RecipeStore } from "../knowledge/recipes";
import { ProcessRegistry } from "../process-registry";

describe("PlanStore and Recipe Instantiation", () => {
    test("addPlan, addIntent, addCommitment correctly stores entities", () => {
        const registry = new ProcessRegistry();
        const store = new PlanStore(registry, () => "mock_id");

        const plan = store.addPlan({ name: "Test Plan" });
        expect(plan.id).toBe("mock_id");
        expect(store.getPlan("mock_id")).toBeDefined();

        const intent = store.addIntent({ action: "consume", plannedWithin: plan.id, finished: false });
        expect(intent.id).toBe("mock_id");
        expect(store.intentsForPlan("mock_id").length).toBe(1);

        const commitment = store.addCommitment({ action: "consume", plannedWithin: plan.id, finished: false });
        expect(commitment.id).toBe("mock_id");
        expect(store.allCommitments().length).toBe(1);
    });

    test("publishOffer and publishRequest create Intents and Proposals", () => {
        const r = new ProcessRegistry();
        let idCount = 0;
        const store = new PlanStore(r, () => `id_${idCount++}`);

        const offer = store.publishOffer({
            provider: "alice",
            action: "produce",
            resourceConformsTo: "spec:apples",
            resourceQuantity: { hasNumericalValue: 10, hasUnit: "kg" }
        });

        expect(offer.proposal.purpose).toBe("offer");
        expect(offer.primaryIntent.provider).toBe("alice");
        expect(offer.primaryIntent.action).toBe("produce");
        expect(store.offers().length).toBe(1);

        const req = store.publishRequest({
            receiver: "bob",
            action: "consume",
            resourceConformsTo: "spec:apples"
        });

        expect(req.proposal.purpose).toBe("request");
        expect(req.primaryIntent.receiver).toBe("bob");
        expect(store.requests().length).toBe(1);
    });

    test("instantiateRecipe scales inputs/outputs and schedules processes", () => {
        const r = new ProcessRegistry();
        let idCount = 0;
        const store = new PlanStore(r, () => `id_${idCount++}`);
        const recipes = new RecipeStore(() => `rid_${idCount++}`);

        const bakeProcess = recipes.addRecipeProcess({
            name: "Baking",
            processConformsTo: "proc:bake",
            hasDuration: { hasNumericalValue: 2, hasUnit: "hours" }
        });

        const recipe = recipes.addRecipe({
            name: "Bake Bread",
            primaryOutput: "spec:bread",
            recipeProcesses: [bakeProcess.id]
        });

        recipes.addRecipeFlow({
            recipeInputOf: bakeProcess.id,
            action: "consume",
            resourceConformsTo: "spec:flour",
            resourceQuantity: { hasNumericalValue: 1, hasUnit: "kg" }
        });
        recipes.addRecipeFlow({
            recipeOutputOf: bakeProcess.id,
            action: "produce",
            resourceConformsTo: "spec:bread",
            resourceQuantity: { hasNumericalValue: 2, hasUnit: "ea" } // 1kg flour = 2 breads
        });

        const dueDate = new Date("2024-01-01T12:00:00Z");

        // Instantiate for 10 breads.
        // Scale factor should be 10 / 2 = 5.
        // Need 5kg of flour.
        const result = store.instantiateRecipe(recipes, recipe.id, 10, dueDate);

        expect(result.plan).toBeDefined();
        expect(result.processes.length).toBe(1);
        
        // 2 hours before dueDate
        const proc = result.processes[0];
        expect(new Date(proc.hasBeginning!).getTime()).toBe(new Date("2024-01-01T10:00:00Z").getTime());
        expect(new Date(proc.hasEnd!).getTime()).toBe(new Date("2024-01-01T12:00:00Z").getTime());

        // We expect Intents to be created because no agents were assigned
        // so they are "unassigned flows" -> Intents
        expect(result.intents.length).toBe(2);

        const consumeIntent = result.intents.find(i => i.action === "consume");
        const produceIntent = result.intents.find(i => i.action === "produce");

        // Scaled to 5kg
        expect(consumeIntent?.resourceQuantity?.hasNumericalValue).toBe(5);
        expect(produceIntent?.resourceQuantity?.hasNumericalValue).toBe(10);
    });
});
