import { cardLabel, discardCard } from '../cards';
import { playerTag } from '../logText';
import { player } from '../mat';
import { gainWhiskey, logAction } from '../turn';
import type { Action, ActionResult, GameState } from '../types';

export function applyPass(state: GameState, action: Extract<Action, { type: 'pass' }>): ActionResult {
  const p = player(state, action.playerId);
  const card = discardCard(p, action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };
  gainWhiskey(state, action.playerId, 1);
  logAction(state, `${playerTag(p.id)} 跳过（${cardLabel(card)}），威士忌 ${p.whiskey}。`);
  return { ok: true, state };
}
