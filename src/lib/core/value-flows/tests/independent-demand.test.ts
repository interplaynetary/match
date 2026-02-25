import { expect, test, describe } from "bun:test";
import { buildIndependentDemandIndex, queryDemandBySpecAndLocation, queryPlanDemands, queryOpenDemands } from "../indexes/independent-demand";
import type { Intent, Commitment, EconomicEvent, SpatialThing } from "../schemas";

describe("IndependentDemandIndex", () => {
    test("buildIndependentDemandIndex properly handles satisfied and unsatisfied intents", () => {
        const intents: Intent[] = [
            {
                id: "intent1",
                action: "consume",
                resourceConformsTo: "spec:wheat",
                resourceQuantity: { hasNumericalValue: 100, hasUnit: "kg" },
                finished: false
            },
            {
                id: "intent2",
                action: "consume",
                resourceConformsTo: "spec:flour",
                resourceQuantity: { hasNumericalValue: 50, hasUnit: "kg" },
                finished: false
            },
            {
                id: "intent3",
                action: "work",
                effortQuantity: { hasNumericalValue: 8, hasUnit: "hours" },
                finished: true // should be skipped
            }
        ];

        // commitment satisfies 40kg of intent1
        const commitments: Commitment[] = [
            {
                id: "c1",
                action: "consume",
                satisfies: "intent1",
                resourceQuantity: { hasNumericalValue: 40, hasUnit: "kg" },
                finished: false
            }
        ];

        // event satisfies remaining 60kg of intent1 and 10kg of intent2
        const events: EconomicEvent[] = [
            {
                id: "e1",
                action: "consume",
                satisfies: "intent1",
                resourceQuantity: { hasNumericalValue: 60, hasUnit: "kg" }
            },
            {
                id: "e2",
                action: "consume",
                satisfies: "intent2",
                resourceQuantity: { hasNumericalValue: 10, hasUnit: "kg" }
            }
        ];

        const locations = new Map<string, SpatialThing>();

        const index = buildIndependentDemandIndex(intents, commitments, events, locations, 7);

        // intent3 is finished → excluded; intent1 fully satisfied + intent2 partially satisfied → both in demands
        expect(index.demands.size).toBe(2);

        // intent1: fully satisfied — still in demands, remaining=0
        const slot1 = index.demands.get("intent1");
        expect(slot1).toBeDefined();
        expect(slot1?.required_quantity).toBe(100);
        expect(slot1?.fulfilled_quantity).toBe(100);
        expect(slot1?.remaining_quantity).toBe(0);

        // intent2: partially satisfied — in demands with remaining quantity
        const slot2 = index.demands.get("intent2");
        expect(slot2).toBeDefined();
        expect(slot2?.required_quantity).toBe(50);
        expect(slot2?.fulfilled_quantity).toBe(10);
        expect(slot2?.remaining_quantity).toBe(40); // 50 - 10
        expect(slot2?.spec_id).toBe("spec:flour");

        // queryOpenDemands returns only intent2 (intent1 is fully satisfied)
        const open = queryOpenDemands(index);
        expect(open).toHaveLength(1);
        expect(open[0].intent_id).toBe("intent2");

        // Verify sub-indexes
        expect(index.spec_index.get("spec:flour")?.has("intent2")).toBe(true);
        expect(index.action_index.get("consume")?.has("intent2")).toBe(true);
    });

    test("queryDemandBySpecAndLocation returns demands within radius", () => {
        const intents: Intent[] = [
            {
                id: "intent1",
                action: "consume",
                resourceConformsTo: "spec:wood",
                resourceQuantity: { hasNumericalValue: 10, hasUnit: "ea" },
                atLocation: "loc1",
                finished: false
            },
            {
                id: "intent2",
                action: "consume",
                resourceConformsTo: "spec:wood",
                resourceQuantity: { hasNumericalValue: 5, hasUnit: "ea" },
                atLocation: "loc2",
                finished: false
            }
        ];

        // Let's mock locations
        const locations = new Map<string, SpatialThing>([
            ["loc1", { id: "loc1", lat: 51.5074, long: -0.1278 }], // London
            ["loc2", { id: "loc2", lat: 48.8566, long: 2.3522 }]   // Paris
        ]);

        const index = buildIndependentDemandIndex(intents, [], [], locations, 4);

        // Query near London (radius 100km)
        const londonResults = queryDemandBySpecAndLocation(index, "spec:wood", {
            latitude: 51.5074,
            longitude: -0.1278,
            radius_km: 100
        });

        expect(londonResults.length).toBe(1);
        expect(londonResults[0].intent_id).toBe("intent1");

        // Query near Paris (radius 100km)
        const parisResults = queryDemandBySpecAndLocation(index, "spec:wood", {
            latitude: 48.8566,
            longitude: 2.3522,
            radius_km: 100
        });

        expect(parisResults.length).toBe(1);
        expect(parisResults[0].intent_id).toBe("intent2");
    });
    
    test("plan demand index tracks independentDemandOf", () => {
        const commitments: Commitment[] = [
            {
                id: "c1",
                action: "produce",
                independentDemandOf: "planA",
                finished: false
            },
            {
                id: "c2",
                action: "produce",
                independentDemandOf: "planA",
                finished: false
            },
            {
                id: "c3",
                action: "produce",
                independentDemandOf: "planB",
                finished: false
            }
        ];
        
        const index = buildIndependentDemandIndex([], commitments, [], new Map(), 7);
        
        const planAdemands = queryPlanDemands(index, "planA");
        expect(planAdemands.length).toBe(2);
        expect(planAdemands).toContain("c1");
        expect(planAdemands).toContain("c2");
        
        const planBdemands = queryPlanDemands(index, "planB");
        expect(planBdemands.length).toBe(1);
        expect(planBdemands).toContain("c3");
    });
});
