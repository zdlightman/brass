import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/state';
import { assignRoles, buildRank, chooseAiAction, flowReady, linksToSellMarket, relockRoles } from './choose';
import { tile } from '../engine/catalog';

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

describe('hand-driven roles + relock', () => {
  it('relockRoles guard: built manufacturing keeps box even if hand says oil', () => {
    const g = createGame(1);
    g.round = 3;
    const m1Slot = g.slots.find((s) => s.owner === null && s.tileDefId === null && s.locationId === 'pittsburgh');
    if (m1Slot) {
      m1Slot.owner = g.currentPlayerId;
      m1Slot.tileDefId = 'm1';
    }
    g.players[g.currentPlayerId].hand = [
      { id: 'x1', defId: 'ind-kero-1' },
      { id: 'x2', defId: 'ind-kero-2' },
    ];
    const fresh = assignRoles(g);
    expect(fresh[g.currentPlayerId]).toBe('oil');
    const locked = relockRoles(g, { 0: 'box', 1: 'box', 2: 'box', 3: 'box' });
    expect(locked[g.currentPlayerId]).toBe('box');
  });

  it('roles vary by opening hand, not a forced 2box/2oil split', () => {
    const patterns = new Set<string>();
    for (const seed of [1, 7, 99, 555, 2024, 31337, 42, 101, 5, 66, 1024]) {
      const roles = assignRoles(createGame(seed));
      patterns.add([0, 1, 2, 3].map((p) => roles[p as 0 | 1 | 2 | 3]).join(','));
    }
    expect(patterns.size).toBeGreaterThan(1);
  });

  it('flowReady gates early industry opening (buildRank)', () => {
    const m1 = tile('m1');
    const ready = createGame(1);
    ready.merchants = [{ locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 }];
    ready.players[ready.currentPlayerId].hand = [
      { id: 'a', defId: 'ind-mfg-1' },
      { id: 'b', defId: 'loc-boston-1' },
    ];
    expect(flowReady(ready, ready.currentPlayerId, 'box')).toBe(true);
    expect(buildRank(ready, ready.currentPlayerId, 'box', m1)).toBe(72);

    const not = createGame(2);
    not.merchants = [{ locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 }];
    not.players[not.currentPlayerId].hand = [
      { id: 'a', defId: 'ind-mfg-1' },
      { id: 'b', defId: 'loc-chicago-1' },
    ];
    expect(flowReady(not, not.currentPlayerId, 'box')).toBe(false);
    expect(buildRank(not, not.currentPlayerId, 'box', m1)).toBe(42);
  });
});
