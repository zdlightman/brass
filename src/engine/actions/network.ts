import { cardLabel, discardCard } from '../cards';
import { mapData, oilfieldTiles, pipeline, rail } from '../catalog';
import { clone } from '../clone';
import {
  inNetwork,
  linkAdjacentToNetwork,
  occupiedPipelineLineIds,
  occupiedRailLineIds,
  playerHasBoardPresence,
} from '../graph';
import { describeTrainScore } from '../era';
import { player } from '../mat';
import { consumeCubes, formatSpend, type SpendStep } from '../resources';
import { describeReward, lineName, placeName, playerTag } from '../logText';
import { applyReward } from '../rewards';
import { addOilBarrels } from '../oil';
import { deferLog } from '../logQueue';
import { logAction, spendMoney } from '../turn';
import type {
  Action,
  ActionResult,
  Cube,
  GameState,
  LinkKind,
  NetworkPlacement,
  PlayerId,
} from '../types';

const RESOURCE_HEAVY_CUBES = 1;

export function linkResourceCost(kind: LinkKind): Partial<Record<Cube, number>> {
  if (kind === 'lightTrain') return { coal: 1 };
  if (kind === 'heavyTrain') return { steel: 2 };
  return { iron: 1 };
}

export function destLocationsFor(placement: NetworkPlacement): string[] {
  if (placement.kind === 'pipeline') {
    const p = pipeline(placement.lineId);
    return p ? [p.city] : [];
  }
  const r = rail(placement.lineId);
  return r ? [r.a, r.b] : [];
}

export function applyNetwork(
  state: GameState,
  action: Extract<Action, { type: 'network' }>,
): ActionResult {
  if (action.secondLink) {
    if (action.placements.length !== 1) return { ok: false, error: 'The second link is one tile.' };
    const placement = action.placements[0];
    if (!placement) return { ok: false, error: 'Missing placement.' };
    if (!spendMoney(state, action.playerId, 10)) return { ok: false, error: 'Second link costs $10.' };
    const placed = placeLink(state, action.playerId, placement);
    if (!placed.ok) return placed;
    logAction(
      state,
      `${playerTag(action.playerId)} 再铺一条：${linkKind(placement)}${lineName(placement.lineId)}。${linkNote(state, true)}`,
    );
    return { ok: true, state };
  }
  if (action.placements.length < 1 || action.placements.length > 2) {
    return { ok: false, error: 'Network places 1 or 2 links.' };
  }
  const p = player(state, action.playerId);
  const card = discardCard(p, action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };

  const notes: string[] = [];
  for (let i = 0; i < action.placements.length; i++) {
    const placement = action.placements[i];
    if (!placement) return { ok: false, error: 'Missing placement.' };
    if (i === 1 && !spendMoney(state, action.playerId, 10)) {
      return { ok: false, error: 'Second link costs $10.' };
    }
    const placed = placeLink(state, action.playerId, placement);
    if (!placed.ok) return placed;
    notes.push(`${linkKind(placement)}${lineName(placement.lineId)}${linkNote(state, i === 1)}`);
  }
  logAction(state, `${playerTag(p.id)} 铺设（${cardLabel(card)}）：${notes.join('；')}。`);
  return { ok: true, state };
}

export function placeLink(
  state: GameState,
  playerId: PlayerId,
  placement: NetworkPlacement,
): ActionResult {
  const p = player(state, playerId);
  const dest = destLocationsFor(placement);
  if (dest.length === 0) return { ok: false, error: 'Unknown line.' };

  const hasPresence = playerHasBoardPresence(state, playerId);
  if (hasPresence) {
    const kind = placement.kind === 'pipeline' ? 'pipeline' : 'rail';
    if (!linkAdjacentToNetwork(state, playerId, placement.lineId, kind)) {
      return { ok: false, error: 'Link must touch your network.' };
    }
  }

  if (placement.kind === 'pipeline') {
    if (occupiedPipelineLineIds(state).has(placement.lineId)) {
      return { ok: false, error: 'Pipeline route is occupied.' };
    }
    if (!placement.pipelineType) return { ok: false, error: 'Choose a pipeline type.' };
    if (!p.pipelineSupply.some((x) => x.type === placement.pipelineType)) {
      return { ok: false, error: 'That pipeline is not in your supply.' };
    }
  } else if (placement.kind === 'lightTrain') {
    if (occupiedRailLineIds(state).has(placement.lineId) && !placement.replaceLinkId) {
      return { ok: false, error: 'Railroad is occupied.' };
    }
    if (placement.replaceLinkId) return { ok: false, error: 'Only a replacement heavy train can replace a link.' };
    if (p.lightTrains < 1) return { ok: false, error: 'No light trains left.' };
  } else {
    if (!placement.heavyType) return { ok: false, error: 'Choose a heavy train type.' };
    if (!p.heavySupply.some((h) => h.type === placement.heavyType)) {
      return { ok: false, error: 'That heavy train is not in your supply.' };
    }
    if (placement.heavyType === 'replacement') {
      const replaced = state.links.find((l) => l.id === placement.replaceLinkId);
      if (!replaced || replaced.kind !== 'lightTrain' || replaced.owner === playerId) {
        return { ok: false, error: 'Replacement must target another player’s light train.' };
      }
      if (replaced.lineId !== placement.lineId) return { ok: false, error: 'Replacement line mismatch.' };
    } else if (occupiedRailLineIds(state).has(placement.lineId)) {
      return { ok: false, error: 'Railroad is occupied.' };
    }
  }

  const paid = consumeCubes(
    state,
    playerId,
    linkResourceCost(placement.kind),
    dest,
    placement.sources,
    placement.kind === 'heavyTrain' ? '__building__' : undefined,
  );
  if (!paid.ok) return paid;
  lastLinkSpend = paid.steps;
  lastLinkOutcome = '';

  if (placement.kind === 'pipeline') {
    const pipeType = placement.pipelineType;
    if (!pipeType) return { ok: false, error: 'Choose a pipeline type.' };
    const piece = takePipeline(p, pipeType);
    if (!piece) return { ok: false, error: 'Pipeline missing.' };
    lastPipeLabel = pipeLabel(pipeType, piece);
    const line = pipeline(placement.lineId);
    if (!line) return { ok: false, error: 'Unknown pipeline.' };
    const already = state.links.some((l) => {
      if (l.kind !== 'pipeline') return false;
      return pipeline(l.lineId)?.oilfield === line.oilfield;
    });
    state.links.push({
      id: `lnk-${state.links.length}-${placement.lineId}`,
      lineId: placement.lineId,
      kind: 'pipeline',
      owner: playerId,
      pipelineType: placement.pipelineType,
      pipelineIncome: piece.incomeSpaces,
      pipelinePoints: piece.points,
      cubes: {},
      doubleLink: false,
    });
    const field = state.oilfields.find((o) => o.id === line.oilfield);
    const added = line.oil + (placement.pipelineType === 'reserve' ? 1 : 0);
    const fieldName = placeName(line.oilfield);
    if (field) {
      addOilBarrels(field, added);
      const revealed = !already ? revealOilfield(state, playerId, field.id) : '这块油田已经揭开。';
      const stock = (field.oilCitySlot?.cubes.oil ?? 0) + field.oil;
      lastLinkOutcome = `${revealed}油田加上 ${added} 桶，现有 ${stock} 桶`;
    } else {
      lastLinkOutcome = `铺到 ${fieldName}。`;
    }
    return { ok: true, state };
  }

  if (placement.replaceLinkId) {
    const replaced = state.links.find((l) => l.id === placement.replaceLinkId);
    if (!replaced) return { ok: false, error: 'Replaced link missing.' };
    scoreTrain(state, replaced.id);
    const owner = player(state, replaced.owner);
    owner.lightTrains += 1;
    state.links = state.links.filter((l) => l.id !== replaced.id);
  }

  if (placement.kind === 'lightTrain') {
    p.lightTrains -= 1;
    state.links.push({
      id: `lnk-${state.links.length}-${placement.lineId}`,
      lineId: placement.lineId,
      kind: 'lightTrain',
      owner: playerId,
      cubes: {},
      doubleLink: false,
    });
  } else {
    const hi = p.heavySupply.findIndex((h) => h.type === placement.heavyType);
    if (hi < 0) return { ok: false, error: 'Heavy train missing.' };
    p.heavySupply.splice(hi, 1);
    p.heavyTrainsBuilt += 1;
    const cubes: LinkStateCubes = {};
    if (placement.heavyType === 'cokeResource') cubes.coke = RESOURCE_HEAVY_CUBES;
    if (placement.heavyType === 'steelResource') cubes.steel = RESOURCE_HEAVY_CUBES;
    if (placement.heavyType === 'oilResource') cubes.oil = RESOURCE_HEAVY_CUBES;
    state.links.push({
      id: `lnk-${state.links.length}-${placement.lineId}`,
      lineId: placement.lineId,
      kind: 'heavyTrain',
      owner: playerId,
      heavyType: placement.heavyType,
      cubes,
      doubleLink: placement.heavyType === 'doubleLink',
    });
    if (placement.heavyType === 'whiskey') {
      applyReward(state, playerId, { whiskey: 1 });
      lastLinkOutcome = '重车附带威士忌 1';
    }
  }

  const line = rail(placement.lineId);
  const bonus: string[] = [];
  if (line?.bonus && !placement.replaceLinkId) {
    if (line.bonus.whiskey) {
      applyReward(state, playerId, { whiskey: line.bonus.whiskey });
      bonus.push(`威士忌 +${line.bonus.whiskey}`);
    }
    if (line.bonus.incomeSpaces) {
      applyReward(state, playerId, { incomeSpaces: line.bonus.incomeSpaces });
      bonus.push(`收入 +${line.bonus.incomeSpaces} 格`);
    }
    if (line.bonus.lightTrains) {
      p.lightTrains += line.bonus.lightTrains;
      bonus.push(`收回轻轨 ${line.bonus.lightTrains}`);
    }
    if (line.bonus.freeDevelop) {
      state.pendingOilDevelopPlayerId = playerId;
      bonus.push('一次免费研发，要移除一块产业或跳过');
    }
  }
  if (bonus.length) lastLinkOutcome = `${lastLinkOutcome ? `${lastLinkOutcome}。` : ''}道路奖励：${bonus.join('，')}`;
  return { ok: true, state };
}

type LinkStateCubes = { coal?: number; iron?: number; coke?: number; steel?: number; oil?: number };

let lastLinkSpend: SpendStep[] = [];
let lastLinkOutcome = '';

let lastPipeLabel = '管道';

function pipeLabel(
  type: NonNullable<NetworkPlacement['pipelineType']>,
  piece: { points?: number },
): string {
  if (type === 'income') return '收入管道';
  if (type === 'reserve') return '储备管道';
  if (type === 'money') return '现金管道';
  return `${piece.points ?? 0}分管道`;
}

function linkKind(placement: NetworkPlacement): string {
  if (placement.kind === 'pipeline') return `${lastPipeLabel} `;
  if (placement.kind === 'heavyTrain') return '重车 ';
  return '轻轨 ';
}

function linkNote(state: GameState, second: boolean): string {
  const bits: string[] = [];
  if (second) bits.push('双修 $10');
  if (lastLinkSpend.length) bits.push(formatSpend(state, lastLinkSpend));
  const cost = bits.length ? `（${bits.join('，')}）` : '';
  return `${cost}${lastLinkOutcome ? `。${lastLinkOutcome}` : ''}`;
}

function takePipeline(
  p: ReturnType<typeof player>,
  type: NonNullable<NetworkPlacement['pipelineType']>,
): { incomeSpaces?: number; points?: number } | null {
  const idx = p.pipelineSupply.findIndex((x) => x.type === type);
  if (idx < 0) return null;
  const [piece] = p.pipelineSupply.splice(idx, 1);
  return piece ?? null;
}

function revealOilfield(state: GameState, playerId: PlayerId, oilfieldId: string): string {
  const field = state.oilfields.find((o) => o.id === oilfieldId);
  if (!field || field.revealed) return '';
  field.revealed = true;
  const def = oilfieldTiles.find((t) => t.id === field.tileId);
  const bits: string[] = [];
  if (def?.revealReward) {
    const { freeDevelops, ...rest } = def.revealReward;
    const granted = describeReward(rest);
    if (granted !== '没有现金或收入') bits.push(granted);
    applyReward(state, playerId, rest);
    if (freeDevelops) {
      state.pendingOilDevelopPlayerId = playerId;
      bits.push('一次免费研发，要移除一块产业或跳过');
    }
  }
  if (state.era === 2 && field.pendingEra2Oil > 0) {
    const extra = field.pendingEra2Oil;
    addOilBarrels(field, extra);
    field.pendingEra2Oil = 0;
    bits.push(`时代 2 再放入 ${extra} 桶`);
  }
  const reward = bits.length ? bits.join('，') : '没有额外收益';
  return `揭开 ${placeName(oilfieldId)}，六角片：${reward}。`;
}

function scoreTrain(state: GameState, linkId: string): void {
  const link = state.links.find((l) => l.id === linkId);
  if (!link) return;
  const scored = describeTrainScore(state, link);
  if (!scored) return;
  player(state, link.owner).vp += scored.vp;
  deferLog(
    state,
    `${playerTag(link.owner)} 的${scored.detail}被重车踢掉，${playerTag(link.owner)} 记连接分 ${scored.vp}。`,
  );
}

export function legalNetworkPlacements(state: GameState, playerId: PlayerId): NetworkPlacement[] {
  const p = player(state, playerId);
  const out: NetworkPlacement[] = [];
  const tryAdd = (placement: NetworkPlacement) => {
    const copy = clone(state);
    const result = placeLink(copy, playerId, placement);
    if (result.ok) out.push(placement);
  };

  if (p.lightTrains > 0) {
    for (const line of mapData.railLines) {
      tryAdd({ lineId: line.id, kind: 'lightTrain', sources: [] });
    }
  }
  for (const heavy of p.heavySupply) {
    for (const line of mapData.railLines) {
      if (heavy.type === 'replacement') {
        for (const link of state.links) {
          if (link.kind === 'lightTrain' && link.owner !== playerId && link.lineId === line.id) {
            tryAdd({
              lineId: line.id,
              kind: 'heavyTrain',
              heavyType: 'replacement',
              replaceLinkId: link.id,
              sources: [],
            });
          }
        }
      } else {
        tryAdd({ lineId: line.id, kind: 'heavyTrain', heavyType: heavy.type, sources: [] });
      }
    }
  }
  for (const pipe of p.pipelineSupply) {
    for (const line of mapData.pipelineLines) {
      tryAdd({
        lineId: line.id,
        kind: 'pipeline',
        pipelineType: pipe.type,
        sources: [],
      });
    }
  }
  return out;
}

export function canPlaceOnLine(
  state: GameState,
  playerId: PlayerId,
  lineId: string,
): boolean {
  return legalNetworkPlacements(state, playerId).some((p) => p.lineId === lineId);
}

export { inNetwork };
