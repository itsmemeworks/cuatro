/**
 * Tiny seeded PRNG (mulberry32) for deterministic tests. Not part of the
 * public @cuatro/glass API — the engine itself never generates randomness.
 * This exists purely so the simulation test is 100% reproducible without
 * relying on Math.random.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, maxExclusive). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Uniform float in [min, max). */
export function randomFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** `count` distinct integers in [0, poolSize), via rejection sampling. */
export function pickDistinct(rng: Rng, poolSize: number, count: number): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(randomInt(rng, poolSize));
  }
  return [...chosen];
}
