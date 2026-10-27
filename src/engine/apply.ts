import { applyBuild } from './actions/build';
import { applyDevelop, applyOilDevelop, declineOilDevelop } from './actions/develop';
import { applyLoan } from './actions/loan';
import { applyNetwork } from './actions/network';
import { applyPass } from './actions/pass';
import { applySell } from './actions/sell';
import { clone } from './clone';
import { finishAction } from './turn';
import type { Action, ActionResult, GameState } from './types';

export type ApplyOptions = { holdTurn?: boolean; manualConfirm?: boolean };

function dispatch(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'pass':
      return applyPass(state, action);
    case 'loan':
      return applyLoan(state, action);
    case 'network':
      return applyNetwork(state, action);
    case 'build':
      return applyBuild(state, action);
    case 'develop':
      return applyDevelop(state, action);
    case 'oilDevelop':
      return applyOilDevelop(state, action);
    case 'declineOilDevelop':
      return declineOilDevelop(state, action);
    case 'sell':
      return applySell(state, action);
    case 'declineSell':
      return { ok: true, state };
  }
}

export function applyAction(state: GameState, action: Action, options?: ApplyOptions): ActionResult {
  if (state.over) return { ok: false, error: 'The game is over.' };
  if (state.eraScoreHeld) return { ok: false, error: 'Era 1 is waiting for scoring.' };
  if (state.pendingConfirm) return { ok: false, error: 'Confirm the turn first.' };
  if (state.pendingOilDevelopPlayerId !== null && action.type !== 'oilDevelop' && action.type !== 'declineOilDevelop') {
    return { ok: false, error: 'Resolve the free develop first.' };
  }
  if (action.playerId !== state.currentPlayerId) return { ok: false, error: 'Not this player’s turn.' };
  if (state.bonusSellPlayerId !== null && action.type !== 'sell' && action.type !== 'declineSell') {
    return { ok: false, error: 'Resolve the bonus sell first.' };
  }
  const next = clone(state);
  const result = dispatch(next, action);
  if (!result.ok) return result;
  const openedOilDevelop =
    action.type === 'network' &&
    state.pendingOilDevelopPlayerId === null &&
    result.state.pendingOilDevelopPlayerId !== null;
  if (openedOilDevelop) {
    result.state.oilDevelopThenFinish = !options?.holdTurn;
    return result;
  }
  if (action.type === 'oilDevelop' || action.type === 'declineOilDevelop') {
    const finish = state.oilDevelopThenFinish;
    result.state.pendingOilDevelopPlayerId = null;
    result.state.oilDevelopThenFinish = false;
    if (finish) finishAction(result.state, options?.manualConfirm);
    return result;
  }
  if (action.type === 'build' && result.state.bonusSellPlayerId !== null) return result;
  if (action.type === 'declineSell' || (action.type === 'sell' && state.bonusSellPlayerId !== null)) {
    result.state.bonusSellPlayerId = null;
  }
  if (!options?.holdTurn) finishAction(result.state, options?.manualConfirm);
  return result;
}
