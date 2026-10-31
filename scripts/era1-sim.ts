import { writeFileSync } from 'node:fs';

import { chooseAiAction, countOf, builtCount, assignRoles, ROLE_ZH, type Role } from '../src/ai/choose';
import { recordActionObs } from '../src/ai/observe';
import { applyAction } from '../src/engine/apply';
import { incomeLevelAt } from '../src/engine/income';
import { createGame } from '../src/engine/state';
import { setHoldEraScore } from '../src/engine/turn';
import type { GameState, PlayerId } from '../src/engine/types';

export function playEra1(): void {
  setHoldEraScore(true);
  const notes: string[] = [];
  let state = createGame(20261026);
  const roles = assignRoles(state);

  for (let step = 0; step < 500 && !state.eraScoreHeld && !state.over; step++) {
    const pid = state.currentPlayerId;
    const style = roles[pid];
    const action = chooseAiAction(state, pid, roles);
    if (!action) {
      notes.push(`第 ${step + 1} 步没有合法动作，停在 P${pid + 1}。`);
      break;
    }
    const result = applyAction(state, action);
    if (!result.ok) {
      notes.push(`动作被拒绝：${result.error} ${JSON.stringify(action)}`);
      break;
    }
    // 决策瞬间的自观（动作前局面），写入后继局面日志，供反思循环读取。
    recordActionObs(state, result.state, pid, style, action.type);
    const fresh = result.state.log.slice(state.log.length);
    const actionText: string[] = [];
    for (const entry of fresh) {
      if (/^(过回合|第 \d+ 回合|时代计分|一时代计分|时代 \d+ 开始)/.test(entry.text)) {
        if (actionText.length) {
          notes.push(`R${state.round} P${pid + 1}（${ROLE_ZH[style]}）${actionText.join(' ')}`);
          actionText.length = 0;
        }
        notes.push(entry.text);
      } else if (!entry.text.startsWith('[obs]')) {
        actionText.push(entry.text);
      }
    }
    if (actionText.length) {
      notes.push(`R${state.round} P${pid + 1}（${ROLE_ZH[style]}）${actionText.join(' ')}`);
    }
    state = result.state;
  }

  const logPath = 'D:\\pythonprojects\\Brass\\era1-play.log';
  const savePath = 'D:\\pythonprojects\\Brass\\public\\era1-prescore.json';
  writeFileSync(logPath, `${notes.join('\n')}\n\n${summary(state, roles)}\n\n--- 引擎日志 ---\n${state.log.map((entry) => entry.text).join('\n')}\n`);
  writeFileSync(savePath, JSON.stringify(state));
  console.log(`held=${state.eraScoreHeld} era=${state.era} round=${state.round} steps=${notes.length}`);
  console.log(summary(state, roles));
  setHoldEraScore(false);
}

function summary(current: GameState, assigned: Record<PlayerId, Role>): string {
  const lines = current.players.map((entry) => {
    const built = current.slots
      .filter((slot) => slot.owner === entry.id && slot.tileDefId)
      .map((slot) => `${slot.tileDefId}@${slot.locationId}${slot.flipped ? '翻' : ''}`)
      .join(', ');
    const links = current.links.filter((link) => link.owner === entry.id).map((link) => link.lineId).join(', ');
    const role = assigned[entry.id];
    const goal = role === 'box'
      ? `目标112箱 现制造I×${builtCount(current, entry.id, 'm1')} 制造II×${builtCount(current, entry.id, 'm2')}`
      : `目标223油 现煤油II×${builtCount(current, entry.id, 'k2')} 煤油III×${builtCount(current, entry.id, 'k3')}`;
    return `P${entry.id + 1} ${ROLE_ZH[role]} 钱${entry.money} 收入${incomeLevelAt(entry.incomeSpace)} 分${entry.vp} 威士忌${entry.whiskey} | ${goal} | ${built || '无建筑'} | ${links || '无连接'}`;
  });
  return `${lines.join('\n')}\n\n${usageStats(current)}\n\n${scoreStats(current)}`;
}

function usageStats(current: GameState): string {
  const cubes = ['煤', '铁', '焦炭', '钢'] as const;
  const blank = () => ({ 煤: 0, 铁: 0, 焦炭: 0, 钢: 0 });
  const rows = [0, 1, 2, 3].map(() => ({ free: blank(), heavy: blank(), market: blank(), outside: blank(), loans: 0 }));
  for (const entry of current.log) {
    const who = /^P(\d)/.exec(entry.text);
    if (!who) continue;
    const row = rows[Number(who[1]) - 1];
    if (!row) continue;
    if (entry.text.includes('贷款')) row.loans += 1;
    for (const cube of cubes) {
      row.free[cube] += countOf(entry.text, `的免费${cube}`);
      row.heavy[cube] += countOf(entry.text, `重车上的${cube}`);
      const outside = countOf(entry.text, `从外部购买${cube}`);
      row.outside[cube] += outside;
      row.market[cube] += countOf(entry.text, `购买${cube}`) - outside;
    }
  }
  const show = (bag: Record<(typeof cubes)[number], number>) => cubes.filter((cube) => bag[cube] > 0).map((cube) => `${cube}${bag[cube]}`).join(' ') || '无';
  const lines = rows.map((row, index) => `P${index + 1} 贷款${row.loans}次 | 免费产业 ${show(row.free)} | 重车 ${show(row.heavy)} | 市场 ${show(row.market)} | 外部 ${show(row.outside)}`);
  const total = rows.reduce(
    (sum, row) => {
      sum.loans += row.loans;
      for (const cube of cubes) {
        sum.free += row.free[cube];
        sum.heavy += row.heavy[cube];
        sum.market += row.market[cube];
        sum.outside += row.outside[cube];
      }
      return sum;
    },
    { loans: 0, free: 0, heavy: 0, market: 0, outside: 0 },
  );
  lines.push(`合计 贷款${total.loans}次 | 免费产业 ${total.free} | 重车 ${total.heavy} | 市场 ${total.market} | 外部 ${total.outside}`);
  return lines.join('\n');
}

function scoreStats(current: GameState): string {
  const kinds = ['连接分', '产业分', '首卖分', '品质星分', '焦炭分', '市场分', '管道分'] as const;
  const rows = [0, 1, 2, 3].map(() => ({ 连接分: 0, 产业分: 0, 首卖分: 0, 品质星分: 0, 焦炭分: 0, 市场分: 0, 管道分: 0 }));
  for (const entry of current.log) {
    for (const kind of kinds) {
      const found = entry.text.matchAll(new RegExp(`P(\\d) 记${kind} (\\d+)`, 'g'));
      for (const match of found) {
        const row = rows[Number(match[1]) - 1];
        if (row) row[kind] += Number(match[2]);
      }
    }
  }
  const lines = rows.map((row, index) => {
    const scored = kinds.reduce((sum, kind) => sum + row[kind], 0);
    const vp = current.players[index]?.vp ?? 0;
    return `P${index + 1} 连接分 ${row.连接分} | 产业分 ${row.产业分} | 首卖分 ${row.首卖分} | 品质星分 ${row.品质星分} | 焦炭分 ${row.焦炭分} | 市场分 ${row.市场分} | 管道分 ${row.管道分} | 记录合计 ${scored} | 玩家分数 ${vp}`;
  });
  const total = rows.reduce(
    (sum, row) => {
      for (const kind of kinds) sum[kind] += row[kind];
      return sum;
    },
    { 连接分: 0, 产业分: 0, 首卖分: 0, 品质星分: 0, 焦炭分: 0, 市场分: 0, 管道分: 0 },
  );
  lines.push(`合计 连接分 ${total.连接分} | 产业分 ${total.产业分} | 首卖分 ${total.首卖分} | 品质星分 ${total.品质星分} | 焦炭分 ${total.焦炭分} | 市场分 ${total.市场分} | 管道分 ${total.管道分}`);
  return lines.join('\n');
}

