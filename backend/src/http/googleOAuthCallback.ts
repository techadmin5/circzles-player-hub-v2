import { z } from "zod";
import { validationFailed } from "../domain/errors.js";

const callbackFields = ["state", "code", "error", "error_description", "error_uri", "iss"] as const;
const errorText = /^[\x20-\x21\x23-\x5B\x5D-\x7E]*$/;
const callbackSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().min(1).max(256).regex(errorText).optional(),
  error_description: z.string().max(1024).regex(errorText).optional(),
  // RFC 6749 permits a URI-reference; diagnostic only, never fetched or used as a redirect.
  error_uri: z.string().min(1).max(2048).regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/).optional(),
  iss: z.literal("https://accounts.google.com").optional(),
}).strict().refine((value) => (value.code !== undefined) !== (value.error !== undefined));

export type GoogleOAuthCallback =
  | { state: string; code: string }
  | { state: string; error: string; error_description?: string; error_uri?: string };

/** Parse the original request URL, before query-object normalization can hide duplicates. */
export function parseGoogleOAuthCallback(rawUrl: string): GoogleOAuthCallback {
  const queryStart = rawUrl.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : rawUrl.slice(queryStart + 1));
  const selected: Partial<Record<typeof callbackFields[number], string>> = {};
  for (const field of callbackFields) {
    const values = params.getAll(field);
    if (values.length > 1) throw validationFailed("Invalid authentication request.");
    if (values.length === 1) selected[field] = values[0];
  }
  // RFC 6749 section 4.1.2: ignore unrecognized response parameters. They never enter the result.
  const parsed = callbackSchema.safeParse(selected);
  if (!parsed.success) throw validationFailed("Invalid authentication request.");
  const value = parsed.data;
  // RFC 9207 iss is checked above, but is not identity proof or input to account linking.
  if (value.code !== undefined) return { state: value.state, code: value.code };
  return {
    state: value.state,
    error: value.error!,
    ...(value.error_description !== undefined ? { error_description: value.error_description } : {}),
    ...(value.error_uri !== undefined ? { error_uri: value.error_uri } : {}),
  };
}
