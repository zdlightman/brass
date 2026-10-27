import { drawToHand } from './cards';
import { rail, tile } from './catalog';
import { locationLinkPoints } from './graph';
import { incomeLevelAt } from './income';
import { lineName, placeName, playerTag, tileName } from './logText';
import { player } from './mat';
import { addOilBarrels } from './oil';
import { shuffle } from './rng';
import type { GameState, LinkState, PlayerId, PlayerState, SlotState, TileDef } from './types';

/** Score trains and flipped industries. Removal is separate so a game can stop between them. */
export function scoreEra(state: GameState, options?: { remove?: boolean }): void {
  for (const link of state.links) {
    const scored = describeTrainScore(state, link);
    if (!scored) continue;
    player(state, link.owner).vp += scored.vp;
    state.log.push({
      text: `时代计分：${playerTag(link.owner)} 的${scored.detail}，${playerTag(link.owner)} 记连接分 ${scored.vp}。`,
    });
  }

  for (const slot of industrySlots(state)) {
    if (!slot.flipped || !slot.tileDefId || slot.owner === null) continue;
    const def = tile(slot.tileDefId);
    const vp = eraPoints(state, slot.owner, def);
    player(state, slot.owner).vp += vp;
    const why = eraPointNote(state, slot.owner, def);
    state.log.push({
      text: `时代计分：${playerTag(slot.owner)} 的 ${placeName(slot.locationId)} ${tileName(def.id)}${why}，${playerTag(slot.owner)} 记产业分 ${vp}。`,
    });
  }

  if (options?.remove === false) return;

  if (state.era === 1) {
    const back = new Map<PlayerId, number>();
    state.links = state.links.filter((link) => {
      if (link.kind !== 'lightTrain') return true;
      back.set(link.owner, (back.get(link.owner) ?? 0) + 1);
      return false;
    });
    for (const [id, count] of back) player(state, id).lightTrains += count;
  } else {
    state.links = state.links.filter((link) => link.kind === 'pipeline');
  }

  if (state.era !== 1) return;

  for (const slot of state.slots) {
    if (!slot.tileDefId || tile(slot.tileDefId).level !== 1) continue;
    slot.tileDefId = null;
    slot.owner = null;
    slot.flipped = false;
    slot.cubes = {};
  }
  for (const field of state.oilfields) {
    addOilBarrels(field, field.pendingEra2Oil);
    field.pendingEra2Oil = 0;
  }

  const discards = state.players.flatMap((p) => p.discard);
  for (const p of state.players) p.discard = [];
  state.setupDiscards = [];
  const shuffled = shuffle(discards, state.rng);
  state.deck = shuffled.items;
  state.rng = shuffled.rng;
  for (const p of state.players) drawToHand(state, p.id, 8);
}

export function decideWinner(state: GameState): PlayerId {
  const ranked = [...state.players].sort((a, b) => {
    if (b.vp !== a.vp) return b.vp - a.vp;
    if (b.incomeSpace !== a.incomeSpace) return b.incomeSpace - a.incomeSpace;
    if (b.money !== a.money) return b.money - a.money;
    return a.id - b.id;
  });
  return ranked[0]!.id;
}

export function describeTrainScore(state: GameState, link: LinkState): { vp: number; detail: string } | null {
  if (link.kind === 'pipeline') return null;
  const line = rail(link.lineId);
  if (!line) return null;
  const a = locationLinkPoints(state, line.a);
  const b = locationLinkPoints(state, line.b);
  let vp = a + b;
  if (link.doubleLink) vp *= 2;
  const kind = link.kind === 'lightTrain' ? '轻轨' : '重车';
  const doubled = link.doubleLink ? '，双连 ×2' : '';
  return {
    vp,
    detail: `${kind} ${lineName(line.id)}（${placeName(line.a)} ${a} + ${placeName(line.b)} ${b}${doubled}）`,
  };
}

/** Printed era VP for a flipped industry, including crowns that are not a fixed number. */
export function eraPoints(state: GameState, playerId: PlayerId, def: TileDef): number {
  if (def.eraScore === 'incomeLevel') return incomeLevelAt(player(state, playerId).incomeSpace);
  if (def.kind === 'polyphase') return emptyIndustrySlots(player(state, playerId));
  if (def.kind === 'locomotive') {
    return state.links.filter((link) => link.kind === 'heavyTrain' && link.owner === playerId).length * 4;
  }
  if (def.kind === 'oilCity') {
    return state.links.filter((link) => link.kind === 'pipeline' && link.owner === playerId).length * 4;
  }
  return def.vp;
}

function eraPointNote(state: GameState, playerId: PlayerId, def: TileDef): string {
  if (def.eraScore === 'incomeLevel') return `（收入等级 ${incomeLevelAt(player(state, playerId).incomeSpace)}）`;
  if (def.kind === 'polyphase') return `（个人版图空位 ${emptyIndustrySlots(player(state, playerId))}）`;
  if (def.kind === 'locomotive') {
    const trains = state.links.filter((link) => link.kind === 'heavyTrain' && link.owner === playerId).length;
    return `（重车 ${trains} × 4）`;
  }
  if (def.kind === 'oilCity') {
    const pipes = state.links.filter((link) => link.kind === 'pipeline' && link.owner === playerId).length;
    return `（管道 ${pipes} × 4）`;
  }
  return '';
}

function emptyIndustrySlots(p: PlayerState): number {
  const ids = new Set(p.mat.map((entry) => entry.defId));
  let empty = 0;
  for (const id of ids) {
    if (p.mat.every((entry) => entry.defId !== id || entry.removed)) empty += 1;
  }
  return empty;
}

function industrySlots(state: GameState): SlotState[] {
  const slots = [...state.slots];
  for (const field of state.oilfields) {
    if (field.oilCitySlot) slots.push(field.oilCitySlot);
  }
  return slots;
}

