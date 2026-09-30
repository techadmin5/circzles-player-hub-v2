import assert from "node:assert/strict";
import test from "node:test";
import { parseWixAuthorizationCallback } from "./wixAuthCallback.ts";

test("parses a Wix Google fragment success callback", () => {
  assert.deepEqual(parseWixAuthorizationCallback({ hash: "#code=authorization-code&state=signed-state", search: "" }), {
    code: "authorization-code",
    state: "signed-state",
  });
});

test("parses and normalizes a Wix fragment error callback", () => {
  assert.deepEqual(parseWixAuthorizationCallback({ hash: "#error=unknown_error&error_description=provider+detail&state=signed-state", search: "" }), {
    error: "unknown_error",
    errorDescription: "provider detail",
    state: "signed-state",
  });
});

test("keeps email query-mode callbacks supported", () => {
  assert.deepEqual(parseWixAuthorizationCallback({ hash: "", search: "?code=email-code&state=signed-state" }), {
    code: "email-code",
    state: "signed-state",
  });
});

test("rejects missing state, ambiguous results, duplicate values, and unknown fields", () => {
  const malformed = [
    { hash: "#code=code", search: "" },
    { hash: "#code=code&error=unknown_error&state=state", search: "" },
    { hash: "#code=one&code=two&state=state", search: "" },
    { hash: "#error=unknown_error&state=state&unexpected=value", search: "" },
  ];
  for (const input of malformed) assert.throws(() => parseWixAuthorizationCallback(input), /Invalid Wix authentication callback/);
});
