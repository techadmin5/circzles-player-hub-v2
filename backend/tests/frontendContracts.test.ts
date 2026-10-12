import { describe, expect, it } from "vitest";
import type { AdminSubmissionDto as BackendDto } from "../src/domain/adminSubmissions.js";
import type { AdminSubmissionDto as FrontendDto } from "../../src/types/adminSubmissions.js";
// Dates are serialized by Fastify; optional fields/nullability must match exactly.
type JsonTransport<T> = T extends Date ? string : T extends object ? { [K in keyof T]: JsonTransport<T[K]> } : T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const contractMatches: Equal<JsonTransport<BackendDto>, FrontendDto> = true;
describe("frontend-safe API contracts", () => {
  it("matches the complete admin submission JSON response, including serialized review timestamps", () => {
    expect(contractMatches).toBe(true);
  });
});
