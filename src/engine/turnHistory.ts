export type HistoryFlag = { revealedOilfield: boolean; secondLink: boolean; unfinished: boolean };

export function undoLastStep(last: HistoryFlag): { blocked: true } | { blocked: false; secondLink: boolean } {
  if (last.revealedOilfield) return { blocked: true };
  return { blocked: false, secondLink: last.secondLink };
}

/** After an oilfield reveal, later steps in that action rewind to the second-link question. */
export function restartAfterOil(steps: HistoryFlag[]): { keep: number; askSecond: boolean } {
  let keep = 0;
  let askSecond = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step?.revealedOilfield) continue;
    keep = i + 1;
    askSecond = step.unfinished;
  }
  return { keep, askSecond };
}
