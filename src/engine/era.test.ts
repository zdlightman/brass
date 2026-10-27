import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { scoreEra } from './era';
import { sellProducedToMarkets } from './markets';
import { takeDeferredLogs } from './logQueue';
import { createGame } from './state';
import { confirmPendingTurn, setHoldEraScore } from './turn';

describe('era scoring', () => {
  it('scores flipped industries and link icons, then removes level I and light trains', () => {
    const state = createGame(1);
    const mine = state.slots.find((slot) => slot.id === 'wilkes-barre-0')!;
    mine.tileDefId = 'c1';
    mine.owner = 0;
    mine.flipped = true;
    const goods = state.slots.find((slot) => slot.id === 'philadelphia-1')!;
    goods.tileDefId = 'k2';
    goods.owner = 0;
    goods.flipped = false;
    state.links.push({
      id: 'link-test',
      lineId: 'r-buffalo-canada',
      owner: 0,
      kind: 'lightTrain',
      doubleLink: false,
      cubes: {},
    });
    const before = state.players[0]!.lightTrains;

    scoreEra(state);

    expect(state.players[0]!.vp).toBe(3);
    expect(mine.tileDefId).toBeNull();
    expect(goods.tileDefId).toBe('k2');
    expect(state.links.some((link) => link.id === 'link-test')).toBe(false);
    expect(state.players[0]!.lightTrains).toBe(before + 1);
  });

  it('counts link points only from flipped industries, and scores every shipped coke as 4', () => {
    const state = createGame(1);
    const buffalo = state.slots.find((slot) => slot.locationId === 'buffalo')!;
    buffalo.tileDefId = 'c2';
    buffalo.owner = 0;
    buffalo.flipped = false;
    state.links.push({
      id: 'link-open',
      lineId: 'r-buffalo-canada',
      owner: 0,
      kind: 'lightTrain',
      doubleLink: false,
      cubes: {},
    });
    scoreEra(state, { remove: false });
    expect(state.players[0]!.vp).toBe(2);
    expect(state.links.some((link) => link.id === 'link-open')).toBe(true);
    expect(buffalo.tileDefId).toBe('c2');

    buffalo.flipped = true;
    state.players[0]!.vp = 0;
    state.log = [];
    scoreEra(state, { remove: false });
    expect(state.players[0]!.vp).toBe(2 + 1 + 2);

    const coke = state.slots.find((slot) => slot.id === 'philadelphia-0')!;
    coke.tileDefId = 'ck1';
    coke.owner = 0;
    coke.cubes = { coke: 1 };
    const before = state.players[0]!.vp;
    sellProducedToMarkets(state, 0, coke);
    expect(state.players[0]!.vp).toBe(before + 4);
    expect(takeDeferredLogs(state).some((entry) => entry.includes('记焦炭分 4'))).toBe(true);
  });

  it('can score era 1 and leave level I tiles and light trains on the board', () => {
    const state = createGame(2);
    state.deck = [];
    for (const entry of state.players) entry.hand = [];
    const mine = state.slots.find((slot) => slot.id === 'wilkes-barre-0')!;
    mine.tileDefId = 'c1';
    mine.owner = 0;
    mine.flipped = true;
    state.links.push({
      id: 'link-hold',
      lineId: 'r-buffalo-canada',
      owner: 0,
      kind: 'lightTrain',
      doubleLink: false,
      cubes: {},
    });
    state.playersActed = [0, 1, 2, 3];
    state.pendingConfirm = true;
    setHoldEraScore(true);
    try {
      confirmPendingTurn(state);
      expect(state.eraScoreHeld).toBe(true);
      expect(state.era).toBe(1);
      expect(mine.tileDefId).toBe('c1');
      expect(state.links.some((link) => link.id === 'link-hold')).toBe(true);
      expect(state.players[0]!.vp).toBe(1 + 2);
      expect(state.log.some((entry) => entry.text.includes('记产业分 1'))).toBe(true);
      expect(state.log.some((entry) => entry.text.includes('记连接分 2'))).toBe(true);
    } finally {
      setHoldEraScore(false);
    }
  });
});

describe('bonus sell', () => {
  it('holds the turn until the skyscraper sell is taken or skipped', () => {
    const state = createGame(1);
    state.currentPlayerId = 0;
    state.bonusSellPlayerId = 0;
    const cardId = state.players[0]!.hand[0]!.id;
    const blocked = applyAction(state, { type: 'pass', playerId: 0, cardId });
    expect(blocked.ok).toBe(false);

    const skipped = applyAction(state, { type: 'declineSell', playerId: 0 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.state.bonusSellPlayerId).toBeNull();
    expect(skipped.state.currentPlayerId).not.toBe(0);
  });
});

describe('empty hands', () => {
  it('scores the era instead of stopping on a player who has no cards left', () => {
    const state = createGame(1);
    state.deck = [];
    for (const entry of state.players) entry.hand = [];
    state.playersActed = [];
    state.pendingConfirm = true;
    state.currentPlayerId = state.turnOrder[0]!;
    confirmPendingTurn(state);
    expect(state.era).toBe(2);
    expect(state.eraScoreHeld).toBe(false);
  });

  it('gives the new round to a player who still has cards', () => {
    const state = createGame(1);
    state.deck = [];
    state.turnOrder = [0, 1, 2, 3];
    for (const entry of state.players) entry.hand = [];
    state.players[3]!.hand = [{ id: 'left', defId: 'ind-coal-1' }];
    state.playersActed = [0, 1, 2, 3];
    state.pendingConfirm = true;
    state.currentPlayerId = 0;
    confirmPendingTurn(state);
    expect(state.era).toBe(1);
    expect(state.currentPlayerId).toBe(3);
    expect(state.playersActed).toEqual([0, 1, 2]);
  });
});

describe('produced cube sale order', () => {
  it('fills the market space the player picked', () => {
    const state = createGame(1);
    const market = state.markets.find((entry) => entry.id === 'm-wilkes')!;
    market.slots[0]!.cube = null;
    market.slots[2]!.cube = null;
    const slot = state.slots.find((entry) => entry.id === 'wilkes-barre-0')!;
    slot.cubes = { coal: 1 };

    sellProducedToMarkets(state, 0, slot, [{ marketId: 'm-wilkes', slotIndex: 0 }]);

    expect(state.players[0]!.money).toBe(32);
    expect(state.players[0]!.vp).toBe(0);
    expect(market.slots[0]!.cube).toBe('coal');
    expect(market.slots[2]!.cube).toBeNull();
  });

  it('pays the coal and iron price and does not turn the space number into VP', () => {
    const state = createGame(1);
    const market = state.markets.find((entry) => entry.id === 'm-wilkes')!;
    market.slots[2]!.cube = null;
    const slot = state.slots.find((entry) => entry.id === 'wilkes-barre-0')!;
    slot.tileDefId = 'c1';
    slot.owner = 0;
    slot.cubes = { coal: 1, iron: 1 };
    const before = state.players[0]!.money;

    sellProducedToMarkets(state, 0, slot);

    const notes = takeDeferredLogs(state);
    expect(state.players[0]!.vp).toBe(0);
    expect(state.players[0]!.money).toBe(before + 2);
    expect(market.slots[2]!.cube).toBe('coal');
    expect(notes.some((entry) => entry.includes('获得 $2'))).toBe(true);
    expect(notes.some((entry) => entry.includes('记市场分'))).toBe(false);
  });

  it('pays steel market cash and does not score the space', () => {
    const state = createGame(1);
    const market = state.markets.find((entry) => entry.id === 'm-philadelphia')!;
    const steel = market.slots.find((slot) => slot.cube === 'steel');
    if (steel) steel.cube = null;
    const slot = state.slots.find((entry) => entry.id === 'philadelphia-0')!;
    slot.tileDefId = 's2';
    slot.owner = 0;
    slot.cubes = { steel: 1 };
    const before = state.players[0]!.money;

    sellProducedToMarkets(state, 0, slot);

    const notes = takeDeferredLogs(state);
    expect(state.players[0]!.vp).toBe(0);
    expect(state.players[0]!.money).toBe(before + 4);
    expect(notes.some((entry) => entry.includes('记市场分'))).toBe(false);
    expect(notes.some((entry) => entry.includes('记焦炭分'))).toBe(false);
  });
});
