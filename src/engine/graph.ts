import { mapData, tile } from './catalog';
import type { GameState, PlayerId } from './types';

export function occupiedRailLineIds(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const link of state.links) {
    if (link.kind !== 'pipeline') s.add(link.lineId);
  }
  return s;
}

export function occupiedPipelineLineIds(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const link of state.links) {
    if (link.kind === 'pipeline') s.add(link.lineId);
  }
  return s;
}

export function railConnected(state: GameState, a: string, b: string): boolean {
  if (a === b) return true;
  const occupied = occupiedRailLineIds(state);
  const adj = new Map<string, string[]>();
  for (const line of mapData.railLines) {
    if (!occupied.has(line.id)) continue;
    const la = adj.get(line.a) ?? [];
    la.push(line.b);
    adj.set(line.a, la);
    const lb = adj.get(line.b) ?? [];
    lb.push(line.a);
    adj.set(line.b, lb);
  }
  const seen = new Set<string>([a]);
  const q = [a];
  while (q.length) {
    const cur = q.shift();
    if (cur === undefined) break;
    if (cur === b) return true;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return false;
}

export function playerHasBoardPresence(state: GameState, playerId: PlayerId): boolean {
  if (state.slots.some((s) => s.owner === playerId && s.tileDefId)) return true;
  if (state.oilfields.some((o) => o.oilCitySlot?.owner === playerId)) return true;
  return state.links.some((l) => l.owner === playerId);
}

export function locationsInNetwork(state: GameState, playerId: PlayerId): Set<string> {
  const set = new Set<string>();
  for (const slot of state.slots) {
    if (slot.owner === playerId && slot.tileDefId) set.add(slot.locationId);
  }
  for (const ofield of state.oilfields) {
    if (ofield.oilCitySlot?.owner === playerId) {
      for (const p of mapData.pipelineLines) {
        if (p.oilfield === ofield.id) set.add(p.city);
      }
    }
  }
  for (const link of state.links) {
    if (link.owner !== playerId) continue;
    if (link.kind === 'pipeline') {
      const p = mapData.pipelineLines.find((x) => x.id === link.lineId);
      if (p) set.add(p.city);
    } else {
      const r = mapData.railLines.find((x) => x.id === link.lineId);
      if (r) {
        set.add(r.a);
        set.add(r.b);
      }
    }
  }
  return set;
}

export function inNetwork(state: GameState, playerId: PlayerId, locationId: string): boolean {
  return locationsInNetwork(state, playerId).has(locationId);
}

export function linkAdjacentToNetwork(
  state: GameState,
  playerId: PlayerId,
  lineId: string,
  kind: 'rail' | 'pipeline',
): boolean {
  const net = locationsInNetwork(state, playerId);
  if (kind === 'rail') {
    const r = mapData.railLines.find((x) => x.id === lineId);
    if (!r) return false;
    return net.has(r.a) || net.has(r.b);
  }
  const p = mapData.pipelineLines.find((x) => x.id === lineId);
  if (!p) return false;
  return net.has(p.city) || ownsOilfield(state, playerId, p.oilfield);
}

/** An oilfield is a network node once this player has a pipeline or an Oil City on it. */
function ownsOilfield(state: GameState, playerId: PlayerId, oilfieldId: string): boolean {
  const field = state.oilfields.find((entry) => entry.id === oilfieldId);
  if (field?.oilCitySlot?.owner === playerId) return true;
  return state.links.some((link) => {
    if (link.owner !== playerId || link.kind !== 'pipeline') return false;
    return mapData.pipelineLines.find((line) => line.id === link.lineId)?.oilfield === oilfieldId;
  });
}

/** Flipped industries in a city. A connection with no industry spaces keeps its own 2 points. */
export function locationLinkPoints(state: GameState, locationId: string): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.locationId !== locationId || !slot.flipped || !slot.tileDefId) continue;
    n += tile(slot.tileDefId).linkPoints;
  }
  const loc = mapData.locations.find((l) => l.id === locationId);
  if (loc && loc.slots.length === 0) n += 2;
  return n;
}

export function needLocationsForRail(lineId: string): string[] {
  const r = mapData.railLines.find((x) => x.id === lineId);
  return r ? [r.a, r.b] : [];
}

export function needLocationForPipeline(lineId: string): string | null {
  const p = mapData.pipelineLines.find((x) => x.id === lineId);
  return p?.city ?? null;
}
