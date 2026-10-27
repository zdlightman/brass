import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { legalActions } from './legal';
import { createGame } from './state';

describe('createGame + pass', () => {
  it('deals 8 cards and a setup discard to each of 4 players', () => {
    const state = createGame(42);
    expect(state.players).toHaveLength(4);
    for (const p of state.players) {
      expect(p.hand).toHaveLength(8);
      expect(p.discard).toHaveLength(1);
      expect(p.money).toBe(30);
      expect(p.whiskey).toBe(0);
      expect(p.heavySupply.map((h) => h.type)).toEqual(['whiskey', 'steelResource']);
      expect(p.pipelineSupply).toEqual([
        { type: 'income', incomeSpaces: 2 },
        { type: 'reserve' },
      ]);
    }
    expect(state.actionsAllowed).toBe(1);
  });

  it('pass discards one card, gains whiskey, and ends the era-1 first turn', () => {
    const state = createGame(42);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const legal = legalActions(state, pid);
    expect(legal.some((a) => a.type === 'pass' && a.cardId === card.id)).toBe(true);

    const result = applyAction(state, { type: 'pass', playerId: pid, cardId: card.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.state.players[pid]!;
    expect(after.whiskey).toBe(1);
    expect(after.hand).toHaveLength(8);
    expect(after.hand.some((c) => c.id === card.id)).toBe(false);
    expect(after.discard.some((c) => c.id === card.id)).toBe(true);
    expect(result.state.currentPlayerId).not.toBe(pid);
    expect(result.state.actionsAllowed).toBe(1);
    expect(state.players[pid]!.whiskey).toBe(0);
  });
});
