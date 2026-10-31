import { describe, it, expect } from 'vitest';
import { applyAction } from '../engine/apply';
import { clone } from '../engine/clone';
import { createGame } from '../engine/state';
import { assignRoles, pickLoanAction, proposeRootActions } from './choose';
import { seatTempoProxyVp } from './era1Anchor';
import { tile } from '../engine/catalog';

describe('seatTempoProxyVp', () => {
  it('贷款（花费0）的顺位代理高于花钱造煤', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    const pid = game.currentPlayerId;
    const loan = pickLoanAction(game, pid, roles[pid]);
    expect(loan).not.toBeNull();
    const coal = proposeRootActions(game, pid, roles, 12, 24).find(
      (a) => a.type === 'build' && a.tileDefId && tile(a.tileDefId).kind === 'coal',
    );
    expect(coal).toBeTruthy();

    const afterLoan = applyAction(clone(game), loan!);
    const afterCoal = applyAction(clone(game), coal!);
    expect(afterLoan.ok && afterCoal.ok).toBe(true);
    if (!afterLoan.ok || !afterCoal.ok) return;

    const loanSeat = seatTempoProxyVp(game, afterLoan.state, pid);
    const coalSeat = seatTempoProxyVp(game, afterCoal.state, pid);
    expect(loanSeat).toBeGreaterThan(coalSeat);
  });
});
