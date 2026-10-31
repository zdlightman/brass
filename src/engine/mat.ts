import { tile, tileDefs } from './catalog';
import type { GameState, MatTile, PlayerId, PlayerState, TileDef } from './types';

export function player(state: GameState, id: PlayerId): PlayerState {
  const p = state.players[id];
  if (!p) throw new Error('missing player');
  return p;
}

export function remainingTileIds(p: PlayerState): Set<string> {
  return new Set(p.mat.filter((m) => !m.removed).map((m) => m.defId));
}

/**
 * A tile stays covered until every id in this list has been removed.
 * Manufacturing III uncovers both the tile to its right (IV) and the tile above it (V).
 */
const COVERED_BY: Record<string, string[]> = {
  k3: ['k2'],
  k4: ['k3'],
  oilCity: ['k4'],
  c2: ['c1'],
  c3: ['c2'],
  polyphase: ['c3'],
  m2: ['m1'],
  m3: ['m2'],
  m4: ['m3'],
  m5: ['m3'],
  a1: ['m4'],
  locomotive: ['m5'],
  ck2: ['ck1'],
  s2: ['i1'],
  s4: ['s2'],
  sky1: ['s2'],
  sky2: ['s4'],
};

/** Printed stack sizes. One entry is removed per build. */
export const MAT_SUPPLY: [string, number][] = [
  ['k2', 2],
  ['k3', 3],
  ['k4', 2],
  ['oilCity', 1],
  ['c1', 1],
  ['c2', 2],
  ['c3', 2],
  ['polyphase', 1],
  ['m1', 2],
  ['m2', 1],
  ['m3', 2],
  ['m4', 1],
  ['m5', 2],
  ['a1', 3],
  ['locomotive', 1],
  ['ck1', 1],
  ['ck2', 2],
  ['i1', 1],
  ['s2', 2],
  ['s4', 2],
  ['sky1', 1],
  ['sky2', 1],
];

export function tileIsAccessible(tileId: string, remaining: Set<string>): boolean {
  if (!remaining.has(tileId)) return false;
  const covers = COVERED_BY[tileId];
  if (covers) return covers.every((id) => !remaining.has(id));
  const preds = tileDefs.filter((t) => t.nextIds.includes(tileId)).map((x) => x.id);
  if (preds.length === 0) return true;
  return preds.some((pred) => !remaining.has(pred));
}

export function accessibleTileIds(mat: MatTile[], extraRemoved: Iterable<string> = []): Set<string> {
  const remaining = new Set(mat.filter((tile) => !tile.removed).map((tile) => tile.defId));
  // 额外"已移除"集（前端连锁研发：已选的低级 tile 视为已研，解锁由它覆盖的高一级，使其可在同一动作选）。
  for (const id of extraRemoved) remaining.delete(id);
  const ids = new Set<string>();
  for (const tile of mat) {
    if (tileIsAccessible(tile.defId, remaining)) ids.add(tile.defId);
  }
  return ids;
}

export function accessibleTileDefs(p: PlayerState): TileDef[] {
  const remaining = remainingTileIds(p);
  const out: TileDef[] = [];
  for (const m of p.mat) {
    if (m.removed) continue;
    if (tileIsAccessible(m.defId, remaining)) out.push(tile(m.defId));
  }
  return out;
}

export function emptyMatSpaces(p: PlayerState): number {
  return p.mat.filter((m) => m.removed).length;
}

export function removeMatTile(p: PlayerState, defId: string): boolean {
  const m = p.mat.find((x) => x.defId === defId && !x.removed);
  if (!m) return false;
  m.removed = true;
  if (!p.mat.some((tile) => tile.defId === defId && !tile.removed)) unlockLinksFromTile(p, defId);
  return true;
}

export function unlockLinksFromTile(p: PlayerState, defId: string): void {
  const t = tile(defId);
  for (const key of t.unlockLinkIds) {
    const hi = p.lockedHeavies.findIndex((h) => h.unlockAfter === key);
    if (hi >= 0) {
      const h = p.lockedHeavies[hi];
      p.lockedHeavies.splice(hi, 1);
      if (h) p.heavySupply.push({ type: h.type });
    }
    const pi = p.lockedPipes.findIndex((x) => x.unlockAfter === key);
    if (pi >= 0) {
      const pipe = p.lockedPipes[pi];
      p.lockedPipes.splice(pi, 1);
      if (pipe) p.pipelineSupply.push({ type: pipe.type, incomeSpaces: pipe.incomeSpaces, points: pipe.points });
    }
  }
}
