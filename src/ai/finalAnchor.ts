import { applyAction } from '../engine/apply';
import { clone } from '../engine/clone';
import type { Action, GameState, PlayerId } from '../engine/types';
import { proposeRootActions, pickLoanAction, relockRoles, chooseAiAction, type Role } from './choose';
import { era1AnchorValue } from './era1Anchor';

/**
 * 终局 VP 定锚（价值计划下一阶段：时代 2 / 整局）。
 * 根招各用贪心推到 game.over，用终局相对 VP 选招。
 * 比时代 1 定锚更慢；热座仅在时代 2 由「定锚」脑调用，默认仍贪心。
 */

/** 与时代 1 同尺：自己的 VP − 最高对手 VP。 */
export function finalAnchorValue(state: GameState, pid: PlayerId): number {
  return era1AnchorValue(state, pid);
}

/** 从当前局面贪心推到终局（不 hold 一时代计分）。 */
export function playToGameOver(
  state: GameState,
  roles: Record<PlayerId, Role>,
  maxSteps = 4000,
): GameState {
  let s = clone(state);
  let rmap = { ...roles };
  for (let step = 0; step < maxSteps && !s.over; step++) {
    rmap = relockRoles(s, rmap);
    const cpid = s.currentPlayerId;
    const action = chooseAiAction(s, cpid, rmap);
    if (!action) break;
    const result = applyAction(s, action);
    if (!result.ok) break;
    s = result.state;
  }
  return s;
}

function actionKey(action: Action): string {
  return JSON.stringify(action);
}

/**
 * 对粗排前 width 个根动作（+ 可选 loan）：各推到终局，取锚定 VP 最高者。
 * 建议只在 `state.era === 2` 调用；时代 1 请用 `era1AnchorChoose`。
 */
export function finalAnchorChoose(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { width?: number; topM?: number; includeLoan?: boolean } = {},
): Action | null {
  const width = opts.width ?? 4;
  const topM = opts.topM ?? Math.max(12, width + 4);
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
  if (opts.includeLoan !== false) push(pickLoanAction(state, pid, roles[pid]));

  let best: Action | null = null;
  let bestV = -Infinity;
  for (const action of roots) {
    const applied = applyAction(clone(state), action);
    if (!applied.ok) continue;
    const end = playToGameOver(applied.state, roles);
    if (!end.over && !Number.isFinite(finalAnchorValue(end, pid))) continue;
    const v = finalAnchorValue(end, pid);
    if (v > bestV) {
      bestV = v;
      best = action;
    }
  }
  return best;
}
