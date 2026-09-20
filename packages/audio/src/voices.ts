/**
 * Sound models: each maps the six musical macros to concrete voice
 * parameters. Adding a model = adding an entry to MODELS.
 *
 * Macro intent:
 *   BODY   weight of fundamental / low partial, filter floor
 *   AIR    noise component and high-frequency openness
 *   COLOR  FM index / inharmonicity / filter brightness
 *   DECAY  envelope length (attack scaled a little too)
 *   SPACE  send to delay+reverb (handled at the bus)
 *   MOTION LFO depth on pan, pitch and filter
 */
export type SoundModelId = 'glass' | 'pluck' | 'wood' | 'breath' | 'pad'

export interface Macros {
  body: number
  air: number
  color: number
  decay: number
  space: number
  motion: number
}

export const DEFAULT_MACROS: Macros = { body: 0.5, air: 0.2, color: 0.4, decay: 0.5, space: 0.35, motion: 0.2 }

export interface VoiceParams {
  carrierType: OscillatorType
  /** second oscillator: partial (added) or FM modulator */
  partialType: OscillatorType
  partialRatio: number
  partialGain: number
  /** FM modulation index in Hz per Hz of carrier (0 = none) */
  fmRatio: number
  fmIndex: number
  noiseGain: number
  noiseFilterHz: number
  noiseQ: number
  /** amplitude envelope (seconds) */
  attack: number
  decay: number
  sustain: number
  release: number
  /** filter */
  cutoffHz: number
  cutoffEnvHz: number
  filterQ: number
  /** LFO */
  lfoHz: number
  lfoPitchCents: number
  lfoFilterHz: number
  lfoPan: number
  /** overall voice level */
  level: number
}

export interface SoundModel {
  id: SoundModelId
  name: string
  voice(m: Macros, freq: number, velocity: number, brightness: number): VoiceParams
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** keep partials/filters below Nyquist-ish so high notes stay clean */
const cap = (hz: number) => Math.min(hz, 18000)

export const MODELS: Record<SoundModelId, SoundModel> = {
  glass: {
    id: 'glass',
    name: 'Glass / Bell',
    voice: (m, f, v, b) => ({
      carrierType: 'sine',
      partialType: 'sine',
      // inharmonic partial: 2.76 (bell-like). BODY pulls it toward 2.0 (rounder).
      partialRatio: lerp(2.0, 2.76, 1 - m.body * 0.6),
      partialGain: lerp(0.15, 0.45, m.color) * (0.6 + 0.4 * b),
      fmRatio: 3.5,
      fmIndex: lerp(0, 2.2, m.color) * (0.5 + 0.5 * v),
      noiseGain: m.air * 0.08,
      noiseFilterHz: cap(f * 6),
      noiseQ: 4,
      attack: 0.004,
      decay: lerp(0.6, 4.5, m.decay),
      sustain: 0.0,
      release: lerp(0.3, 3.0, m.decay),
      cutoffHz: cap(lerp(1500, 9000, m.color) + f * 2),
      cutoffEnvHz: 2000 * v,
      filterQ: 0.7,
      lfoHz: 0.25 + m.motion * 3,
      lfoPitchCents: m.motion * 6,
      lfoFilterHz: m.motion * 600,
      lfoPan: m.motion * 0.6,
      level: 0.55 * (0.7 + 0.3 * m.body),
    }),
  },
  pluck: {
    id: 'pluck',
    name: 'Pluck / String',
    voice: (m, f, v, b) => ({
      carrierType: 'sawtooth',
      partialType: 'triangle',
      partialRatio: 1.0,
      partialGain: 0.4 + 0.4 * m.body,
      fmRatio: 1,
      fmIndex: 0,
      noiseGain: 0.15 + m.air * 0.3, // attack "pick" noise, decays fast via envelope
      noiseFilterHz: cap(f * 4),
      noiseQ: 1.5,
      attack: 0.002,
      decay: lerp(0.25, 2.2, m.decay),
      sustain: 0.0,
      release: lerp(0.08, 0.6, m.decay),
      // COLOR opens the filter; brightness (energy/slope) opens it a bit more
      cutoffHz: cap(lerp(400, 3500, m.color) + f * (1 + 2 * b)),
      cutoffEnvHz: lerp(800, 5000, m.color) * v,
      filterQ: 1.5,
      lfoHz: 4 + m.motion * 2,
      lfoPitchCents: m.motion * 4,
      lfoFilterHz: m.motion * 300,
      lfoPan: m.motion * 0.4,
      level: 0.45,
    }),
  },
  wood: {
    id: 'wood',
    name: 'Wood / Mallet',
    voice: (m, f, v, b) => ({
      carrierType: 'sine',
      partialType: 'sine',
      partialRatio: lerp(3.0, 4.2, m.color),
      partialGain: 0.15 + 0.25 * m.color,
      fmRatio: 1.0,
      fmIndex: 0.3 * m.color,
      noiseGain: 0.3 + m.air * 0.4, // the "knock"
      noiseFilterHz: cap(lerp(600, 2400, m.body) + f * 0.5),
      noiseQ: 6,
      attack: 0.001,
      decay: lerp(0.08, 0.6, m.decay),
      sustain: 0,
      release: lerp(0.05, 0.4, m.decay),
      cutoffHz: cap(lerp(900, 4000, m.color) + f * (1 + b)),
      cutoffEnvHz: 1500 * v,
      filterQ: 2,
      lfoHz: 0.1,
      lfoPitchCents: 0,
      lfoFilterHz: 0,
      lfoPan: m.motion * 0.7,
      level: 0.6,
    }),
  },
  breath: {
    id: 'breath',
    name: 'Breath / Soft Reed',
    voice: (m, f, _v, b) => ({
      carrierType: 'triangle',
      partialType: 'square',
      partialRatio: 1.0,
      partialGain: 0.12 + 0.25 * m.color,
      fmRatio: 1,
      fmIndex: 0,
      noiseGain: 0.15 + m.air * 0.6,
      noiseFilterHz: cap(f * (1 + b * 0.5)),
      noiseQ: 12, // narrow band-passed noise centred on the pitch = breathy tone
      attack: lerp(0.06, 0.5, m.decay),
      decay: 0.4,
      sustain: 0.8,
      release: lerp(0.15, 1.5, m.decay),
      cutoffHz: cap(lerp(600, 3000, m.color) + f),
      cutoffEnvHz: 400,
      filterQ: 1,
      lfoHz: 4.5 + m.motion,
      lfoPitchCents: 2 + m.motion * 10,
      lfoFilterHz: m.motion * 400,
      lfoPan: m.motion * 0.3,
      level: 0.5 * (0.7 + 0.3 * m.body),
    }),
  },
  pad: {
    id: 'pad',
    name: 'Soft Pad',
    voice: (m, f, _v, b) => ({
      carrierType: 'sawtooth',
      partialType: 'sawtooth',
      // detune of the second saw expressed as a ratio; MOTION widens it
      partialRatio: 1 + (0.004 + 0.008 * m.motion),
      partialGain: 0.5 + 0.3 * m.body,
      fmRatio: 1,
      fmIndex: 0,
      noiseGain: m.air * 0.12,
      noiseFilterHz: cap(f * 8),
      noiseQ: 0.7,
      attack: lerp(0.3, 1.8, m.decay),
      decay: 1,
      sustain: 0.85,
      release: lerp(0.5, 4, m.decay),
      cutoffHz: cap(lerp(350, 2500, m.color) + f * (0.5 + b)),
      cutoffEnvHz: 300,
      filterQ: 0.9,
      lfoHz: 0.08 + m.motion * 0.5,
      lfoPitchCents: m.motion * 5,
      lfoFilterHz: 200 + m.motion * 900,
      lfoPan: 0.3 + m.motion * 0.6,
      level: 0.32,
    }),
  },
}

export const MODEL_IDS = Object.keys(MODELS) as SoundModelId[]
