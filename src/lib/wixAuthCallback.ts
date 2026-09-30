export type WixAuthorizationCallback =
  | { code: string; state: string }
  | { error: string; errorDescription?: string; state: string };

const SUCCESS_FIELDS = new Set(["code", "state"]);
const ERROR_FIELDS = new Set(["error", "error_description", "state"]);

export function parseWixAuthorizationCallback(input: { hash: string; search: string }): WixAuthorizationCallback {
  const encoded = input.hash.length > 1
    ? input.hash.slice(1)
    : input.search.startsWith("?") ? input.search.slice(1) : input.search;
  const params = new URLSearchParams(encoded);
  const code = singleValue(params, "code");
  const error = singleValue(params, "error");
  const state = singleValue(params, "state");

  if (!state || Boolean(code) === Boolean(error)) throw invalidCallback();
  const allowed = code ? SUCCESS_FIELDS : ERROR_FIELDS;
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw invalidCallback();
  }

  if (code) return { code, state };
  const errorDescription = singleValue(params, "error_description");
  return errorDescription ? { error: error!, errorDescription, state } : { error: error!, state };
}

function singleValue(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) throw invalidCallback();
  const value = values[0]?.trim();
  return value || undefined;
}

function invalidCallback() {
  return new Error("Invalid Wix authentication callback.");
}
