import { applyAction } from '../engine/apply';
import { clone } from '../engine/clone';
import { incomeLevelAt } from '../engine/income';
import { player } from '../engine/mat';
import { tile } from '../engine/catalog';
import { setHoldEraScore } from '../engine/turn';
import type { Action, GameState, PlayerId } from '../engine/types';
import { proposeRootActions, pickLoanAction, relockRoles, chooseAiAction, type Role } from './choose';

/**
 * 时代 1 计分锚定（value-framework v3 / 计划定锚折中）。
 * 不给外部买焦炭等单点打补丁：把根动作推到一时代计分，用真实 VP 选招。
 * 算力贵，默认离线 / 探针；生产热座仍用贪心或浅 MCTS。
 */

export type Era1RolloutPolicy = 'greedy' | 'loanAware';

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

/** 按下回合排序规则（花费升序）投影自己的顺位下标，0=下回合最先动。 */
export function projectedSeatIndex(state: GameState, pid: PlayerId): number {
  const order = [...state.turnOrder].sort((a, b) => {
    const da = state.spentThisRound[a]! - state.spentThisRound[b]!;
    if (da !== 0) return da;
    return state.turnOrder.indexOf(a) - state.turnOrder.indexOf(b);
  });
  return order.indexOf(pid);
}

/**
 * 轻量顺位/席位代理（折合 VP，只加在根招比较上，不进时代终局分）。
 * 花费少 → 下回合更靠前 → 便于「贷开抢顺位 → 下回合煤双」。
 * 早期权重大；纯 VP 锚看不到这一点时会低估贷开。
 */
export function seatTempoProxyVp(before: GameState, after: GameState, pid: PlayerId): number {
  if (before.era !== 1 || before.round > 5) return 0;
  const idxAfter = projectedSeatIndex(after, pid);
  const spent = after.spentThisRound[pid] ?? 0;
  const minSpent = Math.min(...before.turnOrder.map((id) => after.spentThisRound[id] ?? 0));
  let bonus = 0;
  // 下回合越靠前越好（0 最好）
  bonus += (3 - idxAfter) * (before.round <= 3 ? 2 : 1.2);
  // 本回合花费垫底（含贷款$0）：保留抢首动期权
  if (spent <= minSpent) bonus += before.round <= 3 ? 2.5 : 1.2;
  // 沉底末动且花费仍低：控顺位触发（用户：匹兹堡核心）
  const lastAction = before.actionsTaken + 1 >= before.actionsAllowed;
  if (lastAction && spent <= minSpent) bonus += 1.5;
  return bonus;
}

function isCoreCoalBuild(action: Action): boolean {
  if (action.type !== 'build' || !action.tileDefId) return false;
  if (tile(action.tileDefId).kind !== 'coal') return false;
  const slot = String(action.slotId ?? '');
  return slot.startsWith('wilkes-barre') || slot.startsWith('clarksburg');
}

function isCoalBuild(action: Action): boolean {
  return action.type === 'build' && !!action.tileDefId && tile(action.tileDefId).kind === 'coal';
}

/**
 * 含贷偏好的浅策略（仅用于定锚 rollout，不进生产热座）：
 * - 收入为负 / 现金紧：优先核心煤，其次任意煤
 * - 早期尚未贷过且收入将被压垮：允许主动贷一次（由 pickLoanAction）
 * - 其余回退 chooseAiAction
 * 目的：让「贷开」根招后面的推演能走出贷→煤→回正，而不是贷完继续乱造箱。
 */
export function chooseLoanAwareAction(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
): Action | null {
  const p = player(state, pid);
  const income = incomeLevelAt(p.incomeSpace);
  const roots = proposeRootActions(state, pid, roles, 10, 24);
  const coreCoal = roots.find(isCoreCoalBuild);
  const anyCoal = roots.find(isCoalBuild);

  if (income < 0 || (income <= 0 && p.money < 10)) {
    if (coreCoal) return coreCoal;
    if (anyCoal) return anyCoal;
  }

  // 早期首贷：负收入风险高且手里暂无好煤时，允许 rollout 主动贷
  const loaned = state.log.filter((l) => l.text.includes('贷款') && l.text.includes(`P${pid + 1}`)).length;
  if (state.era === 1 && state.round <= 4 && loaned === 0 && income <= 0 && !coreCoal) {
    const loan = pickLoanAction(state, pid, roles[pid]);
    if (loan) return loan;
  }

  return chooseAiAction(state, pid, roles);
}

/**
 * 从当前局面推到一时代计分（hold）。
 * focusPid + loanAware：只对该玩家用含贷偏好策略，对手仍贪心——测「我贷开后按恢复线走」的时代分。
 */
export function playToEra1Held(
  state: GameState,
  roles: Record<PlayerId, Role>,
  maxSteps = 2500,
  opts: { focusPid?: PlayerId; policy?: Era1RolloutPolicy } = {},
): GameState {
  setHoldEraScore(true);
  try {
    let s = clone(state);
    let rmap = { ...roles };
    const policy = opts.policy ?? 'greedy';
    for (let step = 0; step < maxSteps && !s.over && !s.eraScoreHeld; step++) {
      if (s.era !== 1) break;
      rmap = relockRoles(s, rmap);
      const cpid = s.currentPlayerId;
      const useAware = policy === 'loanAware' && (opts.focusPid === undefined || opts.focusPid === cpid);
      const action = useAware ? chooseLoanAwareAction(s, cpid, rmap) : chooseAiAction(s, cpid, rmap);
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

function actionKey(action: Action): string {
  return JSON.stringify(action);
}

/**
 * 对 scoreAction 粗排前 width 个根动作 + 强制保留的 loan：各推到一时代计分，取锚定 VP 最高者。
 * 定锚推演默认 loanAware（focus=决策者），否则贷开后的时代分测不准。
 */
export function era1AnchorChoose(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { width?: number; topM?: number; policy?: Era1RolloutPolicy } = {},
): Action | null {
  const width = opts.width ?? 6;
  const topM = opts.topM ?? Math.max(14, width + 4);
  const policy = opts.policy ?? 'loanAware';
  const roots: Action[] = [];
  const seen = new Set<string>();
  const push = (action: Action | null | undefined) => {
    if (!action) return;
    const key = actionKey(action);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(action);
  };

  for (const action of proposeRootActions(state, pid, roles, width, topM)) push(action);
  push(pickLoanAction(state, pid, roles[pid]));

  let best: Action | null = null;
  let bestV = -Infinity;
  for (const action of roots) {
    const applied = applyAction(clone(state), action);
    if (!applied.ok) continue;
    const end = playToEra1Held(applied.state, roles, 2500, { focusPid: pid, policy });
    // 终局相对 VP + 根招顺位代理（贷开$0 花费 vs 造煤花钱）
    let v = era1AnchorValue(end, pid) + seatTempoProxyVp(state, applied.state, pid);
    // 经典贷开信用：早期贷且贷后仍能核心煤（下回合煤双）——补纯 VP 看不见的顺位期权
    if (action.type === 'loan' && state.era === 1 && state.round <= 4) {
      const stillCore = proposeRootActions(applied.state, pid, roles, 12, 24).some(isCoreCoalBuild);
      if (stillCore) v += 5;
    }
    if (v > bestV) {
      bestV = v;
      best = action;
    }
  }
  return best;
}
