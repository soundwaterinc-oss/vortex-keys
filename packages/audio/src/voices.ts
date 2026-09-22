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
 *   GEN    level of physics-generated notes relative to played ones
 *   SOFT   how much generated notes are softened (lower velocity → less
 *          bark / bell / click), so the field stays behind the hands
 */
export type SoundModelId = 'glass' | 'pluck' | 'wood' | 'breath' | 'pad' | 'hammond' | 'pipe' | 'voice' | 'rhodes'

export interface Macros {
  body: number
  air: number
  color: number
  decay: number
  space: number
  motion: number
  /** optional so engines that only use the six voice macros stay valid */
  gen?: number
  soft?: number
}

export const DEFAULT_MACROS: Macros = { body: 0.5, air: 0.2, color: 0.4, decay: 0.5, space: 0.35, motion: 0.2, gen: 0.7, soft: 0.5 }

/**
 * Harmonic table rendered as ONE PeriodicWave oscillator (cheap additive).
 * amps[k] is the amplitude of harmonic k+1 of a fundamental at f*baseRatio;
 * baseRatio 0.5 lets a table hold a sub-octave (16') and 5⅓' style quints.
 * detuneCents > 0 adds a second, detuned copy for ensemble chorus.
 */
export interface HarmonicSpec {
  baseRatio: number
  amps: number[]
  detuneCents?: number
}

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
  /**
   * extra steady oscillators summed into the filter (drawbars / pipe ranks).
   * ratio is relative to the fundamental; detuneCents gives ensemble chorus.
   */
  harmonics?: HarmonicSpec
  /** parallel band-pass bank after the filter (vowel formants) */
  formants?: { hz: number; q: number; gain: number }[]
  /**
   * force the noise to be a transient of this length (seconds) even on
   * sustaining models (key click, pipe chiff, consonant)
   */
  noiseDecay?: number
  /** amplitude LFO depth 0..1 (tremolo / Leslie-ish), shares lfoHz */
  lfoAmp?: number
}

export interface SoundModel {
  id: SoundModelId
  name: string
  voice(m: Macros, freq: number, velocity: number, brightness: number): VoiceParams
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** keep partials/filters below Nyquist-ish so high notes stay clean */
const cap = (hz: number) => Math.min(hz, 18000)

/**
 * Build a harmonic amplitude table from (harmonic, gain) pairs, dropping
 * anything that would land above ~17 kHz for this note. Gains are quantized
 * so the synth can cache one PeriodicWave per distinct table.
 */
function drawbars(f: number, pairs: [number, number][]): number[] {
  const amps: number[] = []
  for (const [h, g] of pairs) {
    if (f * 0.5 * h >= 17000 || g <= 0) continue
    amps[h - 1] = Math.round(g * 32) / 32
  }
  for (let i = 0; i < amps.length; i++) amps[i] ??= 0
  return amps
}

/** vowel formant table (F1 F2 F3, Hz), ordered for a continuous u→o→a→e→i sweep */
const VOWELS: [number, number, number][] = [
  [325, 700, 2530], // u
  [450, 800, 2830], // o
  [800, 1150, 2900], // a
  [400, 1600, 2700], // e
  [270, 2300, 3000], // i
]
/** interpolate formants along the vowel sweep, t in 0..1 */
export function vowel(t: number): { hz: number }[] {
  const x = Math.min(1, Math.max(0, t)) * (VOWELS.length - 1)
  const i = Math.min(VOWELS.length - 2, Math.floor(x))
  const k = x - i
  return VOWELS[i].map((a, j) => ({ hz: lerp(a, VOWELS[i + 1][j], k) }))
}

export const MODELS: Record<SoundModelId, SoundModel> = {
  glass: {
    id: 'glass',
    name: 'Glass / Bell',
    voice: (m, f, v, b) => ({
      carrierType: 'sine',
      partialType: 'sine',
      // inharmonic partial: 2.76 (bell-like). BODY pulls it toward 2.0 (rounder).
      partialRatio: lerp(2.0, 2.76, 1 - m.body * 0.6),
      partialGain: lerp(0.08, 0.28, m.color) * (0.6 + 0.4 * b),
      fmRatio: 3.5,
      fmIndex: lerp(0, 0.9, m.color) * (0.5 + 0.5 * v),
      noiseGain: m.air * 0.04,
      noiseFilterHz: cap(f * 6),
      noiseQ: 4,
      attack: 0.004,
      decay: lerp(0.6, 4.5, m.decay),
      sustain: 0.0,
      release: lerp(0.3, 3.0, m.decay),
      cutoffHz: cap(lerp(900, 4500, m.color) + f * 1.5),
      cutoffEnvHz: 2000 * v,
      filterQ: 0.7,
      lfoHz: 0.25 + m.motion * 3,
      lfoPitchCents: m.motion * 6,
      lfoFilterHz: m.motion * 600,
      lfoPan: m.motion * 0.6,
      level: 0.3 * (0.7 + 0.3 * m.body),
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
      cutoffHz: cap(lerp(350, 2800, m.color) + f * (1 + 1.5 * b)),
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
      level: 0.36,
    }),
  },
  hammond: {
    id: 'hammond',
    name: 'Hammond / Drawbar',
    // 9 drawbars as sines. BODY = 16'/8'/5⅓' weight, COLOR = upper drawbars,
    // AIR = key click, MOTION = scanner vibrato/chorus, DECAY = percussion tail.
    voice: (m, f, v, b) => {
      const lo = 0.5 + 0.5 * m.body
      const hi = lerp(0.05, 0.9, m.color) * (0.7 + 0.3 * b)
      return {
        carrierType: 'sine',
        partialType: 'sine',
        // percussion: 3rd harmonic ping that decays quickly (partial gain auto-fades)
        partialRatio: 3,
        partialGain: 0.15 * lerp(0.2, 1, m.decay) * (0.5 + 0.5 * v),
        fmRatio: 1,
        fmIndex: 0,
        noiseGain: 0.015 + m.air * 0.12,
        noiseFilterHz: 3200,
        noiseQ: 0.8,
        noiseDecay: 0.012,
        attack: 0.004,
        decay: 0.05,
        sustain: 1,
        release: 0.03,
        cutoffHz: cap(lerp(1800, 5500, m.color) + f * 2),
        cutoffEnvHz: 0,
        filterQ: 0.5,
        lfoHz: 6.2,
        lfoPitchCents: m.motion * 9,
        lfoFilterHz: 0,
        lfoPan: m.motion * 0.25,
        lfoAmp: m.motion * 0.35,
        level: 0.3,
        harmonics: {
          baseRatio: 0.5,
          amps: drawbars(f, [
            [1, 0.55 * lo], // 16'
            [3, 0.35 * lo], // 5⅓'
            [4, 0.7 * lerp(0.3, 1, m.color)], // 4'
            [6, 0.5 * hi], // 2⅔'
            [8, 0.45 * hi], // 2'
            [10, 0.3 * hi], // 1⅗'
            [12, 0.25 * hi], // 1⅓'
            [16, 0.35 * hi], // 1'
          ]),
        },
      }
    },
  },
  pipe: {
    id: 'pipe',
    name: 'Pipe Organ',
    // principal + flute + mixture ranks with slight ensemble detune.
    // BODY = 16' + 8' foundation, COLOR = upperwork/mixtures, AIR = chiff,
    // MOTION = tremulant, DECAY = speech (attack) and room release.
    voice: (m, f, v, b) => {
      const mix = lerp(0.05, 0.75, m.color) * (0.7 + 0.3 * b)
      return {
        carrierType: 'triangle',
        partialType: 'sawtooth',
        partialRatio: 1.002,
        partialGain: 0.18 + 0.2 * m.color,
        fmRatio: 1,
        fmIndex: 0,
        noiseGain: 0.04 + m.air * 0.25,
        noiseFilterHz: cap(f * 2.5),
        noiseQ: 3,
        noiseDecay: 0.05 + m.air * 0.06,
        attack: lerp(0.03, 0.14, m.decay),
        decay: 0.2,
        sustain: 1,
        release: lerp(0.12, 0.9, m.decay),
        cutoffHz: cap(lerp(1500, 5000, m.color) + f * 2.5),
        cutoffEnvHz: 0,
        filterQ: 0.4,
        lfoHz: 4.8,
        lfoPitchCents: m.motion * 6,
        lfoFilterHz: 0,
        lfoPan: m.motion * 0.4,
        lfoAmp: m.motion * 0.3,
        level: 0.26 * (0.8 + 0.2 * v),
        harmonics: {
          baseRatio: 0.5,
          detuneCents: 5,
          amps: drawbars(f, [
            [1, 0.5 * m.body], // 16'
            [2, 0.45], // 8' flute
            [4, 0.5 * lerp(0.4, 1, m.color)], // 4'
            [6, 0.35 * mix], // 2⅔'
            [8, 0.4 * mix], // 2'
            [12, 0.22 * mix], // mixture
            [16, 0.2 * mix],
          ]),
        },
      }
    },
  },
  voice: {
    id: 'voice',
    name: 'Voice / Choir',
    // glottal saw through a 3-formant bank. COLOR sweeps the vowel u→o→a→e→i,
    // AIR = breath, BODY = chest (formant Q / low weight), MOTION = vibrato.
    voice: (m, f, _v, b) => {
      const vow = vowel(m.color)
      const q = lerp(6, 14, m.body)
      return {
        carrierType: 'sawtooth',
        partialType: 'sawtooth',
        partialRatio: 1 + 0.006 * (0.5 + m.motion), // second singer, slightly off
        partialGain: 0.4,
        fmRatio: 1,
        fmIndex: 0,
        noiseGain: 0.03 + m.air * 0.25,
        noiseFilterHz: cap(vow[1].hz),
        noiseQ: 2,
        attack: lerp(0.05, 0.6, m.decay),
        decay: 0.3,
        sustain: 0.9,
        release: lerp(0.15, 1.6, m.decay),
        cutoffHz: cap(lerp(2000, 4500, m.body * 0.3 + b * 0.7)),
        cutoffEnvHz: 0,
        filterQ: 0.5,
        lfoHz: 5.2 + m.motion * 1.2,
        lfoPitchCents: 3 + m.motion * 18,
        lfoFilterHz: 0,
        lfoPan: m.motion * 0.45,
        level: 0.6,
        formants: vow.slice(0, 2).map((fm, i) => ({ hz: fm.hz, q, gain: [1, 0.55][i] })),
      }
    },
  },
  rhodes: {
    id: 'rhodes',
    name: 'Fender Rhodes',
    // tine = sine carrier + FM "bark" whose index follows velocity;
    // tone-bar overtone as a fast-decaying partial. BODY = fundamental weight,
    // COLOR = bark/brightness, AIR = hammer noise, MOTION = stereo tremolo.
    voice: (m, f, v, b) => ({
      carrierType: 'sine',
      partialType: 'sine',
      partialRatio: 4.0, // tine overtone (roughly a double octave, fades fast)
      partialGain: lerp(0.08, 0.25, m.color) * (0.3 + 0.7 * v),
      fmRatio: 1,
      fmIndex: lerp(0.1, 1.0, m.color) * Math.pow(v, 1.3) * (0.7 + 0.3 * b),
      noiseGain: 0.06 + m.air * 0.3,
      noiseFilterHz: cap(f * 3 + 800),
      noiseQ: 1.2,
      noiseDecay: 0.02,
      attack: 0.003,
      decay: lerp(1.2, 6, m.decay),
      sustain: 0,
      release: lerp(0.15, 0.8, m.decay),
      cutoffHz: cap(lerp(900, 4200, m.color) + f * 2),
      cutoffEnvHz: 2500 * v,
      filterQ: 0.6,
      lfoHz: 3.5 + m.motion * 3.5,
      lfoPitchCents: 0,
      lfoFilterHz: 0,
      lfoPan: m.motion * 0.9,
      lfoAmp: m.motion * 0.5,
      level: 0.6 * (0.7 + 0.3 * m.body),
    }),
  },
}

export const MODEL_IDS = Object.keys(MODELS) as SoundModelId[]
