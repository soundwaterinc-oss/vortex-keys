export type TimingMode = 'free' | 'soft' | 'hard'
export type QuantizeValue = '1/4' | '1/8' | '1/16' | '1/8T' | '1/16T'

export const QUANTIZE_VALUES: QuantizeValue[] = ['1/4', '1/8', '1/16', '1/8T', '1/16T']

/** Grid step in beats (quarter note = 1 beat). */
export function quantizeStepBeats(q: QuantizeValue): number {
  switch (q) {
    case '1/4':
      return 1
    case '1/8':
      return 0.5
    case '1/16':
      return 0.25
    case '1/8T':
      return 1 / 3
    case '1/16T':
      return 1 / 6
  }
}

/**
 * Map a mathematically generated time onto the musical grid.
 *   FREE: untouched — the FlowEngine's timing is the music.
 *   SOFT: move `strength` of the way to the nearest grid point (keeps drift audible).
 *   HARD: snap to the *next* grid point at or after the event (never earlier than
 *         requested, so lookahead scheduling stays causal).
 * `origin` is the audio time of beat 0.
 */
export function quantizeTime(
  t: number,
  mode: TimingMode,
  q: QuantizeValue,
  bpm: number,
  origin = 0,
  strength = 0.5,
): number {
  if (mode === 'free') return t
  const step = (quantizeStepBeats(q) * 60) / bpm
  const rel = t - origin
  if (mode === 'hard') return origin + Math.ceil(rel / step - 1e-9) * step
  const nearest = Math.round(rel / step) * step
  const target = origin + nearest
  const moved = t + (target - t) * strength
  // never pull earlier than the original time by more than half a step
  return Math.max(moved, t - step * 0.5)
}
