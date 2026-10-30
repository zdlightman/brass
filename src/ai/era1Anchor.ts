import { applyAction } from '../engine/apply';
import { clone } from '../engine/clone';
import { player } from '../engine/mat';
import { setHoldEraScore } from '../engine/turn';
import type { Action, GameState, PlayerId } from '../engine/types';
import { chooseAiAction, proposeRootActions, relockRoles, type Role } from './choose';

/**
 * 时代 1 计分锚定（value-framework v3 / 计划定锚折中）。
 * 不给外部买焦炭等单点打补丁：把根动作推到一时代计分，用真实 VP 选招。
 * 算力贵，默认离线 / 探针；生产热座仍用贪心或浅 MCTS。
 */

/** 一时代计分后的锚定回报：自己的 VP − 最高对手 VP（争第一；抬分与相对名次同向）。 */
export function era1AnchorValue(state: GameState, pid: PlayerId): number {
  const mine = player(state, pid).vp;
  let bestOpp = -Infinity;
  for (const o of state.players) {
    if (o.id === pid) continue;
    bestOpp = Math.max(bestOpp, o.vp);
  }
  if (!Number.isFinite(bestOpp)) return mine;
  return mine - bestOpp;
}

/**
 * 从当前局面用贪心策略推到一时代计分（hold），返回计分后局面。
 * 使用全局 setHoldEraScore，调用方勿并行。
 */
export function playToEra1Held(
  state: GameState,
  roles: Record<PlayerId, Role>,
  maxSteps = 2500,
): GameState {
  setHoldEraScore(true);
  try {
    let s = clone(state);
    let rmap = { ...roles };
    for (let step = 0; step < maxSteps && !s.over && !s.eraScoreHeld; step++) {
      if (s.era !== 1) break;
      rmap = relockRoles(s, rmap);
      const action = chooseAiAction(s, s.currentPlayerId, rmap);
      if (!action) break;
      const result = applyAction(s, action);
      if (!result.ok) break;
      s = result.state;
    }
    return s;
  } finally {
    setHoldEraScore(false);
  }
}

/**
 * 对 scoreAction 粗排前 width 个根动作：各推到一时代计分，取锚定 VP 最高者。
 * 用来发现「短期好看、时代分很差」的坑（如乱外部买资源造钢），而不是堆 if。
 */
export function era1AnchorChoose(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { width?: number; topM?: number } = {},
): Action | null {
  const width = opts.width ?? 6;
  const topM = opts.topM ?? Math.max(14, width + 4);
  const roots = proposeRootActions(state, pid, roles, width, topM);
  let best: Action | null = null;
  let bestV = -Infinity;
  for (const action of roots) {
    const applied = applyAction(clone(state), action);
    if (!applied.ok) continue;
    const end = playToEra1Held(applied.state, roles);
    const v = era1AnchorValue(end, pid);
    if (v > bestV) {
      bestV = v;
      best = action;
    }
  }
  return best;
}
