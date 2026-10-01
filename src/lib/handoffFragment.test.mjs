import assert from "node:assert/strict";
import test from "node:test";
import { handoffFragmentFreeUrl, readHandoffFromHash } from "./handoffFragment.ts";

test("reads the handoff token from the fragment", () => {
  assert.equal(readHandoffFromHash("#handoff=aaa.bbb.ccc"), "aaa.bbb.ccc");
});

test("returns null when the fragment is empty or has no handoff", () => {
  assert.equal(readHandoffFromHash(""), null);
  assert.equal(readHandoffFromHash("#"), null);
  assert.equal(readHandoffFromHash("#other=1"), null);
  assert.equal(readHandoffFromHash("#handoff="), null);
});

test("does not read a handoff from the query string form", () => {
  assert.equal(readHandoffFromHash("?handoff=abc.def.ghi"), null);
});

test("rejects oversized values before they reach the API", () => {
  assert.equal(readHandoffFromHash(`#handoff=${"a".repeat(8193)}`), null);
});

test("cleanup URL carries neither fragment nor query", () => {
  assert.equal(handoffFragmentFreeUrl("/auth/handoff"), "/auth/handoff");
});
