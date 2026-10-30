import { describe, it, expect } from 'vitest';
import { createGame } from '../engine/state';
import { tile } from '../engine/catalog';
import { assignRoles } from './choose';
import { era1AnchorChoose, era1AnchorValue, playToEra1Held } from './era1Anchor';

describe('era1Anchor（时代 1 计分定锚）', () => {
  it('playToEra1Held 能推到一时代计分', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    const end = playToEra1Held(game, roles);
    expect(end.eraScoreHeld || end.era === 2 || end.over).toBe(true);
    expect(Number.isFinite(era1AnchorValue(end, 0))).toBe(true);
  });

  it('seed777 根定锚：有煤牌时选核心城煤开（巴里/克堡）', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    expect(game.currentPlayerId).toBe(3);
    // width 略小以控时：只在 scoreAction 前列里用时代分裁决
    const action = era1AnchorChoose(game, game.currentPlayerId, roles, { width: 4 });
    expect(action).not.toBeNull();
    expect(action?.type).toBe('build');
    if (action?.type === 'build') {
      expect(tile(action.tileDefId).kind).toBe('coal');
      const slot = String(action.slotId ?? '');
      expect(slot.startsWith('wilkes-barre') || slot.startsWith('clarksburg')).toBe(true);
    }
  }, 300_000);
});
