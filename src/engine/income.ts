/**
 * Spaces per income level, fitted to the 100-space track:
 * 0 and below one space, 1–10 two, 11–20 three, 21 and above four.
 * Level 30 keeps the last three spaces.
 */
export const INCOME_BANDS: ReadonlyArray<{ level: number; from: number; to: number }> = (() => {
  const out: { level: number; from: number; to: number }[] = [];
  let space = 0;
  const push = (level: number, count: number) => {
    if (space > 99) return;
    const n = Math.min(count, 100 - space);
    out.push({ level, from: space, to: space + n - 1 });
    space += n;
  };
  for (let level = -10; level <= 0; level++) push(level, 1);
  for (let level = 1; level <= 10; level++) push(level, 2);
  for (let level = 11; level <= 20; level++) push(level, 3);
  for (let level = 21; space <= 99; level++) push(level, 4);
  return out;
})();

/** Standard Brass progress-track income levels for spaces 0–99. */
const LEVELS: number[] = (() => {
  const out: number[] = [];
  for (const band of INCOME_BANDS) {
    for (let s = band.from; s <= band.to; s++) out[s] = band.level;
  }
  return out;
})();

export function incomeLevelAt(space: number): number {
  const s = Math.max(0, Math.min(99, space));
  return LEVELS[s] ?? -10;
}

export function highestSpaceForLevel(level: number): number {
  for (let s = 99; s >= 0; s--) {
    if (LEVELS[s] === level) return s;
  }
  return 0;
}

export function increaseIncomeSpaces(space: number, n: number): number {
  return Math.max(0, Math.min(99, space + n));
}

export function decreaseIncomeLevels(space: number, levels: number): number | null {
  const next = incomeLevelAt(space) - levels;
  if (next < -10) return null;
  return highestSpaceForLevel(next);
}
