import { describe, it, expect } from 'vitest';
import { createGame } from '../engine/state';
import { applyAction } from '../engine/apply';
import { assignRoles, mctsChoose, chooseAiAction } from './choose';

describe('MCTS 驱动对局行为（#接入验证）', () => {
  it('seed777 用 MCTS(16×2) 驱动前 8 步：首步核心城煤开、无断管', () => {
    const g = createGame(777);
    const roles = assignRoles(g);
    let s = g;
    const acts: { pid: number; type: string; target: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const pid = s.currentPlayerId as 0 | 1 | 2 | 3;
      const a =
        mctsChoose(s, pid, roles, { iterations: 16, rolloutDepth: 2, topK: 4, topM: 8 }) ??
        chooseAiAction(s, pid, roles);
      expect(a).not.toBeNull();
      const target = (a as { slotId?: string; tileDefId?: string; oilfieldId?: string }).slotId
        ?? (a as { slotId?: string; tileDefId?: string; oilfieldId?: string }).tileDefId
        ?? (a as { slotId?: string; tileDefId?: string; oilfieldId?: string }).oilfieldId
        ?? '';
      acts.push({ pid, type: a!.type, target });
      const r = applyAction(s, a!);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(acts));
    // P4 先手：首步核心煤城（巴里/克堡）煤开——开局软先验，非浅搜「从零证明」
    expect(acts[0]?.type).toBe('build');
    const t = acts[0]?.target ?? '';
    expect(t.startsWith('wilkes-barre') || t.startsWith('clarksburg')).toBe(true);
  });
});
