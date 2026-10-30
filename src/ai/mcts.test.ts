import { describe, it, expect } from 'vitest';
import { createGame } from '../engine/state';
import { assignRoles, mctsChoose } from './choose';
import { tile } from '../engine/catalog';
import type { GameState } from '../engine/types';

function openRoles(game: GameState) {
  return assignRoles(game);
}
function kindOf(action: { type: string; tileDefId?: string } | null): string {
  if (action && action.type === 'build' && action.tileDefId) return tile(action.tileDefId).kind;
  return action?.type ?? 'none';
}

describe('mctsChoose (#25 确定化 MCTS)', () => {
  const opts = { iterations: 40, rolloutDepth: 4, topK: 4, topM: 10 };
  it('确定性：同一局面两次选择一致', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    const pid = game.currentPlayerId;
    const a = mctsChoose(game, pid, roles, opts);
    const b = mctsChoose(createGame(777), pid, roles, opts);
    expect(a).toEqual(b);
  });

  // 回归：开局软先验应对齐线下稳定优解（巴里/克堡煤）；浅搜「发现」不了 ≠ 不是好动。
  it('seed777 R1 当前玩家 P4（手有 ind-coal-7）：MCTS 选核心城煤开，不插断管', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    expect(game.currentPlayerId).toBe(3);
    const action = mctsChoose(game, game.currentPlayerId, roles, opts);
    expect(action).not.toBeNull();
    expect(kindOf(action)).toBe('coal');
    const slot = String((action as { slotId?: string } | null)?.slotId ?? '');
    expect(slot.startsWith('wilkes-barre') || slot.startsWith('clarksburg')).toBe(true);
  });
});

describe('mctsChoose (#26 不完全信息多世界采样)', () => {
  it('多世界多数投票仍选煤开巴里（模拟未知牌库顺序下稳健决策）', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    const action = mctsChoose(game, game.currentPlayerId, roles, { worlds: 3, iterations: 30, rolloutDepth: 3, topK: 4, topM: 10 });
    expect(action).not.toBeNull();
    expect(kindOf(action)).toBe('coal');
  });
});

describe('mctsChoose (#28 对手多风格参数)', () => {
  it('对手风格参数可选，且不破坏己方煤开决策', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    const action = mctsChoose(game, game.currentPlayerId, roles, { iterations: 30, rolloutDepth: 3, topK: 4, topM: 10, opponentStyle: 'aggressive' });
    expect(action).not.toBeNull();
    expect(kindOf(action)).toBe('coal');
  });
});
