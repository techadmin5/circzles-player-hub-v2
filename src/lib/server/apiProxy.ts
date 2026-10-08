import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const hopByHop = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
const noStore = "private, no-store, no-cache, max-age=0, must-revalidate";

function endToEndHeaders(source: Headers) {
  const headers = new Headers(source);
  for (const name of (source.get("connection") ?? "").split(",")) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of hopByHop) headers.delete(name);
  return headers;
}

type ProxyOptions = {
  origin?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  log?: (entry: Record<string, unknown>) => void;
};

// Node-only module: environment configuration is read on the server per request.
// The factory permits transport-level tests without contacting production auth.
export function createApiProxy(options: ProxyOptions = {}) {
  return async function proxy(request: Request): Promise<Response> {
    const proxyId = randomUUID();
    const started = Date.now();
    const log = (event: string, fields: Record<string, unknown> = {}) =>
      (options.log ?? ((entry) => console.info(JSON.stringify(entry))))({
        component: "api-proxy", event, proxyId, method: request.method,
        elapsedMs: Date.now() - started, ...fields,
      });
    const failure = (status: number, code: string, message: string) => Response.json(
      { code, message, requestId: proxyId },
      { status, headers: { "Cache-Control": noStore, "X-Request-Id": proxyId, "X-Proxy-Request-Id": proxyId } },
    );

    let target: URL;
    try {
      const origin = new URL((options.origin ?? process.env.PLAYER_HUB_API_ORIGIN ?? "").trim());
      if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password
        || origin.pathname !== "/" || origin.search || origin.hash
        || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) throw new Error("Invalid origin");
      const incoming = new URL(request.url);
      if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
        return failure(400, "PROXY_INVALID_PATH", "Invalid API path.");
      }
      // Assign path/query to a fixed origin; never resolve user input as a URL.
      target = new URL(origin.origin);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
    } catch {
      log("proxy_configuration_error");
      return failure(503, "PROXY_CONFIGURATION_ERROR", "API proxy is not configured.");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 50_000);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    let attempt = 0;
    let phase = "request";
    let streaming = false;
    const cleanup = () => { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); };
    try {
      const headers = endToEndHeaders(request.headers);
      headers.delete("x-player-hub-proxy-secret");
      headers.delete("x-player-hub-client-ip");
      const proxySecret = process.env.PLAYER_HUB_PROXY_SECRET;
      if (proxySecret) {
        headers.set("x-player-hub-proxy-secret", proxySecret);
        // Vercel overwrites X-Forwarded-For. Trust it only when running on Vercel.
        const clientIp = process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
        if (clientIp && isIP(clientIp)) headers.set("x-player-hub-client-ip", clientIp);
      }
      // Fetch supplies Host/framing. Do not trust client forwarding metadata.
      for (const name of [...headers.keys()]) {
        if (["host", "content-length", "expect", "forwarded", "accept-encoding"].includes(name)
          || name.startsWith("x-forwarded-")) headers.delete(name);
      }
      headers.set("accept-encoding", "identity");
      if (!headers.has("x-request-id")) headers.set("x-request-id", proxyId);
      const safe = request.method === "GET" || request.method === "HEAD";
      // The legacy GET auth callback consumes a one-use code despite its method.
      // Only the session read and authorization-start routes may retry under auth.
      let retryAllowed = false;
      try {
        const path = decodeURIComponent(target.pathname).toLowerCase().replace(/\/{2,}/g, "/");
        retryAllowed = safe && (!path.startsWith("/api/auth/")
          || ["/api/auth/session", "/api/auth/google/start", "/api/auth/direct/google/start"].includes(path));
      } catch { /* Malformed encoded paths are forwarded once, never replayed. */ }
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method, headers, cache: "no-store", redirect: "manual", signal: controller.signal,
        // Stream once; mutation bodies are never buffered for replay.
        ...(safe || !request.body ? {} : { body: request.body, duplex: "half" }),
      };

      while (true) {
        controller.signal.throwIfAborted();
        attempt++;
        phase = "headers";
        let upstream: Response;
        try {
          upstream = await (options.fetch ?? fetch)(target, init);
        } catch (error) {
          log("proxy_transport_failure", { attempt, phase, timedOut, clientAborted: request.signal.aborted });
          if (!retryAllowed || attempt > 1 || controller.signal.aborted) throw error;
          log("proxy_retry", { attempt, reason: "network" });
          await delay(options.retryDelayMs ?? 1000, undefined, { signal: controller.signal });
          continue;
        }

        const transient = upstream.status === 502 || upstream.status === 503;
        log(transient ? "upstream_unavailable" : upstream.status >= 400 ? "upstream_http_error" : "upstream_response", {
          attempt, status: upstream.status,
          upstreamRequestId: upstream.headers.get("x-request-id")?.slice(0, 128) ?? null,
          contentType: upstream.headers.get("content-type")?.slice(0, 128) ?? null,
        });
        if (retryAllowed && attempt === 1 && transient && !controller.signal.aborted) {
          // Cancel before reading bytes; never retry once body consumption starts.
          await upstream.body?.cancel();
          log("proxy_retry", { attempt, reason: `upstream_${upstream.status}` });
          await delay(options.retryDelayMs ?? 1000, undefined, { signal: controller.signal });
          continue;
        }

        // Only this authenticated, bounded SSE endpoint bypasses JSON buffering.
        if (request.method === "GET" && target.pathname === "/api/me/events" && upstream.status === 200
          && upstream.headers.get("content-type")?.split(";")[0].trim() === "text/event-stream" && upstream.body) {
          const reader = upstream.body.getReader();
          const responseHeaders = endToEndHeaders(upstream.headers);
          for (const name of ["content-length", "content-encoding", "cdn-cache-control", "vercel-cdn-cache-control"]) responseHeaders.delete(name);
          responseHeaders.set("cache-control", `${noStore}, no-transform`);
          responseHeaders.set("x-accel-buffering", "no");
          responseHeaders.set("x-proxy-request-id", proxyId);
          const body = new ReadableStream<Uint8Array>({
            async pull(stream) {
              try {
                const chunk = await reader.read();
                if (chunk.done) { cleanup(); stream.close(); }
                else stream.enqueue(chunk.value);
              } catch (error) { cleanup(); controller.abort(); stream.error(error); }
            },
            async cancel() { controller.abort(); cleanup(); await reader.cancel().catch(() => undefined); },
          });
          streaming = true;
          return new Response(body, { status: 200, headers: responseHeaders });
        }

        phase = "body";
        // Buffer API responses so body failures/timeouts remain explicit proxy errors.
        // Large binary uploads already go directly to the signed storage endpoint.
        const body = request.method === "HEAD" || [204, 205, 304].includes(upstream.status)
          ? null : await upstream.arrayBuffer();
        controller.signal.throwIfAborted();
        const responseHeaders = endToEndHeaders(upstream.headers);
        // Node fetch decodes compressed responses, even if the upstream ignores identity.
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        const cookies = responseHeaders.getSetCookie();
        responseHeaders.delete("set-cookie");
        for (const cookie of cookies) responseHeaders.append("set-cookie", cookie);
        responseHeaders.set("cache-control", noStore);
        responseHeaders.set("pragma", "no-cache");
        responseHeaders.delete("cdn-cache-control");
        responseHeaders.delete("vercel-cdn-cache-control");
        responseHeaders.set("x-proxy-request-id", proxyId);
        log("proxy_complete", { attempt, status: upstream.status });
        return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      }
    } catch {
      log("proxy_failure", { attempt, phase, timedOut, clientAborted: request.signal.aborted });
      if (timedOut) return failure(504, "PROXY_UPSTREAM_TIMEOUT", "API upstream timed out.");
      if (request.signal.aborted) return failure(499, "PROXY_CLIENT_ABORTED", "API request was cancelled.");
      return failure(502, "PROXY_UPSTREAM_UNREACHABLE", "API upstream response could not be received.");
    } finally {
      if (!streaming) cleanup();
    }
  };
}

export const proxyApiRequest = createApiProxy();
