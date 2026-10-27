import { location, oilfield, pipeline, rail, tile } from './catalog';
import type { FlipReward, PlayerId } from './types';

export function playerTag(id: PlayerId): string {
  return `P${id + 1}`;
}

const KIND_ZH: Record<string, string> = {
  coal: '煤矿',
  coke: '焦炭',
  iron: '炼钢',
  steel: '炼钢',
  manufacturing: '制造',
  automobile: '汽车',
  locomotive: '重型机车厂',
  kerosene: '煤油',
  oilCity: '石油城',
  polyphase: '交流发电机',
  skyscraper: '摩天楼',
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Printed roman level. sky1/sky2 are 摩天楼 III and V, not their chain indexes. */
const PRINTED_LEVEL: Record<string, number> = {
  sky1: 3,
  sky2: 5,
};

export function tileName(id: string): string {
  try {
    const built = tile(id);
    const kind = KIND_ZH[built.kind] ?? id;
    if (built.kind === 'locomotive' || built.kind === 'polyphase' || built.kind === 'oilCity') return kind;
    const level = PRINTED_LEVEL[id] ?? built.level;
    return `${kind} ${ROMAN[level] ?? level}`;
  } catch {
    return id;
  }
}

export function placeName(id: string): string {
  return location(id)?.name ?? oilfield(id)?.name ?? id;
}

export function lineName(lineId: string): string {
  const road = rail(lineId);
  if (road) return `${placeName(road.a)}—${placeName(road.b)}`;
  const pipe = pipeline(lineId);
  if (pipe) return `${placeName(pipe.city)}—${placeName(pipe.oilfield)}`;
  return lineId;
}

/** Flip and hex rewards move the income marker by spaces. */
export function describeReward(reward: Partial<FlipReward>): string {
  const bits: string[] = [];
  if (reward.money) bits.push(`现金 +$${reward.money}`);
  if (reward.incomeSpaces) bits.push(`收入 +${reward.incomeSpaces} 格`);
  if (reward.whiskey) bits.push(`威士忌 +${reward.whiskey}`);
  if (reward.vp) bits.push(`分数 +${reward.vp}`);
  if (reward.freeDevelops) bits.push(`免费研发 ${reward.freeDevelops} 次`);
  if (reward.doubleIncome) bits.push('当前收入×2');
  if (reward.lightTrains) bits.push(`收回轻轨 ${reward.lightTrains}`);
  return bits.length ? bits.join('，') : '没有现金或收入';
}
