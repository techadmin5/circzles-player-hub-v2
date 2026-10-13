export interface ShutdownOptions {
  stopWorker: () => Promise<void>;
  closeHttp: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  timeoutMs: number;
  log: (event: "shutdown_started" | "shutdown_complete" | "shutdown_failed", code?: string) => void;
}
export function createShutdownCoordinator(options: ShutdownOptions) {
  let shutdown: Promise<void> | undefined;
  return () => {
    if (shutdown) return shutdown;
    options.log("shutdown_started");
    // Stop scheduling before yielding or closing HTTP resources.
    let drained: Promise<void>;
    try { drained = options.stopWorker(); }
    catch { drained = Promise.reject(new Error("WORKER_DRAIN_FAILED")); }
    let timer: NodeJS.Timeout;
    const work = (async () => {
      await Promise.all([drained, options.closeHttp()]);
      await options.closeDatabase();
    })();
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("SHUTDOWN_TIMEOUT")), options.timeoutMs); });
    shutdown = Promise.race([work, timeout]).then(() => { options.log("shutdown_complete"); }, error => {
      options.log("shutdown_failed", error instanceof Error && error.message === "SHUTDOWN_TIMEOUT" ? "SHUTDOWN_TIMEOUT" : "SHUTDOWN_RESOURCE_FAILED");
      throw new Error("BACKEND_SHUTDOWN_FAILED");
    }).finally(() => clearTimeout(timer));
    return shutdown;
  };
}
