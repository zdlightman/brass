import { cardDef } from './catalog';
import type { Card, GameState, PlayerId, PlayerState } from './types';
import { player } from './mat';

export function discardCard(p: PlayerState, cardId: string): Card | null {
  const i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const [card] = p.hand.splice(i, 1);
  if (!card) return null;
  p.discard.push(card);
  return card;
}

export function drawToHand(state: GameState, playerId: PlayerId, upTo = 8): void {
  const p = player(state, playerId);
  while (p.hand.length < upTo && state.deck.length > 0) {
    const card = state.deck.shift();
    if (!card) break;
    p.hand.push(card);
  }
}

/** Combined industry cards. Coal and coke are one card, and the same for the other three faces. */
const COMBINED_LABEL: Record<string, string> = {
  coal: '煤/焦炭',
  coke: '煤/焦炭',
  manufacturing: '制造/汽车',
  automobile: '制造/汽车',
  locomotive: '制造/汽车',
  kerosene: '煤油/石油',
  oilCity: '煤油/石油',
  iron: '铁/钢',
  steel: '铁/钢',
  skyscraper: '铁/钢',
};

export function cardLabel(card: Card): string {
  const def = cardDef(card.defId);
  if (def.kind === 'industry' && def.industry && COMBINED_LABEL[def.industry]) return COMBINED_LABEL[def.industry];
  return def.label;
}
