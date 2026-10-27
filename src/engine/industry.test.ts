import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { scoreEra } from './era';
import { incomeLevelAt } from './income';
import { tileName } from './logText';
import { accessibleTileIds, removeMatTile } from './mat';
import { takeOilBarrel } from './oil';
import { createGame } from './state';

describe('industry settlement', () => {
  it('refuses coke on coal that is not already flipped', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    const slot = state.slots.find((entry) => entry.id === 'wilkes-barre-0')!;
    slot.tileDefId = 'c1';
    slot.owner = pid;
    slot.flipped = false;
    slot.cubes = { coal: 2 };
    state.players[pid]!.hand.push({ id: 't-wilkes', defId: 'loc-wilkes-1' });
    state.players[pid]!.money = 40;

    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-wilkes',
      whiskeyWild: false,
      tileDefId: 'ck1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('flipped');
    expect(slot.tileDefId).toBe('c1');
    expect(slot.cubes.coal).toBe(2);
  });

  it('scores a flipped coal mine immediately when coke replaces it', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    const slot = state.slots.find((entry) => entry.id === 'wilkes-barre-0')!;
    slot.tileDefId = 'c1';
    slot.owner = pid;
    slot.flipped = true;
    slot.cubes = {};
    state.players[pid]!.hand.push({ id: 't-wilkes', defId: 'loc-wilkes-1' });

    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-wilkes',
      whiskeyWild: false,
      tileDefId: 'ck1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.slots.find((entry) => entry.id === 'wilkes-barre-0')?.tileDefId).toBe('ck1');
    expect(result.state.players[pid]!.vp).toBe(1);
  });

  it('spends manufacturing III’s coal and oil, then pays $8 and a whiskey', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    const player = state.players[pid]!;
    removeMatTile(player, 'm1');
    removeMatTile(player, 'm1');
    removeMatTile(player, 'm2');
    player.hand.push({ id: 't-tol', defId: 'loc-toledo-1' });
    const field = state.oilfields.find((entry) => entry.id === 'lima')!;
    field.oil = 2;
    state.links.push({
      id: 'pipe-lima',
      lineId: 'p-lima-toledo',
      kind: 'pipeline',
      owner: pid,
      cubes: {},
      doubleLink: false,
    });

    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-tol',
      whiskeyWild: false,
      tileDefId: 'm3',
      slotId: 'toledo-0',
      sources: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.state.slots.find((entry) => entry.id === 'toledo-0');
    expect(slot?.tileDefId).toBe('m3');
    expect(slot?.flipped).toBe(true);
    expect(result.state.oilfields.find((entry) => entry.id === 'lima')?.oil).toBe(1);
    expect(result.state.log.map((entry) => entry.text).join(' ')).toContain('1 桶石油');
    expect(result.state.players[pid]!.money).toBe(24);
    expect(result.state.players[pid]!.whiskey).toBe(1);
    scoreEra(result.state);
    expect(result.state.players[pid]!.vp).toBe(3);
  });

  it('unlocks the 7-point pipeline when both kerosene IV copies leave the mat', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    const player = state.players[pid]!;
    expect(player.pipelineSupply.some((pipe) => pipe.points === 7)).toBe(false);
    removeMatTile(player, 'k4');
    expect(player.pipelineSupply.some((pipe) => pipe.points === 7)).toBe(false);
    removeMatTile(player, 'k4');
    expect(player.lockedPipes.some((pipe) => pipe.unlockAfter === 'pipe-7')).toBe(false);
    expect(player.pipelineSupply.some((pipe) => pipe.type === 'vp' && pipe.points === 7)).toBe(true);
  });

  it('lowers income two levels for Oil City and pays $30 when the last barrel leaves', () => {
    const state = createGame(1);
    state.era = 2;
    const pid = state.currentPlayerId;
    const player = state.players[pid]!;
    while (removeMatTile(player, 'k4')) {
      /* both kerosene IV copies cover Oil City */
    }
    player.hand.push({ id: 't-kero', defId: 'ind-kero-1' });
    const field = state.oilfields.find((entry) => entry.id === 'lima')!;
    field.oil = 1;
    state.links.push({
      id: 'pipe-lima',
      lineId: 'p-lima-toledo',
      kind: 'pipeline',
      owner: pid,
      cubes: {},
      doubleLink: false,
    });

    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-kero',
      whiskeyWild: false,
      tileDefId: 'oilCity',
      oilfieldId: 'lima',
      sources: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const city = result.state.oilfields.find((entry) => entry.id === 'lima')?.oilCitySlot;
    expect(city?.cubes.oil).toBe(4);
    expect(city?.flipped).toBe(false);
    expect(result.state.players[pid]!.money).toBe(30);
    expect(incomeLevelAt(result.state.players[pid]!.incomeSpace)).toBe(-2);

    for (let n = 0; n < 4; n++) {
      const live = result.state.oilfields.find((entry) => entry.id === 'lima')!;
      takeOilBarrel(result.state, live, true);
    }
    expect(result.state.players[pid]!.money).toBe(60);
    expect(result.state.oilfields.find((entry) => entry.id === 'lima')?.oilCitySlot?.flipped).toBe(true);
    scoreEra(result.state);
    expect(result.state.players[pid]!.vp).toBe(4);
  });

  it('scores manufacturing II as the income level', () => {
    const state = createGame(1);
    state.players[0]!.incomeSpace = 18;
    const slot = state.slots.find((entry) => entry.id === 'philadelphia-0')!;
    slot.tileDefId = 'm2';
    slot.owner = 0;
    slot.flipped = true;

    scoreEra(state);

    expect(incomeLevelAt(18)).toBe(4);
    expect(state.players[0]!.vp).toBe(4);
  });

  it('scores the alternator once per empty mat slot, not once per removed copy', () => {
    const state = createGame(1);
    const player = state.players[0]!;
    removeMatTile(player, 'polyphase');
    removeMatTile(player, 'c2');
    const slot = state.slots.find((entry) => entry.id === 'wilkes-barre-0')!;
    slot.tileDefId = 'polyphase';
    slot.owner = 0;
    slot.flipped = true;

    scoreEra(state);

    expect(state.players[0]!.vp).toBe(1);
  });

  it('scores a locomotive from heavy trains and a skyscraper from its printed VP', () => {
    const state = createGame(4);
    state.era = 2;
    const loco = state.slots.find((entry) => entry.id === 'philadelphia-0')!;
    loco.tileDefId = 'locomotive';
    loco.owner = 0;
    loco.flipped = true;
    state.links.push({
      id: 'heavy-1',
      lineId: 'r-buffalo-canada',
      kind: 'heavyTrain',
      owner: 0,
      cubes: {},
      doubleLink: false,
    });
    const sky = state.slots.find((entry) => entry.id === 'pittsburgh-4')!;
    sky.tileDefId = 'sky2';
    sky.owner = 1;
    sky.flipped = true;

    scoreEra(state);

    expect(state.players[0]!.vp).toBe(4 + 2);
    expect(state.players[1]!.vp).toBe(20);
    expect(tileName('sky1')).toBe('摩天楼 III');
    expect(state.log.some((entry) => entry.text.includes('摩天楼 V'))).toBe(true);
    expect(state.log.some((entry) => entry.text.includes('摩天楼 VI') || entry.text.includes('摩天楼 VII'))).toBe(false);
  });

  it('opens skyscraper III after steel II and skyscraper V after steel IV', () => {
    const player = createGame(1).players[0]!;
    expect(accessibleTileIds(player.mat).has('sky1')).toBe(false);
    expect(accessibleTileIds(player.mat).has('sky2')).toBe(false);
    removeMatTile(player, 's2');
    removeMatTile(player, 's2');
    expect(accessibleTileIds(player.mat).has('sky1')).toBe(true);
    expect(accessibleTileIds(player.mat).has('sky2')).toBe(false);
    removeMatTile(player, 's4');
    removeMatTile(player, 's4');
    expect(accessibleTileIds(player.mat).has('sky2')).toBe(true);
  });
});
