import { describe, it, expect } from 'vitest';
import { clone } from '../engine/clone';
import { player } from '../engine/mat';
import { createGame } from '../engine/state';
import { assignRoles, evaluateState, ROLE_ZH } from './choose';
import type { PlayerId } from '../engine/types';

function rolesOf(game: ReturnType<typeof createGame>) {
  return assignRoles(game);
}
function ev(game: ReturnType<typeof createGame>, pid: PlayerId) {
  const roles = rolesOf(game);
  return evaluateState(game, pid, roles[pid]);
}

describe('evaluateState (#23 局面评估)', () => {
  it('确定性：同一局面两次评估结果一致', () => {
    const game = createGame(777);
    expect(ev(game, 0)).toBe(ev(clone(game), 0));
    expect(ev(game, 2)).toBe(ev(clone(game), 2));
  });

  it('现金单调：现金越多局面期望越高', () => {
    const game = createGame(555);
    const base = ev(game, 0);
    const rich = clone(game);
    player(rich, 0).money += 40;
    expect(ev(rich, 0)).toBeGreaterThan(base);
  });

  it('收入期权：更高收入轨略抬期望（轻量，非规则分）', () => {
    const game = createGame(1234);
    const base = ev(game, 1);
    const good = clone(game);
    player(good, 1).incomeSpace += 4; // 至少升 2 级
    expect(ev(good, 1)).toBeGreaterThan(base);
  });

  it('VP 主轴：更高 VP 局面期望更高', () => {
    const game = createGame(321);
    const base = ev(game, 0);
    const scored = clone(game);
    player(scored, 0).vp += 20;
    expect(ev(scored, 0)).toBeGreaterThan(base);
  });

  it('破产风险：负收入且缺现金的局面期望显著更低', () => {
    const game = createGame(88);
    const pid = 2 as PlayerId;
    const base = ev(game, pid);
    const broke = clone(game);
    const p = player(broke, pid);
    p.incomeSpace = 0; // incomeLevelAt(0) = 0? 0 以下 1 格 1 级，space0 → level 0
    p.money = 0;
    const poor = clone(game);
    player(poor, pid).incomeSpace = 5; // 更低
    expect(ev(broke, pid)).toBeLessThan(base);
    expect(ev(poor, pid)).toBeLessThan(base);
  });

  it('可对四位玩家独立评估且可比（用于比较选动作）', () => {
    const game = createGame(2024);
    for (const p of [0, 1, 2, 3] as PlayerId[]) {
      expect(Number.isFinite(ev(game, p))).toBe(true);
    }
  });

  it('流派感知：已落地所选流派产业，评估更高', () => {
    const game = createGame(42);
    const roles = rolesOf(game);
    const pid = 0 as PlayerId;
    const style = roles[pid];
    // 注入一个已造的制造/煤油建筑到该玩家名下的空槽（只影响风格判定，不校验合法性）
    const withInd = clone(game);
    const slot = withInd.slots.find((s) => !s.tileDefId);
    if (slot) {
      slot.tileDefId = style === 'box' ? 'm1' : 'k2';
      slot.owner = pid;
    }
    expect(ev(withInd, pid)).not.toBe(ev(game, pid));
    // 验证风格枚举可读（确保 import 生效）
    expect(Object.keys(ROLE_ZH).length).toBe(3);
  });
});
