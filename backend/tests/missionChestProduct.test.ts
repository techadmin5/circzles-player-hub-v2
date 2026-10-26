import { it,expect } from "vitest";
import { missionChestProductPolicy as policy } from "../src/config/missionChestProduct.js";
import { CLAIM_GRACE_MS,periodBounds,periodKeyFor } from "../src/domain/missionLifecycle.js";
import type { ChestProductPolicy } from "../../src/types/missionChests.js";
it("initial release has exactly the user-approved reward amounts, requirements and separate approval contract",()=>{
 const frontend:ChestProductPolicy=policy;
 expect(frontend.scope).toBe("PRODUCT_TEMPLATE_ONLY");expect(policy.periods.DAILY).toMatchObject({selectable:5,required:3,xp:50,synapsePoints:100});
 expect(policy.periods.WEEKLY).toMatchObject({selectable:6,required:4,xp:200,synapsePoints:250});
 expect(policy.requiresRecordedProductApproval&&policy.requiresRecordedRewardBudgetApproval&&policy.manualClaims).toBe(true);
 expect(policy.claimGraceHours*3600000).toBe(CLAIM_GRACE_MS);
});
it("approved template keeps UTC midnight and ISO Monday boundaries across year rollover",()=>{
 const sunday=new Date("2027-01-03T23:59:59.999Z"),monday=new Date("2027-01-04T00:00:00Z");
 expect(periodKeyFor("DAILY",sunday,"x")).toBe("2027-01-03");expect(periodKeyFor("DAILY",monday,"x")).toBe("2027-01-04");
 expect(periodKeyFor("WEEKLY",sunday,"x")).toBe("2026-W53");expect(periodKeyFor("WEEKLY",monday,"x")).toBe("2027-W01");
 expect(periodBounds("WEEKLY","2027-W01","x").start?.toISOString()).toBe(monday.toISOString());
});
