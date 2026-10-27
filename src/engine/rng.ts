export function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function nextRng(state: number): { state: number; value: number } {
  const stateNext = mulberry32(state);
  return { state: stateNext, value: stateNext / 4294967296 };
}

export function shuffle<T>(items: T[], rngState: number): { items: T[]; rng: number } {
  const copy = [...items];
  let rng = rngState;
  for (let i = copy.length - 1; i > 0; i--) {
    const n = nextRng(rng);
    rng = n.state;
    const j = Math.floor(n.value * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return { items: copy, rng };
}
