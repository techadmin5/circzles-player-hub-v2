import { randomUUID } from "node:crypto";

export const PLAYER_STATE_CHANNEL = "player_state_changed";
export type StateInvalidation = { id: string };

// Process-local delivery only; PostgreSQL NOTIFY provides cross-instance fan-out.
export class PlayerStateEvents {
  ready = false;
  private subscribers = new Map<string, Set<{ changed: (event: StateInvalidation) => void; close: () => void }>>();

  setReady(ready: boolean) {
    this.ready = ready;
    if (!ready) for (const listeners of [...this.subscribers.values()]) for (const listener of [...listeners]) listener.close();
  }

  subscribe(playerId: string, changed: (event: StateInvalidation) => void, close: () => void) {
    const listeners = this.subscribers.get(playerId) ?? new Set();
    if (listeners.size >= 5) return null;
    const listener = { changed, close };
    listeners.add(listener);
    this.subscribers.set(playerId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.subscribers.delete(playerId); };
  }

  receive(playerId: string) {
    if (!this.ready || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)) return;
    const event = { id: randomUUID() };
    for (const listener of this.subscribers.get(playerId) ?? []) listener.changed(event);
  }
}
