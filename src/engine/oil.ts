import { tile } from './catalog';
import { describeReward, playerTag } from './logText';
import { deferLog } from './logQueue';
import { applyReward } from './rewards';
import type { GameState, OilfieldState } from './types';

/** Barrels from a new pipeline. An Oil City already on the field receives them. */
export function addOilBarrels(field: OilfieldState, count: number): void {
  if (count <= 0) return;
  if (field.oilCitySlot) {
    field.oilCitySlot.cubes.oil = (field.oilCitySlot.cubes.oil ?? 0) + count;
    return;
  }
  field.oil += count;
}

export function looseFieldOil(field: OilfieldState): number {
  return field.oilCitySlot ? 0 : field.oil;
}

/** Oil sitting on the Oil City, plus any barrels still recorded on the field. */
export function oilCityBarrels(field: OilfieldState): number {
  if (!field.oilCitySlot) return 0;
  return (field.oilCitySlot.cubes.oil ?? 0) + field.oil;
}

export function takeOilBarrel(state: GameState, field: OilfieldState, fromCity: boolean): void {
  if (fromCity || field.oilCitySlot) {
    const slot = field.oilCitySlot;
    if (!slot) return;
    const onTile = slot.cubes.oil ?? 0;
    if (onTile > 0) slot.cubes.oil = onTile - 1;
    else field.oil = Math.max(0, field.oil - 1);
    const left = (slot.cubes.oil ?? 0) + field.oil;
    if (left === 0 && slot.tileDefId && slot.owner !== null && !slot.flipped) {
      slot.flipped = true;
      const reward = { ...tile(slot.tileDefId).flipReward, vp: 0 };
      applyReward(state, slot.owner, reward);
      deferLog(state, `${playerTag(slot.owner)} 的石油城油桶用尽，翻面，${describeReward(reward)}。`);
    }
    return;
  }
  field.oil -= 1;
}
