import { describe, expect, it } from 'vitest';
import { sellPreview } from './actions/sell';
import { applyAction } from './apply';
import { createGame } from './state';
import type { GameState, PlayerId } from './types';

describe('sell', () => {
  it('refuses an industry that is not a merchant good', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    state.slots.find((slot) => slot.id === 'philadelphia-0')!.tileDefId = 'c1';
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(false);
  });

  it('refuses a good with no connected merchant for that industry', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    state.merchants = [
      { locationId: 'the-south', tileId: 'mer-kero', faceUp: true, art: 0 },
    ];
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(false);
  });

  it('refuses a connected good when the oil barrels are short', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const field = state.oilfields.find((entry) => entry.id === 'macksburg');
    if (field) field.oil = 0;
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(false);
  });

  it('sells manufacturing for one barrel, the merchant reward, and the flip income', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.state.slots.find((entry) => entry.id === 'philadelphia-0');
    expect(slot?.flipped).toBe(true);
    expect(result.state.oilfields.find((entry) => entry.id === 'macksburg')?.oil).toBe(0);
    expect(result.state.merchants.find((entry) => entry.locationId === 'the-south')?.faceUp).toBe(false);
    expect(result.state.players[pid]!.whiskey).toBe(0);
    expect(result.state.players[pid]!.vp).toBe(6);
    expect(result.state.players[pid]!.incomeSpace).toBe(16);
    expect(result.state.players[pid]!.hand.some((card) => card.id === 'sell-card')).toBe(false);
  });

  it('does not let oil connected to one city pay for a good in another city', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const other = state.slots.find((slot) => slot.id === 'chicago-0');
    if (other) {
      other.tileDefId = 'm1';
      other.owner = pid;
      other.flipped = false;
    }
    state.links.push({
      id: 'rail-c',
      lineId: 'r-chicago-eads',
      kind: 'lightTrain',
      owner: pid,
      cubes: {},
      doubleLink: false,
    });
    state.merchants.push({ locationId: 'eads-bridge', tileId: 'mer-mfg', faceUp: true, art: 2 });
    const result = applyAction(state, sell(pid, ['philadelphia-0', 'chicago-0']));
    expect(result.ok).toBe(false);
  });

  it('sells to a red merchant without paying the first-sale reward again', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const merchant = state.merchants.find((entry) => entry.locationId === 'the-south');
    if (merchant) merchant.faceUp = false;
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.merchants.find((entry) => entry.locationId === 'the-south')?.faceUp).toBe(false);
    expect(result.state.players[pid]!.whiskey).toBe(0);
    expect(result.state.slots.find((entry) => entry.id === 'philadelphia-0')?.flipped).toBe(true);
    expect(result.state.players[pid]!.incomeSpace).toBe(16);
  });

  it('flips only the merchant the player sells to', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    state.links.push(
      {
        id: 'rail-c',
        lineId: 'r-philadelphia-newyork',
        kind: 'lightTrain',
        owner: pid,
        cubes: {},
        doubleLink: false,
      },
      {
        id: 'rail-d',
        lineId: 'r-newyork-boston',
        kind: 'lightTrain',
        owner: pid,
        cubes: {},
        doubleLink: false,
      },
    );
    state.merchants.push({ locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 });
    const refused = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(refused.ok).toBe(false);
    const result = applyAction(state, {
      ...sell(pid, ['philadelphia-0']),
      merchantLocationIds: ['the-south'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.merchants.find((entry) => entry.locationId === 'the-south')?.faceUp).toBe(false);
    expect(result.state.merchants.find((entry) => entry.locationId === 'boston')?.faceUp).toBe(true);
    expect(result.state.players[pid]!.vp).toBe(6);
  });

  it('flips Oil City when the last barrel is sold through its pipeline', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const field = state.oilfields.find((entry) => entry.id === 'macksburg');
    if (field) {
      field.oil = 0;
      field.oilCitySlot = {
        id: 'oilcity-macksburg',
        locationId: 'macksburg',
        tileDefId: 'oilCity',
        owner: pid,
        flipped: false,
        cubes: { oil: 1 },
      };
    }
    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const city = result.state.oilfields.find((entry) => entry.id === 'macksburg')?.oilCitySlot;
    expect(city?.flipped).toBe(true);
    expect(city?.cubes.oil).toBe(0);
    expect(result.state.players[pid]!.money).toBe(60);
  });

  it('refuses a crate on a kerosene market, and still sells kerosene there after the flip', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    state.merchants = [{ locationId: 'the-south', tileId: 'mer-kero', faceUp: true, art: 0 }];
    const crate = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(crate.ok).toBe(false);

    const slot = state.slots.find((entry) => entry.id === 'philadelphia-0');
    if (slot) slot.tileDefId = 'k2';
    const field = state.oilfields.find((entry) => entry.id === 'macksburg');
    if (field) field.oil = 2;
    const sold = applyAction(state, sell(pid, ['philadelphia-0']), { holdTurn: true });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.state.merchants[0]?.faceUp).toBe(false);
    expect(sold.state.log.at(-1)?.text).toContain('收入 +4 格');
    const afterFirst = sold.state.players[pid]!.incomeSpace;

    const againSlot = sold.state.slots.find((entry) => entry.id === 'philadelphia-0');
    if (againSlot) {
      againSlot.tileDefId = 'k2';
      againSlot.flipped = false;
    }
    const left = sold.state.oilfields.find((entry) => entry.id === 'macksburg');
    if (left) left.oil = 1;
    sold.state.players[pid]!.hand.push({ id: 'sell-card-2', defId: 'ind-kero-1' });
    const again = applyAction(sold.state, { ...sell(pid, ['philadelphia-0']), cardId: 'sell-card-2' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.state.log.at(-1)?.text.includes('首卖')).toBe(false);
    expect(again.state.players[pid]!.incomeSpace).toBe(afterFirst + 5 + 2);
  });

  it('lets one sell send several goods to the $15 merchant, then leaves only cars', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const second = state.slots.find((entry) => entry.id === 'baltimore-0');
    if (second) {
      second.tileDefId = 'k2';
      second.owner = pid;
      second.flipped = false;
    }
    state.merchants = [{ locationId: 'the-south', tileId: 'mer-15', faceUp: true, art: 0 }];
    const field = state.oilfields.find((entry) => entry.id === 'macksburg');
    if (field) field.oil = 2;

    const sold = applyAction(state, sell(pid, ['philadelphia-0', 'baltimore-0']), { holdTurn: true });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.state.merchants[0]?.faceUp).toBe(false);

    sold.state.players[pid]!.hand.push({ id: 'sell-card', defId: 'ind-mfg-1' });
    const cleveland = sold.state.slots.find((entry) => entry.id === 'clarksburg-0');
    if (cleveland) {
      cleveland.tileDefId = 'k2';
      cleveland.owner = pid;
      cleveland.flipped = false;
    }
    const again = applyAction(sold.state, sell(pid, ['clarksburg-0']));
    expect(again.ok).toBe(false);

    const car = sold.state.slots.find((entry) => entry.id === 'clarksburg-0');
    if (car) car.tileDefId = 'a1';
    const barrels = sold.state.oilfields.find((entry) => entry.id === 'macksburg');
    if (barrels) barrels.oil = 2;
    sold.state.players[pid]!.hand.push({ id: 'sell-car', defId: 'ind-auto-1' });
    const cars = applyAction(sold.state, { ...sell(pid, ['clarksburg-0']), cardId: 'sell-car' });
    expect(cars.ok).toBe(true);
    if (!cars.ok) return;
    expect(cars.state.merchants[0]?.faceUp).toBe(false);
    expect(cars.state.log.at(-1)?.text.includes('首卖')).toBe(false);
  });

  it('pays a scoring pipeline once for every barrel in the sell', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const slot = state.slots.find((entry) => entry.id === 'philadelphia-0');
    if (slot) slot.tileDefId = 'k4';
    state.merchants = [{ locationId: 'the-south', tileId: 'mer-kero', faceUp: true, art: 0 }];
    const pipe = state.links.find((entry) => entry.id === 'pipe-a');
    if (pipe) {
      pipe.pipelineType = 'vp';
      pipe.pipelinePoints = 7;
    }
    const field = state.oilfields.find((entry) => entry.id === 'macksburg');
    if (field) field.oil = 2;
    const before = state.players[pid]!.vp;

    const result = applyAction(state, sell(pid, ['philadelphia-0']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[pid]!.vp).toBe(before + 14);
    const notes = result.state.log.map((entry) => entry.text).join(' ');
    expect(notes.match(/记管道分 7/g)?.length).toBe(2);
  });

  it('starts the four sell-space merchants face up and keeps the printed quality stars', () => {
    const state = createGame(4);
    expect(state.merchants.map((merchant) => merchant.locationId).sort()).toEqual([
      'boston',
      'canada',
      'eads-bridge',
      'the-south',
    ]);
    expect(state.merchants.every((merchant) => merchant.faceUp)).toBe(true);
    expect(new Set(state.merchants.map((merchant) => merchant.tileId)).size).toBe(4);
    expect(state.merchants.map((merchant) => merchant.art).sort()).toEqual([0, 1, 2, 3]);
    expect(state.qualityRewards.map((reward) => reward.stars).sort()).toEqual([5, 6, 7]);
  });

  it('asks for a merchant in Chinese when several can take the good', () => {
    const state = ready();
    const pid = state.currentPlayerId;
    const slot = state.slots.find((entry) => entry.id === 'philadelphia-0');
    if (slot) slot.tileDefId = 'm2';
    state.merchants.push({ locationId: 'boston', tileId: 'mer-mfg', faceUp: true, art: 2 });
    state.links.push(
      { id: 'rail-ny', lineId: 'r-philadelphia-newyork', kind: 'lightTrain', owner: pid, cubes: {}, doubleLink: false },
      { id: 'rail-boston', lineId: 'r-newyork-boston', kind: 'lightTrain', owner: pid, cubes: {}, doubleLink: false },
    );
    const open = sellPreview(state, pid, ['philadelphia-0']);
    expect(open).toContain('点一个市场，选这次卖给谁。');
    expect(open).not.toContain('Choose which merchants');
    const picked = sellPreview(state, pid, ['philadelphia-0'], ['boston']);
    expect(picked).toContain('Boston');
    expect(picked).toContain('品质星');
    expect(picked).not.toContain('The South');
  });
});

function sell(playerId: PlayerId, slotIds: string[]) {
  return {
    type: 'sell' as const,
    playerId,
    cardId: 'sell-card',
    slotIds,
    merchantLocationIds: [],
    oilSources: [],
    whiskeyStars: 0,
  };
}

function ready(): GameState {
  const state = createGame(3);
  const pid = state.currentPlayerId;
  state.players[pid]!.hand.push({ id: 'sell-card', defId: 'ind-mfg-1' });
  const slot = state.slots.find((entry) => entry.id === 'philadelphia-0');
  if (slot) {
    slot.tileDefId = 'm1';
    slot.owner = pid;
    slot.flipped = false;
  }
  state.merchants = [{ locationId: 'the-south', tileId: 'mer-mfg', faceUp: true, art: 2 }];
  state.links.push(
    {
      id: 'rail-a',
      lineId: 'r-philadelphia-baltimore',
      kind: 'lightTrain',
      owner: pid,
      cubes: {},
      doubleLink: false,
    },
    {
      id: 'rail-south',
      lineId: 'r-baltimore-south',
      kind: 'lightTrain',
      owner: pid,
      cubes: {},
      doubleLink: false,
    },
    {
      id: 'rail-b',
      lineId: 'r-baltimore-clarksburg',
      kind: 'lightTrain',
      owner: pid,
      cubes: {},
      doubleLink: false,
    },
    {
      id: 'pipe-a',
      lineId: 'p-macksburg-clarksburg',
      kind: 'pipeline',
      owner: pid,
      pipelineType: 'income',
      pipelineIncome: 2,
      cubes: {},
      doubleLink: false,
    },
  );
  const field = state.oilfields.find((entry) => entry.id === 'macksburg');
  if (field) field.oil = 1;
  return state;
}
