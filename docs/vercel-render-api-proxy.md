# Vercel to Render API proxy

## Evidence and scope

The supplied production incident records:

- `https://circzles-player-hub.vercel.app/api/auth/direct/google/start?returnTo=%2Fhub` returned **502**, `Content-Type: text/html`, with Render's service-unavailable page.
- An immediately subsequent request to `https://circzles-player-hub-api.onrender.com/api/auth/direct/google/start?returnTo=%2Fhub` returned **200 JSON** containing `authorizationUrl`.
- That URL used the expected manual Headless client `0f850045-e571-423a-902d-576630d7b222`, code response, fragment mode, Vercel callback URI, PKCE S256, Google IDP, and a session token.

This isolates the observed failure to the proxied request path and demonstrates that the backend could create a redirect session on the next direct request. It does **not** establish whether the earlier failure was a Render cold start, transient routing failure, or a Vercel transport issue. These were sequential requests, not a controlled simultaneous comparison. The original incident was not independently reproduced during this implementation. No Wix configuration or authentication logic changes are included, and Google login is not claimed fixed.

## Old and new proxy

Previously `next.config.ts` rewrote `/api/:path*` to the backend. The target used `PLAYER_HUB_API_ORIGIN` with a public-variable fallback. Rewrites are valid URL proxies, but the existing implementation had no application-owned failure classification, timeout policy, or limited retry policy.

The rewrite is removed. `src/app/api/[[...path]]/route.ts` now handles `/api` and every nested API path using the Node runtime, force-dynamic rendering, and a 60-second function duration. It forwards all seven supported HTTP methods through `src/lib/server/apiProxy.ts`. The upstream origin is read from server-only `PLAYER_HUB_API_ORIGIN` at runtime, requires HTTPS in production, and rejects credentials, paths, queries, fragments, and non-HTTP protocols. There is no public-variable fallback.

The handler retains method, encoded query, body, cookies, content type, application headers, response status/body, and request IDs. Incoming forwarding metadata and hop-by-hop headers (including Connection-nominated fields) are removed. Fetch supplies upstream Host and framing. Redirects are returned without server-side following. Response encoding/length headers are removed because Node fetch decompresses bodies. Cache and CDN cache headers cannot enable caching. Complete API responses are buffered so an interrupted or timed-out body can produce an explicit proxy error before sending headers.

The fixed upstream origin cannot be overridden by the request path, query, Host, or forwarded headers. Production frontend calls already use an empty API base and `credentials: "include"`. `NEXT_PUBLIC_API_BASE_URL` remains a development-only browser setting in `src/config/dataMode.ts`; that behavior is unchanged.

## Retry and timeout policy

- One shared **50-second deadline** covers upstream headers, body consumption, and retry delay. It does not restart for a second attempt.
- Eligible GET/HEAD requests may retry **once**, after one second, for a fetch/network failure or upstream **502/503**. The rejected response body is cancelled before reading it.
- Within `/api/auth/`, only `/api/auth/session` and `/api/auth/direct/google/start` are eligible. The existing GET callback consumes a one-use code and is explicitly excluded, including percent-encoded paths. Retrying authorization start can create an unused redirect session, but does not exchange a code or establish a player session.
- POST, PUT, PATCH, DELETE, OPTIONS, timeouts, client cancellations, and body-read failures are never replayed. Idempotency headers do not enable mutation retries.
- A persistent 502/503 retains the final upstream status, body, content type, and response headers. Other HTTP errors, including 401 and application 4xx/5xx, are immediately preserved.
- Only failures without a complete upstream response generate proxy JSON: `PROXY_UPSTREAM_UNREACHABLE` (502), `PROXY_UPSTREAM_TIMEOUT` (504), `PROXY_CLIENT_ABORTED` (499), or `PROXY_CONFIGURATION_ERROR` (503).

## Cookie/session review

Each `Set-Cookie` is forwarded separately and unchanged, including expiry commas and deletion cookies. No Domain attribute is added. The browser receives it from the Vercel origin, so a host-only `cz_session` remains first-party there and is forwarded in subsequent upstream requests. The backend already enforces host-only, Secure, SameSite=Lax production settings and sets HttpOnly; these controls remain unchanged. No token is moved into browser JavaScript, and credentials/cookies/bodies/query strings are not logged.

## Diagnostics

Structured JSON logs include `component=api-proxy`, a generated `proxyId`, method, elapsed time, attempt, and relevant status/phase. The response includes `X-Proxy-Request-Id`; an existing upstream `X-Request-Id` is preserved. If the incoming request has no request ID, the proxy supplies one upstream.

- `proxy_transport_failure` / `proxy_failure`: failure in receiving a complete response, with timeout and client-abort flags.
- `upstream_unavailable`: an upstream 502/503 actually arrived; includes status, content type, and upstream request ID when available.
- `upstream_http_error`: other upstream HTTP errors, such as application JSON 401/422/500.
- `proxy_retry`, `upstream_response`, `proxy_complete`, and `proxy_configuration_error`: retry, success, completion, and configuration diagnostics.

An HTTP status alone cannot prove that Render's edge generated a response. Use content type and request IDs to correlate Vercel logs with Render/backend logs. No raw error messages, URL queries, request/response bodies, or credential headers are logged.

## Validation

- `npm test`: 44 passed (40 proxy tests plus 4 existing frontend auth callback tests).
- Real local Node HTTP transport test: POST bytes, multiple cookies, gzip decoding.
- `npm run lint` and `npm run build` in the frontend; build includes TypeScript checking.
- `npm test`, `npm run typecheck`, and `npm run lint` in `backend`: 561 tests across 34 files passed; typecheck and lint passed.
- `git diff --check`.

## Deployment

1. Review branch `fix/vercel-render-api-proxy`; it is not merged by this task.
2. Set `PLAYER_HUB_API_ORIGIN=https://circzles-player-hub-api.onrender.com` in the intended Vercel environment, available at function runtime. Keep `NEXT_PUBLIC_DATA_MODE=api`. Do not change Wix client/IDP/auth settings. Production does not need a public backend URL.
3. Deploy the branch to a Vercel preview. Confirm the API function has the configured 60-second maximum duration and the deployment has no competing external `/api/*` rewrite.
4. Check `/api/auth/session` without a cookie: the backend's JSON 401 must remain 401. Check authorization start: when healthy, it must return JSON through the Vercel origin. Inspect headers and correlate proxy logs. Do not log or publish authorization URLs or cookie values.
5. On the approved production deployment, verify callback Set-Cookie flags and subsequent authenticated same-origin requests using an authorized test account. Preview URLs may not be allowed by existing auth configuration; this task does not change redirect allowlists.
6. For a failed GET, confirm at most two upstream attempts. For a failed POST callback/login/signup, confirm one attempt. Check that persistent upstream errors remain visible. Promote only through the repository's normal review/deployment process.

## Remaining risks

- Render Free services can spin down after inactivity and take about a minute to restart; a 50-second deadline and one short retry cannot guarantee availability. Existing browser session/email auth timeouts remain 20 seconds. Reliable cold-start-free service requires a hosting/runtime decision outside this proxy patch. See [Render Free services](https://render.com/docs/free).
- Vercel Functions impose payload and duration limits; buffered API responses must fit the platform's 4.5 MB request/response ceiling. Existing large video uploads use signed direct storage uploads. See [Vercel Function limits](https://vercel.com/docs/functions/limitations).
- A network error can occur after the backend accepted a mutation. The proxy does not replay it; the existing UI must reconcile session/action state before a user retries.
- The actual production transport failure and end-to-end Google login must still be validated after deployment. This branch adds controlled forwarding and diagnostics, not evidence of a deployed resolution.
