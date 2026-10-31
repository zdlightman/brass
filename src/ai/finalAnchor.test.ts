import { describe, it, expect } from 'vitest';
import { applyAction } from '../engine/apply';
import { createGame } from '../engine/state';
import { assignRoles, chooseAiAction, relockRoles } from './choose';
import { finalAnchorChoose, finalAnchorValue, playToGameOver } from './finalAnchor';

/** 贪心推到时代 2 开局（或终局），供终局定锚烟测。 */
function playToEra2(seed: number, maxSteps = 2000) {
  let state = createGame(seed);
  let roles = assignRoles(state);
  for (let step = 0; step < maxSteps && !state.over && state.era === 1; step++) {
    roles = relockRoles(state, roles);
    const action = chooseAiAction(state, state.currentPlayerId, roles);
    if (!action) break;
    const result = applyAction(state, action);
    if (!result.ok) break;
    state = result.state;
  }
  return { state, roles };
}

describe('finalAnchor（终局 VP 定锚）', () => {
  it('playToGameOver 能推到终局并给出有限锚定值', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    const end = playToGameOver(game, roles);
    expect(end.over).toBe(true);
    expect(Number.isFinite(finalAnchorValue(end, 0))).toBe(true);
  }, 180_000);

  it('时代 2 局面 finalAnchorChoose 返回合法根招', () => {
    const { state, roles } = playToEra2(777);
    expect(state.era === 2 || state.over).toBe(true);
    if (state.over) return;
    const pid = state.currentPlayerId;
    const action = finalAnchorChoose(state, pid, roles, { width: 2 });
    expect(action).not.toBeNull();
    if (!action) return;
    const applied = applyAction(state, action);
    expect(applied.ok).toBe(true);
  }, 300_000);
});
