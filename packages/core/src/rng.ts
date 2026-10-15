/** Random source used by all game logic. Inject it so tests can seed it. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

/** Small, fast, seedable PRNG (mulberry32). Not cryptographic; fine for game rolls. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export const mathRandomRng: Rng = { next: () => Math.random() };
