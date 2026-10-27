import { decreaseIncomeLevels } from './income';
import { player } from './mat';
import type { Action, GameState, PlayerId } from './types';

export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  if (state.over || playerId !== state.currentPlayerId) return [];
  const p = player(state, playerId);
  const actions: Action[] = [];
  const canLoan = decreaseIncomeLevels(p.incomeSpace, 3) !== null;
  for (const card of p.hand) {
    actions.push({ type: 'pass', playerId, cardId: card.id });
    if (canLoan) actions.push({ type: 'loan', playerId, cardId: card.id });
  }
  return actions;
}
