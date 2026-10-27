import { describe, expect, it } from 'vitest';
import { accessibleTileIds, removeMatTile } from './mat';
import { createGame } from './state';
import type { MatTile } from './types';

describe('mat supply', () => {
  it('starts with two manufacturing I tiles and hides the tiles they cover', () => {
    const mat = createGame(1).players[0]!.mat;
    expect(mat.filter((tile) => tile.defId === 'm1' && !tile.removed)).toHaveLength(2);
    const open = accessibleTileIds(mat);
    expect(open.has('m1')).toBe(true);
    expect(open.has('m2')).toBe(false);
    expect(open.has('m4')).toBe(false);
    expect(open.has('m5')).toBe(false);
  });

  it('uncovers manufacturing IV and V together after both level III tiles are built', () => {
    const mat: MatTile[] = [
      { defId: 'm4', removed: false },
      { defId: 'm5', removed: false },
      { defId: 'm5', removed: false },
      { defId: 'm3', removed: true },
      { defId: 'm3', removed: true },
    ];
    const open = accessibleTileIds(mat);
    expect(open.has('m4')).toBe(true);
    expect(open.has('m5')).toBe(true);
  });

  it('keeps manufacturing IV covered while one level III tile remains', () => {
    const mat: MatTile[] = [
      { defId: 'm4', removed: false },
      { defId: 'm5', removed: false },
      { defId: 'm3', removed: true },
      { defId: 'm3', removed: false },
    ];
    const open = accessibleTileIds(mat);
    expect(open.has('m3')).toBe(true);
    expect(open.has('m4')).toBe(false);
    expect(open.has('m5')).toBe(false);
  });

  it('starts with one whiskey train and adds a second after both coal II tiles are gone', () => {
    const player = createGame(1).players[0]!;
    expect(player.heavySupply.filter((heavy) => heavy.type === 'whiskey')).toHaveLength(1);
    expect(removeMatTile(player, 'c2')).toBe(true);
    expect(player.heavySupply.filter((heavy) => heavy.type === 'whiskey')).toHaveLength(1);
    expect(removeMatTile(player, 'c2')).toBe(true);
    expect(player.heavySupply.filter((heavy) => heavy.type === 'whiskey')).toHaveLength(2);
    expect(player.lockedHeavies.some((heavy) => heavy.unlockAfter === 'heavy-whiskey')).toBe(false);
  });
});
