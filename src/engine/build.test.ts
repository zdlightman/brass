import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { buildQuote, slotAcceptsBuild, slotNeedsDedicatedSpace } from './actions/build';
import { createGame } from './state';
import type { GameState, PlayerId } from './types';

describe('build', () => {
  it('builds level-1 coal on a matching location card and exclusive space', () => {
    const state = ready(createGame(1), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-pitt', defId: 'loc-pittsburgh-1' });
      s.links.push({
        id: 'link-pitt',
        lineId: 'r-pittsburgh-clarksburg',
        kind: 'lightTrain',
        owner: pid,
        cubes: {},
        doubleLink: false,
      });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-pitt',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'pittsburgh-0',
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.state.slots.find((x) => x.id === 'pittsburgh-0');
    expect(slot?.tileDefId).toBe('c1');
    expect(slot?.owner).toBe(pid);
    expect(slot?.cubes.coal).toBe(3);
    expect(result.state.players[pid]!.money).toBe(22);
    expect(result.state.players[pid]!.mat.find((m) => m.defId === 'c1')?.removed).toBe(true);
  });

  it('lets another player build coal on a second Wilkes-Barre space', () => {
    let state = ready(createGame(1), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-wilkes', defId: 'loc-wilkes-1' });
    });
    const pid = state.currentPlayerId;
    const first = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-wilkes',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const next = first.state.currentPlayerId;
    first.state.players[next]!.hand.push({ id: 't-wilkes2', defId: 'loc-wilkes-1' });
    const second = applyAction(first.state, {
      type: 'build',
      playerId: next,
      cardId: 't-wilkes2',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-1',
      sources: [],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.slots.find((slot) => slot.id === 'wilkes-barre-1')?.tileDefId).toBe('c1');
    expect(second.state.slots.find((slot) => slot.id === 'wilkes-barre-0')?.owner).toBe(pid);
    expect(second.state.slots.find((slot) => slot.id === 'wilkes-barre-1')?.owner).toBe(next);
  });

  it('blocks the same player from a second industry in one city during era 1', () => {
    const state = ready(createGame(1), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-wilkes', defId: 'loc-wilkes-1' });
    });
    const pid = state.currentPlayerId;
    const first = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-wilkes',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.state.currentPlayerId = pid;
    first.state.actionsTaken = 0;
    first.state.pendingConfirm = false;
    const spent = first.state.players[pid]!.mat.find((entry) => entry.defId === 'c1');
    if (spent) spent.removed = false;
    first.state.players[pid]!.hand.push({ id: 't-wilkes-again', defId: 'loc-wilkes-2' });
    const again = applyAction(first.state, {
      type: 'build',
      playerId: pid,
      cardId: 't-wilkes-again',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-1',
      sources: [],
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain('already have an industry');
  });

  it('lets an industry card build anywhere when you have no presence', () => {
    const state = ready(createGame(2), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-coal', defId: 'ind-coal-1' });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-coal',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-2',
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.slots.find((x) => x.id === 'wilkes-barre-2')?.tileDefId).toBe('c1');
    expect(result.state.slots.find((x) => x.id === 'wilkes-barre-2')?.cubes.coal).toBe(3);
    expect(result.state.players[pid]!.money).toBe(23);
    const ironLeft = result.state.markets
      .find((m) => m.id === 'm-wilkes')
      ?.slots.filter((s) => s.cube === 'iron').length;
    expect(ironLeft).toBe(2);
  });

  it('spends connected mine coal before a market, then flips the mine when it is empty', () => {
    let state = ready(createGame(2), (s, pid) => {
      s.actionsAllowed = 4;
      s.players[pid]!.hand.push({ id: 't-coal', defId: 'ind-coal-1' });
    });
    const pid = state.currentPlayerId;
    const built = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-coal',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    state = built.state;
    state.links.push({
      id: 'link-wilkes',
      lineId: 'r-buffalo-wilkes',
      kind: 'lightTrain',
      owner: pid,
      cubes: {},
      doubleLink: false,
    });
    state.players[pid]!.hand.push({ id: 't-buf', defId: 'loc-buffalo-1' });
    const coalMarket = state.markets.find((m) => m.id === 'm-wilkes')?.slots.filter((s) => s.cube === 'coal').length;
    const made = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-buf',
      whiskeyWild: false,
      tileDefId: 'k2',
      slotId: 'buffalo-0',
      sources: [],
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const mine = made.state.slots.find((s) => s.id === 'wilkes-barre-0');
    expect(mine?.cubes.coal).toBe(2);
    expect(mine?.flipped).toBe(false);
    expect(made.state.markets.find((m) => m.id === 'm-wilkes')?.slots.filter((s) => s.cube === 'coal').length).toBe(coalMarket);
    expect(made.state.players[pid]!.money).toBe(12);
    expect(made.state.players[pid]!.incomeSpace).toBe(9);
    const card = made.state.players[pid]!.hand[0];
    expect(card).toBeTruthy();
    const link = applyAction(made.state, {
      type: 'network',
      playerId: pid,
      cardId: card!.id,
      placements: [{ lineId: 'r-erie-buffalo', kind: 'lightTrain', sources: [] }],
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const partly = link.state.slots.find((s) => s.id === 'wilkes-barre-0');
    expect(partly?.cubes.coal ?? 0).toBe(1);
    expect(partly?.flipped).toBe(false);
    expect(link.state.players[pid]!.incomeSpace).toBe(9);
    const again = link.state.players[pid]!.hand[0];
    expect(again).toBeTruthy();
    const last = applyAction(link.state, {
      type: 'network',
      playerId: pid,
      cardId: again!.id,
      placements: [{ lineId: 'r-buffalo-rochester', kind: 'lightTrain', sources: [] }],
    });
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    const emptied = last.state.slots.find((s) => s.id === 'wilkes-barre-0');
    expect(emptied?.cubes.coal ?? 0).toBe(0);
    expect(emptied?.flipped).toBe(true);
    expect(last.state.players[pid]!.incomeSpace).toBe(13);
  });

  it('rejects a coal tile on a space whose icon is not coal', () => {
    const state = ready(createGame(2), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-coal', defId: 'ind-coal-1' });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-coal',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'toledo-1',
      sources: [],
    });
    expect(result.ok).toBe(false);
  });

  it('buys Vanderbilt iron when the coal city has no connected iron', () => {
    const state = ready(createGame(2), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-coal', defId: 'ind-coal-1' });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-coal',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'saginaw-1',
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.slots.find((x) => x.id === 'saginaw-1')?.tileDefId).toBe('c1');
    expect(result.state.players[pid]!.money).toBe(18);
    expect(result.state.markets.find((m) => m.id === 'm-wilkes')?.slots.filter((s) => s.cube === 'iron')).toHaveLength(3);
  });

  it('builds manufacturing, kerosene, and iron with the same connected-coal rule', () => {
    const manufacturing = ready(createGame(4), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-mfg', defId: 'ind-mfg-1' });
    });
    const pid = manufacturing.currentPlayerId;
    const made = applyAction(manufacturing, {
      type: 'build',
      playerId: pid,
      cardId: 't-mfg',
      whiskeyWild: false,
      tileDefId: 'm1',
      slotId: 'toledo-0',
      sources: [],
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.state.slots.find((x) => x.id === 'toledo-0')?.flipped).toBe(false);
    expect(made.state.players[pid]!.money).toBe(18);

    const kerosene = ready(createGame(4), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-kero', defId: 'ind-kero-1' });
    });
    const kpid = kerosene.currentPlayerId;
    const lit = applyAction(kerosene, {
      type: 'build',
      playerId: kpid,
      cardId: 't-kero',
      whiskeyWild: false,
      tileDefId: 'k2',
      slotId: 'toledo-0',
      sources: [],
    });
    expect(lit.ok).toBe(true);
    if (!lit.ok) return;
    expect(lit.state.players[kpid]!.money).toBe(15);
    expect(lit.state.players[kpid]!.incomeSpace).toBe(9);

    const iron = ready(createGame(4), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-iron', defId: 'ind-iron-1' });
    });
    const ipid = iron.currentPlayerId;
    const works = applyAction(iron, {
      type: 'build',
      playerId: ipid,
      cardId: 't-iron',
      whiskeyWild: false,
      tileDefId: 'i1',
      slotId: 'toledo-1',
      sources: [],
    });
    expect(works.ok).toBe(true);
    if (!works.ok) return;
    const built = works.state.slots.find((x) => x.id === 'toledo-1');
    expect(built?.cubes.iron).toBe(3);
    expect(built?.cubes.steel).toBe(1);
    expect(built?.flipped).toBe(false);
    expect(works.state.players[ipid]!.money).toBe(17);
    expect(works.state.markets.find((m) => m.id === 'm-toledo')?.slots.filter((s) => s.cube === 'iron')).toHaveLength(3);
    expect(works.state.markets.find((m) => m.id === 'm-toledo')?.slots.filter((s) => s.cube === 'coal')).toHaveLength(3);
  });

  it('builds iron I in Philadelphia for $3 plus the local coke', () => {
    const state = ready(createGame(5), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-phil', defId: 'loc-philadelphia-1' });
      s.links.push(
        {
          id: 'link-phil',
          lineId: 'r-philadelphia-baltimore',
          kind: 'lightTrain',
          owner: pid,
          cubes: {},
          doubleLink: false,
        },
        {
          id: 'link-clark',
          lineId: 'r-baltimore-clarksburg',
          kind: 'lightTrain',
          owner: pid,
          cubes: {},
          doubleLink: false,
        },
      );
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-phil',
      whiskeyWild: false,
      tileDefId: 'i1',
      slotId: 'philadelphia-0',
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[pid]!.money).toBe(23);
    const ironLeft = result.state.markets.find((m) => m.id === 'm-clarksburg')?.slots.filter((s) => s.cube === 'iron').length;
    const cokeLeft = result.state.markets.find((m) => m.id === 'm-philadelphia')?.slots.filter((s) => s.cube === 'coke').length;
    const steelLeft = result.state.markets.find((m) => m.id === 'm-philadelphia')?.slots.filter((s) => s.cube === 'steel').length;
    expect(ironLeft).toBe(3);
    expect(cokeLeft).toBe(0);
    expect(steelLeft).toBe(2);
    expect(result.state.slots.find((slot) => slot.id === 'philadelphia-0')?.cubes.iron).toBe(3);
  });

  it('requires the network once the player has a link', () => {
    const state = ready(createGame(2), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-coal', defId: 'ind-coal-1' });
      s.links.push({
        id: 'link-1',
        lineId: 'r-chicago-toledo',
        kind: 'lightTrain',
        owner: pid,
        cubes: {},
        doubleLink: false,
      });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-coal',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(result.ok).toBe(false);
  });

  it('sells produced coal into empty connected market slots and flips when empty', () => {
    const state = ready(createGame(3), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-tol', defId: 'loc-wilkes-1' });
      const market = s.markets.find((m) => m.id === 'm-wilkes');
      if (market) for (const slot of market.slots) if (slot.cube === 'coal') slot.cube = null;
    });
    const pid = state.currentPlayerId;
    const money = state.players[pid]!.money;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-tol',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'wilkes-barre-0',
      sources: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.state.slots.find((x) => x.id === 'wilkes-barre-0');
    expect(slot?.cubes.coal ?? 0).toBe(0);
    expect(slot?.flipped).toBe(true);
    expect(result.state.players[pid]!.money).toBe(money - 5 - 2 + 6);
    expect(result.state.players[pid]!.incomeSpace).toBe(14);
  });

  it('lets the Bessemer card, including a steel card with the same face, build iron I', () => {
    const state = ready(createGame(6), (s, pid) => {
      s.players[pid]!.hand.push({ id: 't-steel', defId: 'ind-steel-1' });
    });
    const pid = state.currentPlayerId;
    const result = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-steel',
      whiskeyWild: false,
      tileDefId: 'i1',
      slotId: 'toledo-1',
      sources: [],
    });
    expect(result.ok).toBe(true);
  });

  it('quotes printed cost until a city is chosen, then that city\'s resource price', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    expect(buildQuote(state, pid, 'c1', null)).toEqual({ cost: '造价 $5+铁', income: '收益 +4' });
    expect(buildQuote(state, pid, 'c1', 'wilkes-barre-0')).toEqual({ cost: '造价 $7', income: '收益 +4' });
    expect(buildQuote(state, pid, 'c1', 'saginaw-1')).toEqual({ cost: '造价 $12', income: '收益 +4' });
    expect(buildQuote(state, pid, 'm1', 'toledo-0')).toEqual({ cost: '造价 $12', income: '收益 +4' });
    expect(buildQuote(state, pid, 'i1', null)).toEqual({ cost: '造价 $3+焦', income: '收益 +3' });
    expect(buildQuote(state, pid, 'i1', 'philadelphia-0')).toEqual({ cost: '造价 $7', income: '收益 +3' });
  });

  it('uses a single-purpose space before a wider space that also accepts the industry', () => {
    const state = createGame(1);
    const pid = state.currentPlayerId;
    expect(slotNeedsDedicatedSpace(state, 'c1', 'harrisburg-1')).toBe(true);
    expect(slotAcceptsBuild(state, 'c1', 'harrisburg-1', pid)).toBe(false);
    expect(slotAcceptsBuild(state, 'c1', 'harrisburg-0', pid)).toBe(true);
    expect(slotAcceptsBuild(state, 'c1', 'columbus-0', pid)).toBe(false);
    expect(slotAcceptsBuild(state, 'c1', 'columbus-1', pid)).toBe(true);
    expect(slotAcceptsBuild(state, 'c1', 'clarksburg-2', pid)).toBe(false);
    expect(slotAcceptsBuild(state, 'c1', 'clarksburg-0', pid)).toBe(true);
    expect(slotAcceptsBuild(state, 'c1', 'clarksburg-1', pid)).toBe(true);
    expect(slotAcceptsBuild(state, 'i1', 'pittsburgh-3', pid)).toBe(false);
    expect(slotAcceptsBuild(state, 'i1', 'pittsburgh-2', pid)).toBe(true);

    const coalOnly = state.slots.find((slot) => slot.id === 'harrisburg-0')!;
    coalOnly.tileDefId = 'c1';
    coalOnly.owner = pid === 0 ? 1 : 0;
    expect(slotAcceptsBuild(state, 'c1', 'harrisburg-1', pid)).toBe(true);

    state.players[pid]!.hand.push({ id: 't-harrisburg', defId: 'ind-coal-1' });
    const refused = applyAction(state, {
      type: 'build',
      playerId: pid,
      cardId: 't-harrisburg',
      whiskeyWild: false,
      tileDefId: 'c1',
      slotId: 'clarksburg-2',
      sources: [],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('exclusive');
  });
});

function ready(state: GameState, setup: (s: GameState, pid: PlayerId) => void): GameState {
  setup(state, state.currentPlayerId);
  return state;
}
