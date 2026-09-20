/** Normalisation / response-curve utilities used by the mapping layer. */
import { clamp } from '../math/util'

export type CurveType = 'linear' | 'exp' | 'invExp' | 'scurve'

export const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1)

/** value in [min,max] -> [0,1], clamped. */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0
  return clamp01((value - min) / (max - min))
}

export function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * normalize(value, inMin, inMax)
}

/** Power curve on [0,1]; exponent > 1 compresses low values. */
export function curve(value: number, exponent: number): number {
  return Math.pow(clamp01(value), exponent)
}

/** Named response curves on [0,1]. */
export function applyCurve(value: number, type: CurveType): number {
  const v = clamp01(value)
  switch (type) {
    case 'linear':
      return v
    case 'exp':
      return v * v
    case 'invExp':
      return 1 - (1 - v) * (1 - v)
    case 'scurve':
      return v * v * (3 - 2 * v)
  }
}
