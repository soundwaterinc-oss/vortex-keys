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
  seed: number
}

export const DEFAULT_SPIRAL: SpiralConfig = { stepsPerTurn: 16, turns: 4, drift: 0.35, rotate: 1, density: 0.85, seed: 7 }

/** A step that actually sounds, with everything a kit needs to voice it. */
export interface Hit {
  track: TrackId
  /** index within the turn */
  step: number
  turn: number
  velocity: number
  /** 0..1 position along the whole spiral — kits use it to morph timbre */
  spiral: number
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

/** Everything that sounds on one step of one turn. */
export function hitsAt(pattern: Pattern, step: number, turn: number, cfg: SpiralConfig): Hit[] {
  const hits: Hit[] = []
  const total = Math.max(1, cfg.stepsPerTurn * cfg.turns)
  const spiral = (turn * cfg.stepsPerTurn + step) / total
  for (const track of TRACKS) {
    const v = turnPattern(pattern[track], track, turn, cfg)[step]
    if (v <= 0) continue
    // density thins the spiral out without editing the pattern
    const gate = createPrng(cfg.seed * 31 + turn * 613 + step * 17 + TRACKS.indexOf(track)).next()
    if (gate > cfg.density) continue
    hits.push({ track, step, turn, velocity: clamp01(v), spiral })
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
