export interface BatchProcessor { processBatch(batchSize: number): Promise<number> }
export interface MissionWorkerState {
  enabled: boolean;
  status: "disabled" | "idle" | "running" | "draining" | "stopped";
  scheduled: boolean;
  inFlight: boolean;
}

// No schema imports: this runner is shared by the pre-M1 and M1 engines.
export class MissionProcessorRunner {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<boolean>;
  private stopped = false;
  private drain?: Promise<void>;
  constructor(private processor: BatchProcessor, private intervalMs: number, private batchSize: number, private onError: (error: unknown) => void, private enabled = true) {}
  getState(): MissionWorkerState {
    return { enabled: this.enabled, scheduled: !!this.timer, inFlight: !!this.inFlight, status: this.stopped ? this.inFlight ? "draining" : "stopped" : !this.enabled ? "disabled" : this.inFlight ? "running" : "idle" };
  }
  tick(): Promise<boolean> {
    if (!this.enabled || this.stopped || this.inFlight) return Promise.resolve(false);
    this.inFlight = Promise.resolve().then(async () => {
      if (this.stopped) return false;
      try { await this.processor.processBatch(this.batchSize); return true; }
      catch (error) { this.onError(error); return false; }
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  start() {
    if (this.enabled && !this.stopped && !this.timer) this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }
  stop(): Promise<void> {
    this.stopped = true; // Synchronous fence, including manually invoked ticks.
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.drain ??= (this.inFlight ?? Promise.resolve()).then(() => undefined);
    return this.drain;
  }
}
