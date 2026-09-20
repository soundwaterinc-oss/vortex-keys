import type { InstrumentState, Preset } from './types'
import { DEFAULT_VORTEX_PARAMS } from '../flow/vortex'
import { DEFAULT_WAVE_PARAMS, componentsFromRatios } from '../flow/wave'
import { defaultGates, type Gate } from '../flow/gates'
import { DEFAULT_MACROS } from '../../audio/models'
import { midiToHz } from '../tuning/tuning'
import { clamp, finite } from '../math/util'

const { gates: _g, ...vortexNoGates } = DEFAULT_VORTEX_PARAMS
void _g

export function defaultPreset(): Preset {
  return {
    version: 1,
    name: 'Init',
    tuning: { scaleId: 'penta-major', rootMidi: 48, rootHz: midiToHz(48), octaves: 4 },
    sound: { model: 'glass', macros: { ...DEFAULT_MACROS } },
    flow: {
      mode: 'vortex',
      amount: 0.6,
      vortex: { ...vortexNoGates },
      wave: { ...DEFAULT_WAVE_PARAMS, components: componentsFromRatios([3, 4, 5]) },
      gates: defaultGates(6),
      seed: 1234,
    },
    time: { bpm: 84, mode: 'free', quantize: '1/8' },
  }
}

export function defaultState(): InstrumentState {
  return { ...defaultPreset(), perf: { sustain: false, latch: false, frozen: false } }
}

function make(name: string, edit: (p: Preset) => void): Preset {
  const p = defaultPreset()
  p.name = name
  edit(p)
  return p
}

export const FACTORY_PRESETS: Preset[] = [
  make('Slow Glass Orbit', (p) => {
    p.tuning.scaleId = 'ji-major'
    p.sound.model = 'glass'
    p.sound.macros = { body: 0.6, air: 0.15, color: 0.35, decay: 0.8, space: 0.6, motion: 0.15 }
    p.flow.amount = 0.7
    p.flow.vortex = { ...p.flow.vortex, spin: 0.12, pull: 0.02, decay: 0.92, turbulence: 0.05, alpha: 0.8 }
    p.flow.gates = defaultGates(4, ['repeat', 'degreeUp', 'repeat', 'octaveUp'])
    p.time.bpm = 60
    p.time.mode = 'free'
  }),
  make('Golden Drift', (p) => {
    p.tuning.scaleId = 'unequal-5'
    p.sound.model = 'pluck'
    p.sound.macros = { body: 0.5, air: 0.3, color: 0.55, decay: 0.45, space: 0.4, motion: 0.3 }
    p.flow.mode = 'wave'
    p.flow.amount = 0.8
    p.flow.wave = { ...p.flow.wave, baseRate: 0.2, components: componentsFromRatios([1, (1 + Math.sqrt(5)) / 2]), threshold: 0.35, direction: 'both' }
    p.time.bpm = 96
  }),
  make('Tight Vortex', (p) => {
    p.tuning.scaleId = 'penta-minor'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.7, air: 0.35, color: 0.5, decay: 0.3, space: 0.2, motion: 0.1 }
    p.flow.amount = 0.9
    p.flow.vortex = { ...p.flow.vortex, spin: 0.5, pull: 0.09, decay: 0.8, turbulence: 0.15, alpha: 1.4 }
    p.flow.gates = defaultGates(8, ['repeat', 'degreeUp', 'velocityDown', 'degreeDown', 'repeat', 'spawnChild', 'octaveDown', 'degreeUp'])
    p.time.bpm = 118
    p.time.mode = 'soft'
    p.time.quantize = '1/16'
  }),
  make('Deep Microtonal Bell', (p) => {
    p.tuning.scaleId = 'ji-harmonic-8-16'
    p.tuning.rootMidi = 36
    p.tuning.rootHz = midiToHz(36)
    p.tuning.octaves = 4
    p.sound.model = 'glass'
    p.sound.macros = { body: 0.8, air: 0.1, color: 0.6, decay: 1.0, space: 0.75, motion: 0.1 }
    p.flow.amount = 0.5
    p.flow.vortex = { ...p.flow.vortex, spin: 0.08, pull: 0.015, decay: 0.95, turbulence: 0.02, alpha: 0.6 }
    p.flow.gates = defaultGates(3, ['repeat', 'octaveUp', 'degreeUp'])
    p.time.bpm = 52
  }),
  make('Interference 3:4:5', (p) => {
    p.tuning.scaleId = 'jp-in-approx'
    p.sound.model = 'breath'
    p.sound.macros = { body: 0.5, air: 0.5, color: 0.4, decay: 0.35, space: 0.5, motion: 0.25 }
    p.flow.mode = 'wave'
    p.flow.amount = 0.85
    p.flow.wave = { ...p.flow.wave, baseRate: 0.125, components: componentsFromRatios([3, 4, 5]), threshold: 0.45, direction: 'rising' }
    p.time.bpm = 90
  }),
  make('Rast Turbulence', (p) => {
    p.tuning.scaleId = 'maqam-rast-approx'
    p.sound.model = 'pad'
    p.sound.macros = { body: 0.5, air: 0.2, color: 0.45, decay: 0.6, space: 0.7, motion: 0.5 }
    p.flow.amount = 0.6
    p.flow.vortex = { ...p.flow.vortex, spin: 0.2, pull: 0.03, decay: 0.9, turbulence: 0.45, alpha: 1 }
    p.flow.gates = defaultGates(5, ['repeat', 'degreeUp', 'degreeDown', 'repeat', 'spawnChild'])
    p.time.bpm = 72
  }),
]

/** Validate/clamp a loaded preset so foreign JSON cannot inject NaN etc. */
export function sanitizePreset(raw: unknown): Preset {
  const base = defaultPreset()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Preset>
  const num = (v: unknown, lo: number, hi: number, d: number) => clamp(finite(Number(v), d), lo, hi)
  const p: Preset = {
    version: 1,
    name: typeof r.name === 'string' ? r.name.slice(0, 64) : base.name,
    tuning: {
      scaleId: typeof r.tuning?.scaleId === 'string' ? r.tuning.scaleId : base.tuning.scaleId,
      rootMidi: num(r.tuning?.rootMidi, 24, 84, base.tuning.rootMidi),
      rootHz: num(r.tuning?.rootHz, 20, 2000, base.tuning.rootHz),
      octaves: Math.round(num(r.tuning?.octaves, 1, 6, base.tuning.octaves)),
    },
    sound: {
      model: (['glass', 'pluck', 'wood', 'breath', 'pad'] as const).includes(r.sound?.model as never)
        ? (r.sound!.model as Preset['sound']['model'])
        : base.sound.model,
      macros: {
        body: num(r.sound?.macros?.body, 0, 1, 0.5),
        air: num(r.sound?.macros?.air, 0, 1, 0.2),
        color: num(r.sound?.macros?.color, 0, 1, 0.4),
        decay: num(r.sound?.macros?.decay, 0, 1, 0.5),
        space: num(r.sound?.macros?.space, 0, 1, 0.3),
        motion: num(r.sound?.macros?.motion, 0, 1, 0.2),
      },
    },
    flow: {
      mode: (['manual', 'vortex', 'wave'] as const).includes(r.flow?.mode as never) ? r.flow!.mode : base.flow.mode,
      amount: num(r.flow?.amount, 0, 1, base.flow.amount),
      vortex: {
        spin: num(r.flow?.vortex?.spin, 0, 2, base.flow.vortex.spin),
        pull: num(r.flow?.vortex?.pull, 0, 0.5, base.flow.vortex.pull),
        decay: num(r.flow?.vortex?.decay, 0.3, 1, base.flow.vortex.decay),
        turbulence: num(r.flow?.vortex?.turbulence, 0, 1, base.flow.vortex.turbulence),
        density: num(r.flow?.vortex?.density, 0, 1, base.flow.vortex.density),
        tempoInfluence: num(r.flow?.vortex?.tempoInfluence, 0, 1, base.flow.vortex.tempoInfluence),
        alpha: num(r.flow?.vortex?.alpha, 0, 2.5, base.flow.vortex.alpha),
        maxParticles: Math.round(num(r.flow?.vortex?.maxParticles, 1, 128, base.flow.vortex.maxParticles)),
        maxEventsPerSecond: Math.round(num(r.flow?.vortex?.maxEventsPerSecond, 1, 48, base.flow.vortex.maxEventsPerSecond)),
        maxAge: num(r.flow?.vortex?.maxAge, 1, 300, base.flow.vortex.maxAge),
        minEnergy: num(r.flow?.vortex?.minEnergy, 0.001, 0.5, base.flow.vortex.minEnergy),
        coreRadius: num(r.flow?.vortex?.coreRadius, 0.01, 0.5, base.flow.vortex.coreRadius),
      },
      wave: {
        baseRate: num(r.flow?.wave?.baseRate, 0.01, 4, base.flow.wave.baseRate),
        components: Array.isArray(r.flow?.wave?.components)
          ? r.flow!.wave!.components.slice(0, 5).map((c) => ({
              ratio: num(c?.ratio, 0.05, 32, 1),
              amplitude: num(c?.amplitude, 0, 1, 1),
              phase: num(c?.phase, 0, 1, 0),
            }))
          : base.flow.wave.components,
        threshold: num(r.flow?.wave?.threshold, 0, 0.99, base.flow.wave.threshold),
        direction: (['rising', 'falling', 'both'] as const).includes(r.flow?.wave?.direction as never)
          ? r.flow!.wave!.direction
          : base.flow.wave.direction,
        maxEventsPerSecond: Math.round(num(r.flow?.wave?.maxEventsPerSecond, 1, 48, base.flow.wave.maxEventsPerSecond)),
        poolSize: Math.round(num(r.flow?.wave?.poolSize, 1, 32, base.flow.wave.poolSize)),
      },
      gates: Array.isArray(r.flow?.gates)
        ? r.flow!.gates.slice(0, 16).map(
            (g, i): Gate => ({
              id: typeof g?.id === 'string' ? g.id : `g${i}`,
              angle: num(g?.angle, 0, Math.PI * 2, 0),
              action: typeof g?.action === 'string' ? (g.action as Gate['action']) : 'repeat',
              probability: num(g?.probability, 0, 1, 1),
              enabled: g?.enabled !== false,
            }),
          )
        : base.flow.gates,
      seed: Math.round(num(r.flow?.seed, 0, 4294967295, base.flow.seed)),
    },
    time: {
      bpm: num(r.time?.bpm, 20, 300, base.time.bpm),
      mode: (['free', 'soft', 'hard'] as const).includes(r.time?.mode as never) ? r.time!.mode : base.time.mode,
      quantize: (['1/4', '1/8', '1/16', '1/8T', '1/16T'] as const).includes(r.time?.quantize as never)
        ? r.time!.quantize
        : base.time.quantize,
    },
  }
  if (p.flow.wave.components.length < 2) p.flow.wave.components = base.flow.wave.components
  return p
}
