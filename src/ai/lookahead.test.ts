import { describe, it, expect } from 'vitest';
import { createGame } from '../engine/state';
import { assignRoles, lookaheadChoose } from './choose';
import { tile } from '../engine/catalog';
import type { GameState } from '../engine/types';

function openRoles(game: GameState) {
  return assignRoles(game);
}
function kindOf(action: { type: string; tileDefId?: string } | null): string {
  if (action && action.type === 'build' && action.tileDefId) return tile(action.tileDefId).kind;
  return action?.type ?? 'none';
}

describe('lookaheadChoose (#24 有限深度前向)', () => {
  it('确定性：同一局面两次选择一致', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    const pid = game.currentPlayerId; // P4
    const a = lookaheadChoose(game, pid, roles, { depth: 2, width: 4 });
    const b = lookaheadChoose(createGame(777), pid, roles, { depth: 2, width: 4 });
    expect(a).toEqual(b);
  });

  it('seed777 R1 当前玩家 P4（手有 ind-coal-7）：lookahead 保持煤开巴里，不插断管', () => {
    const game = createGame(777);
    const roles = openRoles(game);
    expect(game.currentPlayerId).toBe(3); // 顺位 P4
    const action = lookaheadChoose(game, game.currentPlayerId, roles, { depth: 2, width: 4 });
    expect(action).not.toBeNull();
    // P4 手有煤牌 → 战术上煤开（scoreAction 主导），而非储备管/管开
    expect(kindOf(action)).toBe('coal');
    const slot = String((action as { slotId?: string } | null)?.slotId ?? '');
    expect(slot.startsWith('wilkes-barre') || slot.startsWith('clarksburg')).toBe(true);
  });
});
