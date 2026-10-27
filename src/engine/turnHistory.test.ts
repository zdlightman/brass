import { describe, expect, it } from 'vitest';
import { restartAfterOil, undoLastStep } from './turnHistory';

describe('oilfield undo', () => {
  const reveal = { revealedOilfield: true, secondLink: false, unfinished: true };
  const second = { revealedOilfield: false, secondLink: true, unfinished: false };

  it('refuses to undo the link that opened the oilfield', () => {
    expect(undoLastStep(reveal)).toEqual({ blocked: true });
  });

  it('undoes the second link back to the question', () => {
    expect(undoLastStep(second)).toEqual({ blocked: false, secondLink: true });
  });

  it('rewinds a second link to the question after the oilfield', () => {
    expect(restartAfterOil([reveal, second])).toEqual({ keep: 1, askSecond: true });
  });

  it('stays on the question when the reveal is the latest step', () => {
    expect(restartAfterOil([reveal])).toEqual({ keep: 1, askSecond: true });
  });
});
