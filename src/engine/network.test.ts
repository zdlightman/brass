import { describe, expect, it } from 'vitest';
import { placeLink } from './actions/network';
import { applyAction } from './apply';
import { clone } from './clone';
import { oilfieldTiles, rail } from './catalog';
import { removeMatTile } from './mat';
import { createGame } from './state';
import type { PlayerId } from './types';

describe('network', () => {
  it('places a light train using a connected coal market', () => {
    const state = createGame(42);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const money = state.players[pid]!.money;
    const coalBefore = coalInMarket(state, 'm-toledo');

    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'r-toledo-cleveland', kind: 'lightTrain', sources: [] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.links).toHaveLength(1);
    expect(result.state.links[0]?.kind).toBe('lightTrain');
    expect(result.state.players[pid]!.lightTrains).toBe(8);
    expect(result.state.players[pid]!.money).toBe(money - 4);
    expect(coalInMarket(result.state, 'm-toledo')).toBe(coalBefore - 1);
    expect(result.state.currentPlayerId).not.toBe(pid);
  });

  it('pays Vanderbilt when the line does not touch a coal market', () => {
    const state = createGame(42);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const money = state.players[pid]!.money;
    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'r-chicago-saginaw', kind: 'lightTrain', sources: [] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[pid]!.money).toBe(money - 7);
    expect(result.state.players[pid]!.incomeSpace).toBe(12);
    expect(coalInMarket(result.state, 'm-toledo')).toBe(coalInMarket(state, 'm-toledo'));
  });

  it('buys Vanderbilt steel when the connected market cannot cover both cubes', () => {
    const state = createGame(7);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const market = state.markets.find((entry) => entry.id === 'm-philadelphia')!;
    const steels = market.slots.filter((slot) => slot.cube === 'steel');
    steels.slice(1).forEach((slot) => {
      slot.cube = null;
    });
    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [
        {
          lineId: 'r-philadelphia-baltimore',
          kind: 'heavyTrain',
          heavyType: 'steelResource',
          sources: [],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[pid]!.money).toBe(30 - 4 - 10);
    expect(result.state.links[0]?.heavyType).toBe('steelResource');
    expect(result.state.links[0]?.cubes.steel).toBe(1);
  });

  it('places a whiskey heavy train for two steel and grants whiskey', () => {
    const state = createGame(7);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [
        {
          lineId: 'r-philadelphia-baltimore',
          kind: 'heavyTrain',
          heavyType: 'whiskey',
          sources: [],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.state.players[pid]!;
    expect(p.whiskey).toBe(1);
    expect(p.heavySupply.map((h) => h.type)).toEqual(['steelResource']);
    expect(result.state.links[0]?.kind).toBe('heavyTrain');
  });

  it('rejects a pipeline on a railroad', () => {
    const state = createGame(42);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'r-toledo-cleveland', kind: 'pipeline', pipelineType: 'reserve', sources: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it('lets the second player spend the first player’s Wilkes coal on two light trains', () => {
    const state = createGame(3);
    const a = 0 as const;
    const b = 1 as const;
    state.turnOrder = [a, b, 2, 3];
    state.currentPlayerId = a;
    state.playersActed = [];
    state.actionsTaken = 0;
    state.players[a]!.hand.push({ id: 'a-wilkes', defId: 'loc-wilkes-1' });
    state.players[b]!.hand.push({ id: 'b-card', defId: 'loc-buffalo-1' });

    const built = applyAction(state, {
      type: 'build',
      playerId: a,
      cardId: 'a-wilkes',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const mine = built.state.slots.find((slot) => slot.id === 'wilkes-barre-0');
    expect(mine?.owner).toBe(a);
    expect(mine?.cubes.coal).toBe(3);
    expect(built.state.currentPlayerId).toBe(b);

    const money = built.state.players[b]!.money;
    const linked = applyAction(built.state, {
      type: 'network',
      playerId: b,
      cardId: 'b-card',
      placements: [
        { lineId: 'r-buffalo-wilkes', kind: 'lightTrain', sources: [] },
        { lineId: 'r-wilkes-bethlehem', kind: 'lightTrain', sources: [] },
      ],
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const trains = linked.state.links.filter((link) => link.kind === 'lightTrain');
    expect(trains.map((link) => link.lineId).sort()).toEqual(['r-buffalo-wilkes', 'r-wilkes-bethlehem']);
    expect(trains.every((link) => link.owner === b)).toBe(true);
    expect(linked.state.players[b]!.lightTrains).toBe(7);
    expect(linked.state.players[b]!.money).toBe(money - 10);
    const spent = linked.state.slots.find((slot) => slot.id === 'wilkes-barre-0');
    expect(spent?.cubes.coal ?? 0).toBe(1);
    expect(spent?.flipped).toBe(false);
    expect(coalInMarket(linked.state, 'm-wilkes')).toBe(3);
  });

  it('opens a face-down oilfield with the first pipeline and adds that route’s oil', () => {
    const state = createGame(7);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    for (const field of state.oilfields) {
      expect(field.revealed).toBe(false);
      expect(field.oil).toBe(0);
    }
    const result = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'p-lima-toledo', kind: 'pipeline', pipelineType: 'income', sources: [] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const field = result.state.oilfields.find((entry) => entry.id === 'lima');
    expect(field?.revealed).toBe(true);
    expect(field?.oil).toBe(1);
    expect(result.state.links.some((link) => link.lineId === 'p-lima-toledo' && link.kind === 'pipeline')).toBe(true);
    expect(result.state.players[pid]!.pipelineSupply.some((pipe) => pipe.type === 'income')).toBe(false);
  });

  it('continues a pipeline from the same oilfield and buys iron from Vanderbilt', () => {
    const state = createGame(7);
    const pid = state.currentPlayerId;
    const card = state.players[pid]!.hand[0]!;
    const first = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'p-bradford-wilkes', kind: 'pipeline', pipelineType: 'income', sources: [] }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(ironInMarket(first.state, 'm-wilkes')).toBe(2);
    const moneyAfter = first.state.players[pid]!.money;

    const other = ((pid + 1) % 4) as PlayerId;
    const blocked = clone(first.state);
    blocked.links.push({
      id: 'far',
      lineId: 'r-chicago-saginaw',
      kind: 'lightTrain',
      owner: other,
      cubes: {},
      doubleLink: false,
    });
    const denied = placeLink(blocked, other, {
      lineId: 'p-bradford-buffalo',
      kind: 'pipeline',
      pipelineType: 'reserve',
      sources: [],
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error).toBe('Link must touch your network.');

    const second = placeLink(clone(first.state), pid, {
      lineId: 'p-bradford-buffalo',
      kind: 'pipeline',
      pipelineType: 'reserve',
      sources: [],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.links.some((link) => link.lineId === 'p-bradford-buffalo' && link.owner === pid)).toBe(true);
    expect(second.state.players[pid]!.money).toBe(moneyAfter - 7);
    expect(ironInMarket(second.state, 'm-wilkes')).toBe(2);
  });

  it('uses the printed oilfield rewards', () => {
    const byId = Object.fromEntries(oilfieldTiles.map((entry) => [entry.id, entry]));
    expect(byId['oil-income-2']).toMatchObject({ revealReward: { incomeSpaces: 2 }, era2Oil: 2 });
    expect(byId['oil-income-3']).toMatchObject({ revealReward: { incomeSpaces: 3 }, era2Oil: 1 });
    expect(byId['oil-money-8']).toMatchObject({ revealReward: { money: 8 }, era2Oil: 1 });
    expect(byId['oil-whiskey']).toMatchObject({ revealReward: { whiskey: 1 }, era2Oil: 2 });
    expect(byId['oil-develop']).toMatchObject({ revealReward: { freeDevelops: 1 }, era2Oil: 3 });
    expect(rail('r-harrisburg-philadelphia')?.bonus?.freeDevelop).toBe(1);
    expect(rail('r-cleveland-erie')?.bonus?.freeDevelop).toBe(1);
    expect(rail('r-buffalo-rochester')?.bonus?.freeDevelop).toBe(1);
  });

  it('lets the player remove one accessible industry or skip when an oilfield grants a develop', () => {
    const state = createGame(7);
    const pid = state.currentPlayerId;
    const field = state.oilfields.find((entry) => entry.id === 'lima');
    if (field) field.tileId = 'oil-develop';
    const card = state.players[pid]!.hand[0]!;
    const copies = state.players[pid]!.mat.filter((tile) => tile.defId === 'c1' && !tile.removed).length;
    const revealed = applyAction(
      state,
      {
        type: 'network',
        playerId: pid,
        cardId: card.id,
        placements: [{ lineId: 'p-lima-toledo', kind: 'pipeline', pipelineType: 'income', sources: [] }],
      },
      { holdTurn: true },
    );
    expect(revealed.ok).toBe(true);
    if (!revealed.ok) return;
    expect(revealed.state.pendingOilDevelopPlayerId).toBe(pid);
    expect(revealed.state.players[pid]!.pendingFreeDevelops).toBe(0);
    expect(revealed.state.actionsTaken).toBe(0);
    const blocked = applyAction(revealed.state, { type: 'pass', playerId: pid, cardId: revealed.state.players[pid]!.hand[0]!.id });
    expect(blocked.ok).toBe(false);

    const removed = applyAction(revealed.state, { type: 'oilDevelop', playerId: pid, tileDefId: 'c1' });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.state.pendingOilDevelopPlayerId).toBeNull();
    expect(removed.state.players[pid]!.mat.filter((tile) => tile.defId === 'c1' && !tile.removed)).toHaveLength(copies - 1);
    expect(removed.state.actionsTaken).toBe(0);

    const again = createGame(8);
    const againId = again.currentPlayerId;
    const againField = again.oilfields.find((entry) => entry.id === 'lima');
    if (againField) againField.tileId = 'oil-develop';
    const againCard = again.players[againId]!.hand[0]!;
    const opened = applyAction(again, {
      type: 'network',
      playerId: againId,
      cardId: againCard.id,
      placements: [{ lineId: 'p-lima-toledo', kind: 'pipeline', pipelineType: 'income', sources: [] }],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.state.oilDevelopThenFinish).toBe(true);
    const skipped = applyAction(opened.state, { type: 'declineOilDevelop', playerId: againId }, { manualConfirm: true });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.state.pendingOilDevelopPlayerId).toBeNull();
    expect(skipped.state.pendingConfirm).toBe(true);
    expect(skipped.state.players[againId]!.mat.filter((tile) => !tile.removed)).toHaveLength(
      again.players[againId]!.mat.filter((tile) => !tile.removed).length,
    );
  });

  it('opens the same free develop when a covered road grants one', () => {
    const line = rail('r-toledo-cleveland');
    expect(line).toBeTruthy();
    if (!line) return;
    const previous = line.bonus;
    line.bonus = { freeDevelop: 1 };
    try {
      const state = createGame(42);
      const pid = state.currentPlayerId;
      const card = state.players[pid]!.hand[0]!;
      const copies = state.players[pid]!.mat.filter((tile) => tile.defId === 'c1' && !tile.removed).length;
      const covered = applyAction(
        state,
        {
          type: 'network',
          playerId: pid,
          cardId: card.id,
          placements: [{ lineId: 'r-toledo-cleveland', kind: 'lightTrain', sources: [] }],
        },
        { holdTurn: true },
      );
      expect(covered.ok).toBe(true);
      if (!covered.ok) return;
      expect(covered.state.pendingOilDevelopPlayerId).toBe(pid);
      expect(covered.state.players[pid]!.pendingFreeDevelops).toBe(0);
      expect(covered.state.actionsTaken).toBe(0);
      expect(covered.state.links.some((link) => link.lineId === 'r-toledo-cleveland')).toBe(true);

      const removed = applyAction(covered.state, { type: 'oilDevelop', playerId: pid, tileDefId: 'c1' });
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;
      expect(removed.state.pendingOilDevelopPlayerId).toBeNull();
      expect(removed.state.players[pid]!.mat.filter((tile) => tile.defId === 'c1' && !tile.removed)).toHaveLength(copies - 1);
      expect(removed.state.actionsTaken).toBe(0);
    } finally {
      line.bonus = previous;
    }
  });

  it('asks which free coal to take when two connected mines can pay', () => {
    const state = createGame(42);
    const pid = state.currentPlayerId;
    const first = state.slots.find((slot) => slot.id === 'wilkes-barre-0');
    const second = state.slots.find((slot) => slot.id === 'wilkes-barre-1');
    if (!first || !second) throw new Error('Wilkes-Barre slots missing');
    first.tileDefId = 'c1';
    first.owner = 0;
    first.cubes = { coal: 3 };
    second.tileDefId = 'c1';
    second.owner = 1;
    second.cubes = { coal: 3 };
    const card = state.players[pid]!.hand[0]!;
    const auto = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'r-buffalo-wilkes', kind: 'lightTrain', sources: [] }],
    });
    expect(auto.ok).toBe(false);
    if (auto.ok) return;
    expect(auto.error).toContain('Choose which connected coal');
    const paid = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [{ lineId: 'r-buffalo-wilkes', kind: 'lightTrain', sources: [{ kind: 'vanderbilt' }] }],
    });
    expect(paid.ok).toBe(false);
    const chosen = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: card.id,
      placements: [
        { lineId: 'r-buffalo-wilkes', kind: 'lightTrain', sources: [{ kind: 'industry', slotId: 'wilkes-barre-1' }] },
      ],
    });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.state.slots.find((slot) => slot.id === 'wilkes-barre-0')?.cubes.coal).toBe(3);
    expect(chosen.state.slots.find((slot) => slot.id === 'wilkes-barre-1')?.cubes.coal).toBe(2);
  });

  it('keeps the 4-point pipeline locked until both kerosene II tiles are gone', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    const blocked = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: state.players[pid]!.hand[0]!.id,
      placements: [{ lineId: 'p-venango-cleveland', kind: 'pipeline', pipelineType: 'vp', sources: [] }],
    });
    expect(blocked.ok).toBe(false);

    const p = state.players[pid]!;
    expect(removeMatTile(p, 'k2')).toBe(true);
    expect(p.pipelineSupply.some((pipe) => pipe.points === 4)).toBe(false);
    expect(removeMatTile(p, 'k2')).toBe(true);
    expect(p.pipelineSupply.some((pipe) => pipe.type === 'vp' && pipe.points === 4)).toBe(true);

    const placed = applyAction(state, {
      type: 'network',
      playerId: pid,
      cardId: p.hand[0]!.id,
      placements: [{ lineId: 'p-venango-cleveland', kind: 'pipeline', pipelineType: 'vp', sources: [] }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const link = placed.state.links.find((entry) => entry.lineId === 'p-venango-cleveland');
    expect(link?.pipelineType).toBe('vp');
    expect(link?.pipelinePoints).toBe(4);
    expect(placed.state.log.some((entry) => entry.text.includes('4分管道 Cleveland—Venango'))).toBe(true);
    expect(placed.state.players[pid]!.pipelineSupply.some((pipe) => pipe.points === 4)).toBe(false);
  });
});

function cubesInMarket(
  state: { markets: Array<{ id: string; slots: Array<{ cube: string | null }> }> },
  id: string,
  cube: string,
): number {
  const m = state.markets.find((x) => x.id === id);
  return m?.slots.filter((s) => s.cube === cube).length ?? 0;
}

function coalInMarket(state: { markets: Array<{ id: string; slots: Array<{ cube: string | null }> }> }, id: string): number {
  return cubesInMarket(state, id, 'coal');
}

function ironInMarket(state: { markets: Array<{ id: string; slots: Array<{ cube: string | null }> }> }, id: string): number {
  return cubesInMarket(state, id, 'iron');
}
