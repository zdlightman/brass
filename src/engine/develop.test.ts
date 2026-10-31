import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { accessibleTileIds } from './mat';
import { createGame } from './state';

describe('develop', () => {
  it('removes one accessible tile and pays Vanderbilt iron when nothing is connected', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.players[pid]!.hand.push({ id: 'dev-card', defId: 'ind-mfg-1' });
    const result = applyAction(state, {
      type: 'develop',
      playerId: pid,
      cardId: 'dev-card',
      tileDefIds: ['m1'],
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mat = result.state.players[pid]!.mat;
    expect(mat.filter((tile) => tile.defId === 'm1' && !tile.removed)).toHaveLength(1);
    expect(accessibleTileIds(mat).has('m2')).toBe(false);
    expect(result.state.players[pid]!.money).toBe(23);
    expect(result.state.players[pid]!.hand.some((card) => card.id === 'dev-card')).toBe(false);
  });

  it('removes two copies and uncovers the next industry', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.players[pid]!.hand.push({ id: 'dev-card', defId: 'ind-mfg-1' });
    const result = applyAction(state, {
      type: 'develop',
      playerId: pid,
      cardId: 'dev-card',
      tileDefIds: ['m1', 'm1'],
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mat = result.state.players[pid]!.mat;
    expect(mat.filter((tile) => tile.defId === 'm1' && !tile.removed)).toHaveLength(0);
    expect(accessibleTileIds(mat).has('m2')).toBe(true);
    expect(result.state.players[pid]!.money).toBe(16);
  });

  it('refuses a tile that is still covered', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.players[pid]!.hand.push({ id: 'dev-card', defId: 'ind-mfg-1' });
    const result = applyAction(state, {
      type: 'develop',
      playerId: pid,
      cardId: 'dev-card',
      tileDefIds: ['m2'],
      sources: [],
    });
    expect(result.ok).toBe(false);
  });

  it('chains develop: removes a low tile, then the higher tile it unlocks, in one action', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.players[pid]!.hand.push({ id: 'dev-card', defId: 'ind-mfg-1' });
    const result = applyAction(state, {
      type: 'develop',
      playerId: pid,
      cardId: 'dev-card',
      tileDefIds: ['ck1', 'ck2'], // 研 1焦 → ck2 被解锁 → 同一动作研 2焦
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mat = result.state.players[pid]!.mat;
    expect(mat.filter((tile) => tile.defId === 'ck1' && !tile.removed)).toHaveLength(0);
    // ck2 有两份，连锁研掉一份，剩一份
    expect(mat.filter((tile) => tile.defId === 'ck2' && !tile.removed)).toHaveLength(1);
    expect(result.state.players[pid]!.money).toBe(16); // 2 × Vanderbilt 铁 $7
  });

  it('chains develop requires the low tile first', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    state.players[pid]!.hand.push({ id: 'dev-card', defId: 'ind-mfg-1' });
    const result = applyAction(state, {
      type: 'develop',
      playerId: pid,
      cardId: 'dev-card',
      tileDefIds: ['ck2', 'ck1'], // 顺序错：ck2 初始仍被 ck1 覆盖
      sources: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('deck', () => {
  it('deals each 4-player card once', () => {
    const state = createGame(1);
    const ids = [
      ...state.deck.map((card) => card.defId),
      ...state.players.flatMap((player) => [...player.hand, ...player.discard].map((card) => card.defId)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('ind-coal-'))).toHaveLength(8);
    expect(ids.filter((id) => id.startsWith('ind-coke-'))).toHaveLength(0);
    expect(ids.filter((id) => id.startsWith('loc-pittsburgh-'))).toHaveLength(4);
    expect(ids.filter((id) => id === 'loc-boston-1')).toHaveLength(1);
    expect(ids.filter((id) => id === 'loc-albany-1')).toHaveLength(0);
    expect(state.players.every((player) => player.hand.length === 8 && player.discard.length === 1)).toBe(true);
  });
});
