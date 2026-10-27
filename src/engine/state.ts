import {
  cardDefs,
  mapData,
  merchantTiles,
  oilfieldTiles,
  qualityRewards,
} from './catalog';
import { playerTag } from './logText';
import { MAT_SUPPLY } from './mat';
import { shuffle } from './rng';
import type {
  Card,
  GameState,
  MarketState,
  PlayerId,
  PlayerState,
  SlotState,
} from './types';

/** The four colors reserved on the meeple sheet and tile backs: gold, blue, red, purple. */
export const PLAYER_COLORS = ['#d1ac51', '#95a0b2', '#8d4129', '#9374ad'] as const;
const CHARACTERS = ['Andrew Carnegie', 'Cornelius Vanderbilt', 'Nikola Tesla', 'Nellie Bly'] as const;

export function createGame(seed = 1): GameState {
  let rng = seed >>> 0 || 1;

  const slots: SlotState[] = [];
  for (const loc of mapData.locations) {
    for (const slot of loc.slots) {
      slots.push({
        id: slot.id,
        locationId: loc.id,
        tileDefId: null,
        owner: null,
        flipped: false,
        cubes: {},
      });
    }
  }

  const markets: MarketState[] = mapData.markets.map((m) => {
    const marketSlots: MarketState['slots'] = [];
    for (const cube of m.cubes) {
      m.slotVp.forEach((vp, index) => {
        const filled = cube !== 'coke' || index === m.slotVp.length - 1;
        marketSlots.push({ cube: filled ? cube : null, vp });
      });
    }
    return { id: m.id, slots: marketSlots };
  });

  const oilShuffle = shuffle([...oilfieldTiles], rng);
  rng = oilShuffle.rng;
  const oilfields = mapData.oilfields.map((field, i) => {
    const tile = oilShuffle.items[i];
    return {
      id: field.id,
      tileId: tile?.id ?? null,
      revealed: false,
      oil: 0,
      pendingEra2Oil: tile?.era2Oil ?? 0,
      oilCitySlot: null,
    };
  });

  const merchShuffle = shuffle([...merchantTiles], rng);
  rng = merchShuffle.rng;
  const merchantLocations = ['eads-bridge', 'the-south', 'boston', 'canada'] as const;
  const placedTiles = merchShuffle.items.slice(0, merchantLocations.length);
  const merchants = merchantLocations.slice(0, placedTiles.length).map((locationId, i) => ({
    locationId,
    tileId: placedTiles[i]!.id,
    faceUp: true,
    art: placedTiles[i]!.art,
  }));

  const qrShuffle = shuffle([...qualityRewards], rng);
  rng = qrShuffle.rng;
  const dealArt = shuffle([0, 1, 2, 3, 4, 5], rng);
  rng = dealArt.rng;
  const quality = qrShuffle.items.map((spec, index) => ({
    id: spec.id,
    faceUp: true,
    art: dealArt.items[index % dealArt.items.length]!,
    stars: spec.stars,
  }));

  const deckDefs = cardDefs.filter((c) => c.playerCounts.includes(4));
  const deckShuffle = shuffle(
    deckDefs.map((def, i): Card => ({ id: `${def.id}#${i}`, defId: def.id })),
    rng,
  );
  rng = deckShuffle.rng;
  const deck = deckShuffle.items;

  const orderShuffle = shuffle([0, 1, 2, 3] as PlayerId[], rng);
  rng = orderShuffle.rng;
  const turnOrder = orderShuffle.items;

  const players: PlayerState[] = [0, 1, 2, 3].map((id) => makePlayer(id as PlayerId));

  const state: GameState = {
    playerCount: 4,
    seed,
    rng,
    era: 1,
    round: 1,
    actionsTaken: 0,
    actionsAllowed: 1,
    currentPlayerId: turnOrder[0]!,
    turnOrder,
    spentThisRound: { 0: 0, 1: 0, 2: 0, 3: 0 },
    playersActed: [],
    players,
    deck,
    setupDiscards: [],
    slots,
    links: [],
    markets,
    oilfields,
    merchants,
    qualityRewards: quality,
    log: [{ text: `时代 1 开始。顺位：${turnOrder.map((id) => playerTag(id)).join(' → ')}。` }],
    winner: null,
    over: false,
    bonusSellPlayerId: null,
    pendingOilDevelopPlayerId: null,
    oilDevelopThenFinish: false,
    pendingConfirm: false,
    eraScoreHeld: false,
  };

  for (const p of players) {
    for (let n = 0; n < 8; n++) {
      const card = state.deck.shift();
      if (card) p.hand.push(card);
    }
    const setup = state.deck.shift();
    if (setup) {
      p.discard.push(setup);
      state.setupDiscards.push(setup);
    }
  }

  return state;
}

function makePlayer(id: PlayerId): PlayerState {
  return {
    id,
    name: `P${id + 1} ${CHARACTERS[id]}`,
    color: PLAYER_COLORS[id]!,
    money: 30,
    incomeSpace: 10,
    vp: 0,
    whiskey: 0,
    hand: [],
    discard: [],
    mat: MAT_SUPPLY.flatMap(([defId, count]) =>
      Array.from({ length: count }, () => ({ defId, removed: false })),
    ),
    lightTrains: 9,
    heavySupply: [{ type: 'whiskey' }, { type: 'steelResource' }],
    pipelineSupply: [
      { type: 'income', incomeSpaces: 2 },
      { type: 'reserve' },
    ],
    lockedHeavies: [
      { type: 'whiskey', unlockAfter: 'heavy-whiskey' },
      { type: 'doubleLink', unlockAfter: 'heavy-score' },
      { type: 'oilResource', unlockAfter: 'heavy-oil' },
      { type: 'cokeResource', unlockAfter: 'heavy-coke' },
      { type: 'replacement', unlockAfter: 'heavy-swap' },
    ],
    lockedPipes: [
      { type: 'vp', points: 4, unlockAfter: 'pipe-4' },
      { type: 'vp', points: 7, unlockAfter: 'pipe-7' },
      { type: 'vp', points: 3, unlockAfter: 'pipe-3' },
      { type: 'money', unlockAfter: 'pipe-10' },
    ],
    heavyTrainsBuilt: 0,
    pendingFreeDevelops: 0,
    character: CHARACTERS[id]!,
  };
}
