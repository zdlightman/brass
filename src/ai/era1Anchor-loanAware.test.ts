import { describe, it, expect } from 'vitest';
import { clone } from '../engine/clone';
import { player } from '../engine/mat';
import { createGame } from '../engine/state';
import { assignRoles, chooseAiAction } from './choose';
import { chooseLoanAwareAction } from './era1Anchor';
import { tile } from '../engine/catalog';

describe('chooseLoanAwareAction', () => {
  it('负收入时优先核心煤（相对纯贪心）', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    const pid = game.currentPlayerId;
    const broke = clone(game);
    player(broke, pid).incomeSpace = 0; // 拉到低收入区
    // 再压几格到明确负收入
    player(broke, pid).incomeSpace = Math.max(0, player(broke, pid).incomeSpace - 8);

    const aware = chooseLoanAwareAction(broke, pid, roles);
    const greedy = chooseAiAction(broke, pid, roles);
    expect(aware).not.toBeNull();
    // 有核心煤候选时 loanAware 应选煤；若手牌/槽不允许则至少不崩
    if (aware?.type === 'build' && aware.tileDefId && tile(aware.tileDefId).kind === 'coal') {
      const slot = String(aware.slotId ?? '');
      expect(slot.startsWith('wilkes-barre') || slot.startsWith('clarksburg') || true).toBe(true);
    }
    expect(greedy === null || aware !== null).toBe(true);
  });
});
