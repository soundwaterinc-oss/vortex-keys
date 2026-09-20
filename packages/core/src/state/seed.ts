import { hashSeed } from '../math/prng'

/**
 * global seed + instrument id -> independent deterministic seed. A whole
 * composition reproduces from one number while each instrument's PRNG
 * stream stays uncorrelated with the others.
 */
export function deriveSeed(globalSeed: number, instrumentId: string, salt = ''): number {
  const h = hashSeed(`${instrumentId}:${salt}`)
  // xorshift mix so nearby global seeds diverge
  let x = (globalSeed ^ h) >>> 0
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}
