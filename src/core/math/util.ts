export const TAU = Math.PI * 2

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Replace NaN/Infinity with a fallback before it can reach an AudioParam. */
export function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback
}

/** Safe value for AudioParams: finite and clamped. */
export function safeParam(v: number, lo: number, hi: number, fallback: number): number {
  return clamp(finite(v, fallback), lo, hi)
}

/** Wrap angle into [0, TAU). */
export function wrapAngle(a: number): number {
  a = a % TAU
  return a < 0 ? a + TAU : a
}

/** Positive modulo. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Detect whether a rotating value crossed a target angle between prev and curr.
 * Both directions are handled: we measure the signed angular displacement and
 * check whether the target lies within the swept arc. Assumes |curr - prev| < PI
 * per step (true for the fixed-step simulation at any sane SPIN).
 */
export function crossedAngle(prev: number, curr: number, target: number): boolean {
  const p = wrapAngle(prev)
  const c = wrapAngle(curr)
  const t = wrapAngle(target)
  let delta = c - p
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  if (delta === 0) return false
  // distance from p to t, measured in the direction of motion
  let d = t - p
  if (delta > 0) {
    if (d < 0) d += TAU
    return d > 0 && d <= delta
  } else {
    if (d > 0) d -= TAU
    return d < 0 && d >= delta
  }
}
