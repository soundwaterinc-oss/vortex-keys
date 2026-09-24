import { createPrng } from '@el-systema/core'

/**
 * The spiral sequencer.
 *
 * A pattern is one turn long (`stepsPerTurn`). The playhead does not loop
 * back onto the same circle: it spirals outward for `turns` revolutions.
 * The first turn plays what you drew; each turn after it has travelled
 * further from the figure, and then the spiral returns to the centre. So a figure
 * comes back recognisable but displaced — the dub-techno principle of a loop
 * that is never quite the loop you heard.
 *
 * Every transformation is a pure function of (base pattern, turn index,
 * seed, drift), so the same settings always play the same piece.
 */
export const TRACKS = ['kick', 'sub', 'snare', 'hat', 'perc', 'air'] as const
export type TrackId = (typeof TRACKS)[number]

export const TRACK_LABEL: Record<TrackId, string> = {
  kick: 'KICK',
  sub: 'SUB',
  snare: 'SNARE',
  hat: 'HAT',
  perc: 'PERC',
  air: 'AIR',
}

/** One turn of one track: velocity per step, 0 = silent. */
export type TrackPattern = number[]
export type Pattern = Record<TrackId, TrackPattern>

export interface SpiralConfig {
  stepsPerTurn: number
  turns: number
  /** 0..1 — how much each turn mutates the material */
  drift: number
  /** steps the pattern rotates per turn (the spiral's pitch, in steps) */
  rotate: number
  /** 0..1 — scales every trigger probability */
  density: number
  /**
   * 0..1 — how far the tracks' cycle lengths pull apart. At 0 every track
   * turns with the bar; above it each one gets its own length, so the tracks
   * precess against each other and the whole figure only closes after their
   * common multiple. This is the second spiral axis.
   */
  poly: number
  /** 0..1 — micro-timing warp; a third axis, period 3 turns */
  warp: number
  /** 0..1 — pitch bend along a fourth axis, period 5 turns */
  bend: number
  /** 0..1 — distortion along a fifth axis, period 7 turns */
  fold: number
  /** 0..1 — grit (bit steps, asymmetry, ring) along a sixth axis, 11 turns */
  grind: number
  /** 0..1 — how much the sub layer breathes, seventh axis, 13 turns */
  mass: number
  /** 0..1 — how much the spiral opens and closes, eighth axis, 6.5 turns */
  gate: number
  seed: number
}

export const DEFAULT_SPIRAL: SpiralConfig = {
  stepsPerTurn: 16,
  turns: 4,
  drift: 0.35,
  rotate: 1,
  density: 0.85,
  poly: 0.45,
  warp: 0.35,
  bend: 0.3,
  fold: 0.45,
  grind: 0.5,
  mass: 0.4,
  gate: 0.35,
  seed: 7,
}

/**
 * The axes are deliberately incommensurate: 3, 5 and 7 turns against the
 * pattern's own turn and the tracks' own lengths. Nothing lines up twice
 * inside any reasonable performance, which is what keeps the spiral from
 * reading as one rotating wheel.
 */
const AXIS_TURNS = { warp: 3, bend: 5, fold: 7, grind: 11, mass: 13, gate: 6.5 } as const
/**
 * Each track also sits at its own phase on every axis, so one axis never
 * moves the kit as a block — the kick can be at the top of the grind axis
 * while the hats are at the bottom of it.
 */
const TRACK_PHASE: Record<TrackId, number> = { kick: 0, sub: 0.8, snare: 2.1, hat: 3.4, perc: 4.7, air: 5.6 }
/** how each track's cycle length is pulled off the bar at poly = 1 */
const POLY_OFFSET: Record<TrackId, number> = { kick: 0, sub: -1, snare: 1, hat: -3, perc: 3, air: -5 }

/**
 * A track's own cycle length in steps. KICK always holds the bar — the
 * ground has to stay where it is for the drift to be audible as drift.
 */
export function trackLength(track: TrackId, cfg: SpiralConfig): number {
  const off = Math.round(POLY_OFFSET[track] * cfg.poly)
  return Math.max(4, cfg.stepsPerTurn + off)
}

export interface Axes {
  /** micro-timing, in fractions of a step (±) */
  warp: number
  /** pitch, in cents (±) */
  bend: number
  /** extra distortion, 0..1 */
  fold: number
  /** grit: bit steps, asymmetry, ring modulation, 0..1 */
  grind: number
  /** sub-layer multiplier, around 1 */
  mass: number
  /** trigger-probability multiplier, 0..1 */
  gate: number
}

/**
 * The continuous axes at one point of the spiral, optionally as one track
 * sees them. Periods are 3, 4.5, 5, 6.5, 7, 11 and 13 turns: no two of them
 * share a factor, so the combination does not repeat inside any performance.
 */
export function axesAt(globalIndex: number, cfg: SpiralConfig, track?: TrackId): Axes {
  const turnPos = globalIndex / Math.max(1, cfg.stepsPerTurn)
  const off = track ? TRACK_PHASE[track] : 0
  const ph = (period: number, phase = 0) => Math.sin((turnPos / period) * Math.PI * 2 + phase + off / period)
  return {
    // two warp components a fifth apart in period, so the push and pull
    // themselves drift in and out of phase
    warp: cfg.warp * 0.5 * (ph(AXIS_TURNS.warp) * 0.7 + ph(AXIS_TURNS.warp * 1.5, 1.1) * 0.3),
    bend: cfg.bend * 140 * ph(AXIS_TURNS.bend),
    fold: cfg.fold * (0.5 + 0.5 * ph(AXIS_TURNS.fold, 0.6)),
    grind: cfg.grind * (0.5 + 0.5 * ph(AXIS_TURNS.grind, 2.2)),
    mass: 1 + cfg.mass * 0.9 * ph(AXIS_TURNS.mass, 1.7),
    gate: 1 - cfg.gate * (0.5 + 0.5 * ph(AXIS_TURNS.gate, 0.3)),
  }
}

/** A step that actually sounds, with everything a kit needs to voice it. */
export interface Hit {
  track: TrackId
  /** index within the track's own cycle */
  step: number
  /** the track's own turn count, which is not the bar count once poly > 0 */
  turn: number
  velocity: number
  /** 0..1 position along the whole spiral — kits use it to morph timbre */
  spiral: number
  /** micro-timing offset in fractions of a step */
  warp: number
  /** detune in cents */
  bend: number
  /** extra distortion, 0..1 */
  fold: number
  /** grit, 0..1 */
  grind: number
  /** sub-layer multiplier around 1 */
  mass: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function emptyPattern(stepsPerTurn: number): Pattern {
  const blank = () => new Array(stepsPerTurn).fill(0)
  return { kick: blank(), sub: blank(), snare: blank(), hat: blank(), perc: blank(), air: blank() }
}

/** Resize keeping the musical positions (a 16-step figure stays on the beat at 24). */
export function resizePattern(p: Pattern, from: number, to: number): Pattern {
  const out = emptyPattern(to)
  for (const t of TRACKS) {
    for (let i = 0; i < from; i++) {
      if (!p[t][i]) continue
      const j = Math.round((i / from) * to) % to
      out[t][j] = Math.max(out[t][j], p[t][i])
    }
  }
  return out
}

/**
 * The turn transform. Rotation carries the figure around the spiral;
 * `drift` decides how much a turn may drop steps, shift them by one, and
 * tilt their velocity. Nothing here is random at playback time — the PRNG is
 * re-seeded from (seed, turn, track) so any turn can be computed on its own.
 */
export function turnPattern(base: TrackPattern, track: TrackId, turn: number, cfg: SpiralConfig): TrackPattern {
  const n = base.length
  const out = new Array(n).fill(0)
  const trackSeed = TRACKS.indexOf(track) * 9973
  const rnd = createPrng(cfg.seed * 7919 + turn * 104729 + trackSeed)
  const shift = ((cfg.rotate * turn) % n + n) % n
  // AIR and SUB are the bed: they drift far less, so the ground stays put
  const stability = track === 'air' || track === 'sub' ? 0.35 : 1
  // turn 0 is the figure exactly as written; the further out the spiral goes,
  // the further the material has travelled from it
  const reach = turn === 0 ? 0 : 0.4 + 0.6 * (turn / Math.max(1, cfg.turns - 1))
  const d = cfg.drift * stability * Math.min(1.2, reach)
  for (let i = 0; i < n; i++) {
    const v = base[i]
    if (v <= 0) {
      // drift can also *add* a ghost note, always quiet and off the strong beats
      if (turn > 0 && i % 4 !== 0 && rnd.next() < d * 0.12) out[(i + shift) % n] = 0.25 + 0.2 * rnd.next()
      continue
    }
    if (rnd.next() < d * 0.3 * (i % 4 === 0 ? 0.35 : 1)) continue // dropped this turn
    const nudge = rnd.next() < d * 0.25 ? (rnd.next() < 0.5 ? -1 : 1) : 0
    const at = (((i + shift + nudge) % n) + n) % n
    const tilt = 1 - d * 0.4 * rnd.next()
    out[at] = Math.max(out[at], clamp01(v * tilt))
  }
  return out
}

/**
 * Everything that sounds at one point of the spiral.
 *
 * `globalIndex` counts steps from the start; each track reads it through its
 * own cycle length, so the tracks sit on different turns at the same moment.
 */
export function hitsAt(pattern: Pattern, globalIndex: number, cfg: SpiralConfig): Hit[] {
  const hits: Hit[] = []
  const total = Math.max(1, cfg.stepsPerTurn * cfg.turns)
  const spiral = (((globalIndex % total) + total) % total) / total
  for (const track of TRACKS) {
    // every track reads the axes from its own phase
    const ax = axesAt(globalIndex, cfg, track)
    const len = trackLength(track, cfg)
    const step = ((globalIndex % len) + len) % len
    const turn = Math.floor(globalIndex / len)
    const v = turnPattern(pattern[track].slice(0, len), track, turn, cfg)[step]
    if (!v || v <= 0) continue
    // density thins the spiral out without editing the pattern
    const gate = createPrng(cfg.seed * 31 + turn * 613 + step * 17 + TRACKS.indexOf(track)).next()
    // the gate axis opens and closes the whole spiral as it turns
    if (gate > cfg.density * ax.gate) continue
    // the axes lean on the tracks differently: the ground bends least
    const lean = track === 'kick' ? 0.25 : track === 'sub' ? 0.5 : 1
    hits.push({
      track,
      step,
      turn,
      velocity: clamp01(v),
      spiral,
      warp: ax.warp * lean,
      bend: ax.bend * lean,
      fold: ax.fold,
      grind: ax.grind,
      mass: ax.mass,
    })
  }
  return hits
}

/**
 * Swing: odd steps land late by up to half a step. Applied as a time offset
 * in seconds so the grid itself stays honest.
 */
export function swingOffset(step: number, swing: number, stepSeconds: number): number {
  return step % 2 === 1 ? swing * 0.5 * stepSeconds : 0
}

/** Factory patterns, one per kit character. Values are velocities. */
export function seedPattern(name: string, stepsPerTurn: number): Pattern {
  const p = emptyPattern(stepsPerTurn)
  const put = (t: TrackId, positions: number[], v = 0.9) => {
    for (const q of positions) {
      const i = Math.round((q / 16) * stepsPerTurn) % stepsPerTurn
      p[t][i] = v
    }
  }
  switch (name) {
    case 'chain': // four to the floor, off-beat stab, sparse ghost snare
      put('kick', [0, 4, 8, 12], 1)
      put('sub', [0, 8], 0.7)
      put('hat', [2, 6, 10, 14], 0.5)
      put('perc', [2, 10], 0.75)
      put('snare', [12], 0.4)
      put('air', [0], 0.5)
      break
    case 'dust': // boom-bap: kick on 1 and the and-of-3, snare on 2 and 4
      put('kick', [0, 7, 10], 1)
      put('snare', [4, 12], 0.95)
      put('hat', [0, 2, 4, 6, 8, 10, 12, 14], 0.45)
      put('perc', [15], 0.6)
      put('sub', [0, 10], 0.6)
      put('air', [0], 0.4)
      break
    case 'grain': // sparse, irregular: the cloud does the work
      put('kick', [0, 11], 0.85)
      put('snare', [6], 0.5)
      put('hat', [3, 5, 9, 13, 14], 0.4)
      put('perc', [1, 7, 12], 0.5)
      put('sub', [0], 0.55)
      put('air', [0, 8], 0.6)
      break
    default: // liquid: broken, syncopated, long tails
      put('kick', [0, 6], 0.95)
      put('snare', [4, 12], 0.6)
      put('hat', [2, 3, 7, 10, 11, 15], 0.4)
      put('perc', [9, 14], 0.6)
      put('sub', [0, 6], 0.7)
      put('air', [0], 0.6)
      break
  }
  return p
}
