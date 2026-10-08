type Options = {
  refresh: (signal: AbortSignal) => Promise<unknown>;
  onUnauthorized: () => void;
  onError: () => void;
};

// SSE contains invalidations only. Canonical profile hydration owns all player data.
export function subscribePlayerStateEvents({ refresh, onUnauthorized, onError }: Options) {
  const controller = new AbortController();
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 1000;
  let hydrationRetry: ReturnType<typeof setTimeout> | undefined;
  let hydrationRetryMs = 1000;
  let stopped = false;
  let running = false;
  let dirty = false;
  const seen = new Set<string>();
  const visible = () => document.visibilityState === "visible";
  const disconnect = () => { clearTimeout(hydrationRetry); hydrationRetry = undefined; clearTimeout(retry); source?.close(); source = undefined; };
  const unauthorized = () => { stopped = true; disconnect(); controller.abort(); onUnauthorized(); };

  const invalidate = () => {
    if (stopped || !visible()) return;
    dirty = true;
    if (running) return;
    running = true;
    void (async () => {
      try {
        while (dirty && !stopped && visible()) {
          dirty = false;
          try {
            await refresh(controller.signal);
            clearTimeout(hydrationRetry); hydrationRetry = undefined; hydrationRetryMs = 1000;
          }
          catch (error) {
            if (stopped) return;
            if ((error as { status?: number })?.status === 401) { unauthorized(); return; }
            onError();
            if (!hydrationRetry) {
              hydrationRetry = setTimeout(() => { hydrationRetry = undefined; invalidate(); }, hydrationRetryMs);
              hydrationRetryMs = Math.min(30_000, hydrationRetryMs * 2);
            }
          }
        }
      } finally { running = false; }
    })();
  };

  const connect = () => {
    if (stopped || !visible() || source || typeof EventSource === "undefined") return;
    const connection = new EventSource("/api/me/events", { withCredentials: true });
    source = connection;
    connection.onopen = () => {
      if (source !== connection || stopped) return;
      retryMs = 1000;
      invalidate(); // Reconcile anything missed during disconnect/connection rotation.
    };
    connection.addEventListener("player-state-changed", (message) => {
      if (stopped || source !== connection) return;
      const id = (message as MessageEvent).lastEventId;
      if (id && seen.has(id)) return;
      if (id) { seen.add(id); if (seen.size > 128) seen.delete(seen.values().next().value!); }
      invalidate();
    });
    connection.addEventListener("session-expired", () => { if (source === connection && !stopped) unauthorized(); });
    connection.onerror = () => {
      if (source !== connection || stopped) return;
      disconnect();
      // Also detects a 401 handshake, which native EventSource does not expose.
      invalidate();
      retry = setTimeout(connect, retryMs + Math.floor(Math.random() * 250));
      retryMs = Math.min(30_000, retryMs * 2);
    };
  };
  const focus = () => { if (visible()) { invalidate(); connect(); } };
  const visibility = () => { if (visible()) focus(); else disconnect(); };
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", visibility);
  const fallback = setInterval(invalidate, 300_000);
  connect();
  return () => {
    stopped = true; controller.abort(); disconnect(); clearInterval(fallback);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", visibility);
  };
}
