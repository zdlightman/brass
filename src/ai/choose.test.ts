import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/state';
import { chooseAiAction, linksToSellMarket } from './choose';

describe('manufacturing flight', () => {
  it('counts more unbuilt rails from Saginaw than from Albany when the crate markets are Boston and the South', () => {
    const state = createGame(1);
    state.merchants = [
      { locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 },
      { locationId: 'the-south', tileId: 'mer-15', faceUp: true, art: 1 },
    ];
    const saginaw = linksToSellMarket(state, 'saginaw', 'manufacturing');
    const albany = linksToSellMarket(state, 'albany', 'manufacturing');
    const philadelphia = linksToSellMarket(state, 'philadelphia', 'manufacturing');
    expect(albany).toBe(1);
    expect(philadelphia).toBeLessThan(saginaw);
    expect(saginaw).toBeGreaterThan(albany);
  });

  it('flies the first crate toward the market instead of Saginaw', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.merchants = [
      { locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 },
      { locationId: 'the-south', tileId: 'mer-15', faceUp: true, art: 1 },
    ];
    state.players[pid]!.hand = [
      { id: 'fly-saginaw', defId: 'loc-saginaw-1' },
      { id: 'fly-philadelphia', defId: 'loc-philadelphia-1' },
    ];
    const action = chooseAiAction(state, pid, { 0: 'box', 1: 'box', 2: 'box', 3: 'box' });
    expect(action?.type).toBe('build');
    if (action?.type !== 'build') return;
    expect(action.tileDefId).toBe('m1');
    expect(action.cardId).toBe('fly-philadelphia');
  });

  it('does not fly a second crate on outside steel early, and will do it late', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.merchants = [
      { locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 },
      { locationId: 'the-south', tileId: 'mer-15', faceUp: true, art: 1 },
    ];
    for (const tile of state.players[pid]!.mat) {
      if (tile.defId === 'm1') tile.removed = true;
    }
    state.players[pid]!.hand = [{ id: 'fly-saginaw', defId: 'loc-saginaw-1' }];
    state.round = 1;
    const roles = { 0: 'box' as const, 1: 'box' as const, 2: 'box' as const, 3: 'box' as const };
    const early = chooseAiAction(state, pid, roles);
    expect(early?.type === 'build' && early.tileDefId === 'm2').toBe(false);

    state.round = 8;
    const late = chooseAiAction(state, pid, roles);
    expect(late?.type).toBe('build');
    if (late?.type !== 'build') return;
    expect(late.tileDefId).toBe('m2');
  });
});
