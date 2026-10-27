import { incomeLevelAt, increaseIncomeSpaces } from './income';
import { player } from './mat';
import { gainWhiskey } from './turn';
import type { FlipReward, GameState, PlayerId } from './types';

export function applyReward(
  state: GameState,
  playerId: PlayerId,
  reward: Partial<FlipReward>,
): void {
  const p = player(state, playerId);
  if (reward.doubleIncome) p.money += 2 * incomeLevelAt(p.incomeSpace);
  if (reward.money) p.money += reward.money;
  if (reward.incomeSpaces) p.incomeSpace = increaseIncomeSpaces(p.incomeSpace, reward.incomeSpaces);
  if (reward.whiskey) gainWhiskey(state, playerId, reward.whiskey);
  if (reward.vp) p.vp += reward.vp;
  if (reward.freeDevelops) p.pendingFreeDevelops += reward.freeDevelops;
  if (reward.lightTrains) p.lightTrains += reward.lightTrains;
}
