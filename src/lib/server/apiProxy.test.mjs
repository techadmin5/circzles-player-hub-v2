import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createApiProxy } from "./apiProxy.ts";

const origin = "https://backend.example";
const request = (path = "/api/me", init) => new Request(`https://hub.example${path}`, init);
function setup(fetch, options = {}) {
  const logs = [];
  return { logs, proxy: createApiProxy({ origin, fetch, retryDelayMs: 0, log: (entry) => logs.push(entry), ...options }) };
}

test("GET preserves encoded query, cookies, required headers and JSON response", async () => {
  const json = '{"authorizationUrl":"https://www.circzles.com/example"}';
  const { proxy } = setup(async (url, init) => {
    assert.equal(String(url), `${origin}/api/auth/direct/google/start?returnTo=%2Fhub&x=1&x=2`);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.get("cookie"), "cz_session=opaque");
    assert.equal(init.headers.get("origin"), "https://hub.example");
    assert.equal(init.headers.get("x-request-id"), "client-id");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "manual");
    return new Response(json, { headers: { "content-type": "application/json", "x-request-id": "backend-id" } });
  });
  const response = await proxy(request("/api/auth/direct/google/start?returnTo=%2Fhub&x=1&x=2", {
    headers: { cookie: "cz_session=opaque", origin: "https://hub.example", "x-request-id": "client-id" },
  }));
  assert.equal(await response.text(), json);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("x-request-id"), "backend-id");
  assert.ok(response.headers.get("x-proxy-request-id"));
});

for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
  test(`${method} forwards method and exact body, never replays on 503`, async () => {
    let calls = 0;
    const { proxy } = setup(async (url, init) => {
      calls++;
      assert.equal(init.method, method);
      assert.equal(await new Response(init.body).text(), '{"code":"one-use"}');
      assert.equal(init.headers.get("content-type"), "application/json");
      assert.equal(init.headers.get("idempotency-key"), "key");
      return new Response("unavailable", { status: 503 });
    });
    const response = await proxy(request("/api/auth/direct/google/callback", {
      method, body: '{"code":"one-use"}', headers: { "content-type": "application/json", "idempotency-key": "key" },
    }));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "unavailable");
    assert.equal(calls, 1);
  });
}

for (const status of [201, 400, 401, 403, 404, 409, 422, 429, 500]) {
  test(`preserves backend ${status}, body and request ID without retry`, async () => {
    let calls = 0;
    const body = JSON.stringify({ code: "BACKEND_CODE", message: "original", requestId: "backend-id" });
    const { proxy } = setup(async () => {
      calls++;
      return new Response(body, { status, headers: { "content-type": "application/json", "x-request-id": "backend-id", "retry-after": "10" } });
    });
    const response = await proxy(request());
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get("x-request-id"), "backend-id");
    assert.equal(response.headers.get("retry-after"), "10");
    assert.equal(calls, 1);
  });
}

test("preserves separate Set-Cookie values, expiry commas, session flags and logout", async () => {
  const cookies = [
    "cz_session=opaque; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax",
    "other=value; Path=/; HttpOnly; Secure; SameSite=Lax",
    "cz_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
  ];
  const headers = new Headers();
  for (const value of cookies) headers.append("set-cookie", value);
  const { proxy } = setup(async () => new Response("{}", { headers }));
  const response = await proxy(request());
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.ok(cookies.every((cookie) => !cookie.includes("Domain=")));
});

for (const method of ["GET", "HEAD"]) {
  for (const status of [502, 503]) {
    test(`${method} retries ${status} once before body consumption`, async () => {
      let calls = 0;
      let cancelled = false;
      const { proxy, logs } = setup(async () => ++calls === 1
        ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status })
        : new Response(method === "HEAD" ? null : "ok"));
      assert.equal((await proxy(request("/api/me", { method }))).status, 200);
      assert.equal(calls, 2);
      assert.equal(cancelled, true);
      assert.ok(logs.some((entry) => entry.event === "upstream_unavailable"));
    });
  }
}

test("persistent upstream 502 HTML is preserved after one retry", async () => {
  let calls = 0;
  const { proxy } = setup(async () => {
    calls++;
    return new Response("<html>Render service unavailable</html>", { status: 502, headers: { "content-type": "text/html", "x-request-id": "render-id" } });
  });
  const response = await proxy(request());
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(await response.text(), "<html>Render service unavailable</html>");
});

for (const method of ["GET", "POST"]) {
  test(`${method} network failure has bounded retry policy and proxy-specific error`, async () => {
    let calls = 0;
    const { proxy } = setup(async () => { calls++; throw new TypeError("secret network details"); });
    const response = await proxy(request("/api/me", { method }));
    assert.equal(calls, method === "GET" ? 2 : 1);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "PROXY_UPSTREAM_UNREACHABLE");
  });
}

test("GET recovers from one network failure", async () => {
  let calls = 0;
  const { proxy } = setup(async () => {
    if (++calls === 1) throw new TypeError("network");
    return new Response("recovered");
  });
  assert.equal(await (await proxy(request())).text(), "recovered");
  assert.equal(calls, 2);
});

for (const path of ["/api/auth/direct/google/callback", "/api/auth/direct/google/%63allback"]) {
  for (const network of [false, true]) {
    test(`legacy GET callback is not replayed: ${path}, network=${network}`, async () => {
      let calls = 0;
      const { proxy } = setup(async () => {
        calls++;
        if (network) throw new TypeError("network");
        return new Response("unavailable", { status: 502 });
      });
      assert.equal((await proxy(request(`${path}?code=single-use&state=signed`))).status, 502);
      assert.equal(calls, 1);
    });
  }
}

for (const phase of ["headers", "body"]) {
  test(`timeout during ${phase} yields 504 without replay`, async () => {
    let calls = 0;
    const { proxy } = setup(async (_url, { signal }) => {
      calls++;
      if (phase === "headers") return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      } }));
    }, { timeoutMs: 15 });
    const response = await proxy(request());
    assert.equal(response.status, 504);
    assert.equal((await response.json()).code, "PROXY_UPSTREAM_TIMEOUT");
    assert.equal(calls, 1);
  });
}

test("body read failure is never retried", async () => {
  let calls = 0;
  const { proxy } = setup(async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("broken body")); } }));
  });
  assert.equal((await proxy(request())).status, 502);
  assert.equal(calls, 1);
});

test("strips hop-by-hop and Connection-nominated headers in both directions", async () => {
  const { proxy } = setup(async (_url, { headers }) => {
    for (const name of ["connection", "keep-alive", "x-private", "host", "x-forwarded-host", "forwarded", "proxy-authorization"]) assert.equal(headers.get(name), null);
    assert.equal(headers.get("accept-encoding"), "identity");
    return new Response("ok", { headers: { connection: "x-private", "x-private": "secret", "keep-alive": "timeout=5", "cdn-cache-control": "public", "vercel-cdn-cache-control": "public", "cache-control": "public" } });
  });
  const response = await proxy(request("/api/me", { headers: { connection: "x-private", "x-private": "secret", "keep-alive": "timeout=5", host: "evil.example", "x-forwarded-host": "evil.example", forwarded: "host=evil.example", "proxy-authorization": "secret" } }));
  for (const name of ["connection", "keep-alive", "x-private", "cdn-cache-control", "vercel-cdn-cache-control"]) assert.equal(response.headers.get(name), null);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("arbitrary hosts in paths, query and headers cannot change destination; redirects are not followed", async () => {
  const { proxy } = setup(async (url, init) => {
    assert.equal(url.origin, origin);
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 307, headers: { location: "https://external.example/next" } });
  });
  for (const path of ["/api/https://evil.example/steal", "/api//evil.example/steal", "/api/%2F%2Fevil.example", "/api/me?url=https://evil.example"]) {
    const response = await proxy(request(path, { headers: { host: "evil.example" } }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://external.example/next");
  }
});

test("real GET callback transport preserves query, 302 Location and cookies without following redirect", async (t) => {
  let calls = 0;
  const cookies = ["cz_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/", "other=1; Path=/"];
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/auth/direct/google/callback?code=one%2Buse&state=sealed%2Fstate");
    res.writeHead(302, { location: "/hub", "set-cookie": cookies, "x-request-id": "callback-id" });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { proxy } = setup(fetch, { origin: `http://127.0.0.1:${server.address().port}` });
  const response = await proxy(request("/api/auth/direct/google/callback?code=one%2Buse&state=sealed%2Fstate"));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/hub");
  assert.equal(response.headers.get("x-request-id"), "callback-id");
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.equal(calls, 1);
});

test("rejects missing/invalid origin without falling back to public configuration", async () => {
  for (const invalid of ["", "ftp://backend.example", "https://user:pass@backend.example", "https://backend.example/api", "https://backend.example/?url=x", "https://backend.example/#x"]) {
    const { proxy } = setup(async () => assert.fail("must not fetch"), { origin: invalid });
    assert.equal((await proxy(request())).status, 503);
  }
});

test("client cancellation does not trigger a retry", async () => {
  const controller = new AbortController();
  controller.abort();
  const { proxy } = setup(async () => assert.fail("must not fetch"));
  assert.equal((await proxy(request("/api/me", { signal: controller.signal }))).status, 499);
});

for (const status of [204, 205, 304]) {
  test(`preserves bodyless ${status}`, async () => {
    const { proxy } = setup(async () => new Response(null, { status }));
    const response = await proxy(request());
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
  });
}

test("logs distinguish upstream HTTP errors from proxy failures without logging secrets", async () => {
  const { proxy, logs } = setup(async () => new Response('{"token":"body-secret"}', { status: 401 }));
  await proxy(request("/api/me?code=query-secret", { headers: { cookie: "cz_session=cookie-secret", authorization: "Bearer auth-secret" } }));
  assert.ok(logs.some((entry) => entry.event === "upstream_http_error" && entry.status === 401));
  assert.doesNotMatch(JSON.stringify(logs), /body-secret|query-secret|cookie-secret|auth-secret/);
});

test("real Node transport preserves POST bytes and separate cookies, and decodes gzip safely", async (t) => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.method, "POST");
    assert.equal(body, '{"value":"exact"}');
    const zipped = gzipSync(Buffer.from('{"ok":true}'));
    res.writeHead(201, { "content-type": "application/json", "content-encoding": "gzip", "content-length": zipped.length, "set-cookie": ["cz_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/", "other=1; Path=/"] });
    res.end(zipped);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { proxy } = setup(fetch, { origin: `http://127.0.0.1:${server.address().port}` });
  const response = await proxy(request("/api/test", { method: "POST", body: '{"value":"exact"}' }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.deepEqual(await response.json(), { ok: true });
});
