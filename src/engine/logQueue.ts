import type { GameState } from './types';

const deferredLogs = new WeakMap<GameState, string[]>();

/** Side effects such as a depleted industry are attached to the action that caused them. */
export function deferLog(state: GameState, text: string): void {
  const queued = deferredLogs.get(state) ?? [];
  queued.push(text);
  deferredLogs.set(state, queued);
}

export function takeDeferredLogs(state: GameState): string[] {
  const queued = deferredLogs.get(state) ?? [];
  deferredLogs.delete(state);
  return queued;
}
