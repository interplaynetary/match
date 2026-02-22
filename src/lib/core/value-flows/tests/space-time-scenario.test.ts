import { expect, test, describe } from "bun:test";
import {
    computeScenarioId,
    commitmentSignature,
    scoreScenario,
    addScenarioToIndex,
    mergeScenarios,
    type ScenarioIndex,
    type Scenario
} from "../utils/space-time-scenario";
import type { Commitment, Process, SpatialThing, Intent } from "../schemas";
import type { IndependentDemandIndex } from "../indexes/independent-demand";
import { createHexIndex } from "../utils/space-time-index";

describe("ScenarioIndex and Scenario Logic", () => {

    test("commitmentSignature and computeScenarioId generate deterministic hashes", () => {
        const c1: Commitment = {
            id: "c1",
            action: "produce",
            resourceConformsTo: "spec:wheat",
            resourceQuantity: { hasNumericalValue: 100, hasUnit: "kg" },
            finished: false
        };

        const c2: Commitment = {
            id: "c2",
            action: "work",
            effortQuantity: { hasNumericalValue: 10, hasUnit: "hours" },
            finished: false
        };

        const loc: SpatialThing = { id: "loc1", lat: 51.5, long: -0.1 };
        
        const sig1 = commitmentSignature(c1, loc, 9);
        const sig2 = commitmentSignature(c2, loc, 9);

        // scenarioId is order-independent
        const idA = computeScenarioId([sig1, sig2]);
        const idB = computeScenarioId([sig2, sig1]);

        expect(idA).toBe(idB);

        // Different content -> different hash
        const c3: Commitment = { ...c1, action: "consume" };
        const sig3 = commitmentSignature(c3, loc, 9);
        const idC = computeScenarioId([sig1, sig3]);
        
        expect(idA).not.toBe(idC);
    });

    test("scoreScenario correctly calculates coverage and effort", () => {
        const c1: Commitment = {
            id: "c1",
            action: "produce",
            effortQuantity: { hasNumericalValue: 5, hasUnit: "hours" },
            finished: false,
            satisfies: "c1_req"
        };
        const c2: Commitment = {
            id: "c2",
            action: "work",
            effortQuantity: { hasNumericalValue: 10, hasUnit: "hours" },
            finished: false,
            satisfies: "c2_req"
        };

        const scenario: Scenario = {
            id: "s1",
            processes: new Map(),
            commitments: new Map([["c1", c1], ["c2", c2]]),
            deficits: [
                { intent_id: "i1", spec_id: "specA", action: "consume", required_quantity: 10, required_hours: 0, remaining_quantity: 10, remaining_hours: 0, h3_cell: "node1", due: "2024-01-01" },
            ],
            surpluses: [
                { spec_id: "specC", quantity: 50 }
            ],
            score: { coverage: 0, intents_satisfied: 0, intents_total: 0, total_effort_hours: 0, deficit_specs: [], h3_depth: 1 },
            origin_cell: "89283082803ffff",
            resolution: 9
        };

        const intents: Intent[] = [
            { id: "i1", action: "consume", finished: false },
            { id: "i2", action: "consume", finished: false },
            { id: "c1_req", action: "consume", finished: false },
            { id: "c2_req", action: "consume", finished: false }
        ];

        const score = scoreScenario(scenario, intents);

        // 4 total intents in scope
        // 2 satisfied
        expect(score.intents_total).toBe(4);
        expect(score.intents_satisfied).toBe(2);
        expect(score.coverage).toBe(2 / 4);
        expect(score.total_effort_hours).toBe(15); // 5 + 10
        expect(score.deficit_specs).toEqual(["specA"]);
    });

    test("mergeScenarios combines transfers correctly", () => {
        const pA: Process = {
            id: "pA",
            name: "processA",
            basedOn: "specA",
            finished: false,
        };

        const sA: Scenario = {
            id: "sA",
            processes: new Map([["pA", pA]]),
            commitments: new Map(),
            deficits: [
                { intent_id: "i_bread", spec_id: "spec:bread", action: "consume", required_quantity: 10, required_hours: 0, remaining_quantity: 10, remaining_hours: 0, h3_cell: "89283082803ffff", due: "2024-01-01" },
            ],
            surpluses: [],
            score: { coverage: 0, intents_satisfied: 0, intents_total: 0, total_effort_hours: 0, deficit_specs: [], h3_depth: 1 },
            origin_cell: "89283082803ffff",
            resolution: 9
        };

        const pB: Process = {
            id: "pB",
            name: "processB",
            basedOn: "specB",
            finished: false,
        };

        const sB: Scenario = {
            id: "sB",
            processes: new Map([["pB", pB]]),
            commitments: new Map(),
            deficits: [],
            surpluses: [
                { spec_id: "spec:bread", quantity: 50 }
            ] as any, // bypassing strict types for test
            score: { coverage: 0, intents_satisfied: 0, intents_total: 0, total_effort_hours: 0, deficit_specs: [], h3_depth: 1 },
            origin_cell: "89283082803ffff", // Same location for easy common parent
            resolution: 9
        };

        const locations = new Map<string, SpatialThing>([
            ["locA", { id: "locA", lat: 51.5, long: -0.1 }],
            ["locB", { id: "locB", lat: 51.5, long: -0.1 }]
        ]);

        let idCount = 0;
        const result = mergeScenarios(sA, sB, 8, locations, () => `rand_id_${idCount++}`);
        
        if ("type" in result) {
            throw new Error(`Merge failed with conflict: ${JSON.stringify(result)}`);
        }

        const mergedScenario = result;
        
        expect(mergedScenario.deficits.length).toBe(0);
        expect(mergedScenario.surpluses.length).toBe(1);
        expect(mergedScenario.surpluses[0].quantity).toBe(40);
        
        const commitments = Array.from(mergedScenario.commitments.values());
        expect(commitments.length).toBe(2); // one in, one out
        expect(commitments[0].action).toBe("transfer");
        expect(commitments[0].resourceQuantity?.hasNumericalValue).toBe(10);
        expect(commitments[1].action).toBe("transfer");
        expect(commitments[1].resourceQuantity?.hasNumericalValue).toBe(10);
        
        // One should satisfy the deficit intent
        const satisfiesBread = commitments.find(c => c.satisfies === "i_bread");
        expect(satisfiesBread).toBeDefined();
    });
});
