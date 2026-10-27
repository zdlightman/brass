import mapData from '../data/map.json';
import { PLAYER_COLORS } from './state';
import type { GameState } from './types';

const KEY = 'brass-pittsburgh-hotseat-v7';

/** The picture on the board is the rule. Older saves shuffled the picture separately from the tile id. */
const MERCHANT_BY_ART = ['mer-kero', 'mer-15', 'mer-mfg', 'mer-auto'] as const;

const OIL_TILE_REMAP: Record<string, string> = {
  'oil-money-2': 'oil-income-2',
  'oil-money-3': 'oil-income-3',
  'oil-vp-8': 'oil-money-8',
  'oil-bulb': 'oil-develop',
};

export function saveGame(state: GameState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function loadGame(): GameState | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as GameState;
    state.players.forEach((player, index) => {
      const color = PLAYER_COLORS[index];
      if (color) player.color = color;
    });
    if (state.bonusSellPlayerId === undefined) state.bonusSellPlayerId = null;
    if (state.pendingOilDevelopPlayerId === undefined) state.pendingOilDevelopPlayerId = null;
    if (state.oilDevelopThenFinish === undefined) state.oilDevelopThenFinish = false;
    if (state.pendingConfirm === undefined) state.pendingConfirm = false;
    if (state.eraScoreHeld === undefined) state.eraScoreHeld = false;
    for (const merchant of state.merchants ?? []) {
      const printed = MERCHANT_BY_ART[merchant.art ?? -1];
      if (printed) merchant.tileId = printed;
    }
    for (const field of state.oilfields ?? []) {
      const next = field.tileId ? OIL_TILE_REMAP[field.tileId] : undefined;
      if (next) field.tileId = next;
      if (field.tileId === 'oil-whiskey' && field.pendingEra2Oil === 1) field.pendingEra2Oil = 2;
    }
    const have = new Set(state.slots.map((slot) => slot.id));
    for (const loc of mapData.locations) {
      for (const slot of loc.slots) {
        if (have.has(slot.id)) continue;
        state.slots.push({
          id: slot.id,
          locationId: loc.id,
          tileDefId: null,
          owner: null,
          flipped: false,
          cubes: {},
        });
      }
    }
    return state;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
