import { incomeLevelAt } from '../engine/income';
import { player } from '../engine/mat';
import type { GameState, PlayerId } from '../engine/types';
import { ROLE_ZH, type Role } from './choose';

/**
 * 结构化的"行动者自观"：在某步动作的决策瞬间，记录该玩家自己能看到的手牌与资源。
 *
 * 用途：喂给 AI 反思循环。AI 读对局日志时，需要知道"这一步发生时我手上有什么牌、
 * 有多少现金/收入/工具/已建产业"，才能回答"为什么没有完成既定目标"。
 *
 * 字段刻意保持为行动者私有视角（自己的手牌 + 自己的公开资源），不含其他玩家的手牌，
 * 避免把全信息局面泄漏进训练数据（见 docs/AI下一步.md）。
 *
 * reason 为预留字段：目前评分系统的"思考理由"就是各项评分，后期把 scoreAction 的
 * 分解项写进来即可，字段结构不变。
 */
export interface PlayerObs {
  pid: PlayerId;
  role: Role;
  era: 1 | 2;
  round: number;
  /** 本步动作类型：pass/loan/develop/network/build/sell/… */
  action: string;
  /** 手牌卡牌的 defId 列表（决策瞬间手里有什么）。 */
  hand: string[];
  money: number;
  incomeLevel: number;
  vp: number;
  whiskey: number;
  lightTrains: number;
  /** 可用重车类型（供应里还有的），如 ['steelResource','replacement']。 */
  heavies: string[];
  /** 可用管道类型，如 ['income','vp']。 */
  pipes: string[];
  /** 已建产业计数：tileDefId -> 数量，用于核对主线目标（box: m1×2+m2；oil: k2×2+k3）。 */
  built: Record<string, number>;
  /** 已建连接（轻轨/重车/管道）的 lineId 列表。 */
  links: string[];
  /** 预留：这一步的思考理由（评分分解）。 */
  reason?: string;
}

export function observePlayer(
  state: GameState,
  pid: PlayerId,
  role: Role,
  action: string,
): PlayerObs {
  const p = player(state, pid);
  const built: Record<string, number> = {};
  for (const slot of state.slots) {
    if (slot.owner !== pid || !slot.tileDefId) continue;
    built[slot.tileDefId] = (built[slot.tileDefId] ?? 0) + 1;
  }
  const links = state.links
    .filter((link) => link.owner === pid)
    .map((link) => link.lineId);
  return {
    pid,
    role,
    era: state.era,
    round: state.round,
    action,
    hand: p.hand.map((card) => card.defId),
    money: p.money,
    incomeLevel: incomeLevelAt(p.incomeSpace),
    vp: p.vp,
    whiskey: p.whiskey,
    lightTrains: p.lightTrains,
    heavies: p.heavySupply.map((heavy) => heavy.type),
    pipes: p.pipelineSupply.map((pipe) => pipe.type),
    built,
    links,
  };
}

/** 一行紧凑、可读、可被脚本解析的观测文本，追加到对局日志里给 AI 读。 */
export function formatObs(obs: PlayerObs): string {
  const built = Object.entries(obs.built)
    .map(([id, n]) => `${id}:${n}`)
    .join(',');
  const reason = obs.reason ? ` 想:${obs.reason}` : '';
  return (
    `[obs] P${obs.pid + 1} ${ROLE_ZH[obs.role]} 时代${obs.era}R${obs.round} ${obs.action} ` +
    `手:[${obs.hand.join(',')}] 钱${obs.money} 收${obs.incomeLevel} 分${obs.vp} ` +
    `威士忌${obs.whiskey} 轻轨${obs.lightTrains} 重车:[${obs.heavies.join(',')}] ` +
    `管道:[${obs.pipes.join(',')}] 建:{${built}} 连:[${obs.links.join(',')}]${reason}`
  );
}

/**
 * 统一的对局观测记录入口：在动作应用成功后调用。
 * 用"动作前局面"（before，即决策瞬间）生成行动者自观，写入"后继局面"（after）的日志。
 * self-play 脚本与热座界面都走这里，保证人类 vs AI 与 AI 自对弈的记录口径一致。
 * 返回写入的那一行文本。
 */
export function recordActionObs(
  before: GameState,
  after: GameState,
  pid: PlayerId,
  role: Role,
  actionType: string,
): string {
  const text = formatObs(observePlayer(before, pid, role, actionType));
  after.log.push({ text });
  return text;
}
