import { cardLabel, discardCard } from '../cards';
import { decreaseIncomeLevels } from '../income';
import { playerTag } from '../logText';
import { player } from '../mat';
import { logAction } from '../turn';
import type { Action, ActionResult, GameState } from '../types';

export function applyLoan(state: GameState, action: Extract<Action, { type: 'loan' }>): ActionResult {
  const p = player(state, action.playerId);
  const nextSpace = decreaseIncomeLevels(p.incomeSpace, 3);
  if (nextSpace === null) return { ok: false, error: 'Cannot take a loan: income cannot fall below −10.' };
  const card = discardCard(p, action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };
  p.incomeSpace = nextSpace;
  p.money += 30;
  logAction(state, `${playerTag(p.id)} 贷款（${cardLabel(card)}），手头 $${p.money}。`);
  return { ok: true, state };
}
