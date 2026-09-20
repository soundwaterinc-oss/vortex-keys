/**
 * Seeded PRNG (mulberry32). Every generative decision in the instrument
 * (turbulence, child particle spawn, randomize) goes through one of these so
 * that a preset + seed reproduces the same musical structure.
 */
export interface Prng {
  /** uniform float in [0, 1) */
  next(): number
  /** uniform float in [min, max) */
  range(min: number, max: number): number
  /** signed float in [-1, 1) */
  signed(): number
  /** integer in [0, n) */
  int(n: number): number
  /** current internal state (for save/restore) */
  state(): number
}

export function createPrng(seed: number): Prng {
  let a = (seed >>> 0) || 0x9e3779b9
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    signed: () => next() * 2 - 1,
    int: (n) => Math.floor(next() * n),
    state: () => a,
  }
}

/** Hash a string to a 32-bit seed (FNV-1a) so users may type seed words. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
