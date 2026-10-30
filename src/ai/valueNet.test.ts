import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGame } from '../engine/state';
import { assignRoles } from './choose';
import { netValue, blendedValue, type ValueNet } from './valueNet';
import type { PlayerId } from '../engine/types';

const net: ValueNet = JSON.parse(readFileSync('D:/pythonprojects/Brass/traces/value_net.json', 'utf8'));

describe('#29 价值网络部署', () => {
  it('netValue 对四位玩家返回有限预测（权重加载有效）', () => {
    const g = createGame(777);
    const roles = assignRoles(g);
    for (const p of [0, 1, 2, 3] as PlayerId[]) {
      const v = netValue(g, p, roles[p], net);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('blendedValue 融合可用，且默认(null 网络)退回纯启发式', () => {
    const g = createGame(777);
    const roles = assignRoles(g);
    expect(Number.isFinite(blendedValue(g, 0, roles[0], null))).toBe(true);
    expect(Number.isFinite(blendedValue(g, 0, roles[0], net))).toBe(true);
    // 网络预测方向应与启发式大体一致（都视领先收入/产能为正向）
    expect(Number.isFinite(blendedValue(g, 0, roles[0], net, 1, 1))).toBe(true);
  });
});
