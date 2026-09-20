import type { FlowMode, InstrumentState, Preset } from './types'
import { DEFAULT_GRAVITY_PARAMS } from '../physics/gravity'
import { DEFAULT_ORBIT_PARAMS } from '../physics/orbit'
import { DEFAULT_WAVEFIELD_PARAMS } from '../physics/wavefield'
import { DEFAULT_COUPLED_PARAMS } from '../physics/coupled'
import { DEFAULT_CHAOS_PARAMS } from '../physics/chaos'
import { DEFAULT_MACROS_GLOBAL } from '../physics/types'
import { DEFAULT_LIMITS } from '../flow/physicsFlow'
import { defaultGates, GATE_ACTIONS, type Gate } from '../flow/gates'
import { DEFAULT_MACROS } from '../../audio/models'
import { MAPPING_PRESETS } from '../mapping/presets'
import { midiToHz } from '../tuning/tuning'
import { clamp, finite } from '../math/util'

const { gates: _g1, ...gravityNoGates } = DEFAULT_GRAVITY_PARAMS
const { gates: _g2, ...orbitNoGates } = DEFAULT_ORBIT_PARAMS
void _g1
void _g2

export function defaultPreset(): Preset {
  return {
    version: 2,
    name: 'Init',
    tuning: { scaleId: 'penta-major', rootMidi: 48, rootHz: midiToHz(48), octaves: 4 },
    sound: { model: 'glass', macros: { ...DEFAULT_MACROS } },
    flow: {
      mode: 'vortex',
      amount: 0.6,
      macros: { ...DEFAULT_MACROS_GLOBAL },
      mappingId: 'gravity-bass',
      vortex: { ...gravityNoGates },
      orbit: { ...orbitNoGates },
      wave: { ...DEFAULT_WAVEFIELD_PARAMS, ratios: [...DEFAULT_WAVEFIELD_PARAMS.ratios] },
      coupled: { ...DEFAULT_COUPLED_PARAMS },
      chaos: { ...DEFAULT_CHAOS_PARAMS },
      gates: defaultGates(6),
      seed: 1234,
      limits: { ...DEFAULT_LIMITS },
    },
    time: { bpm: 84, mode: 'free', quantize: '1/8' },
  }
}

export function defaultState(): InstrumentState {
  return { ...defaultPreset(), perf: { sustain: false, latch: false, frozen: false, monitor: false, advanced: false } }
}

function make(name: string, edit: (p: Preset) => void): Preset {
  const p = defaultPreset()
  p.name = name
  edit(p)
  return p
}

const PHI = (1 + Math.sqrt(5)) / 2

/** Factory presets: physics preset + mapping preset + sound, one per idea. */
export const FACTORY_PRESETS: Preset[] = [
  // ---- gravity ----
  make('Slow Glass Orbit', (p) => {
    p.tuning.scaleId = 'ji-major'
    p.sound.macros = { body: 0.6, air: 0.15, color: 0.35, decay: 0.8, space: 0.6, motion: 0.15 }
    p.flow.amount = 0.7
    p.flow.mappingId = 'accelerating-spiral'
    p.flow.vortex = { ...p.flow.vortex, spin: 0.12, pull: 0.02, decay: 0.92, turbulence: 0.05, alpha: 0.8 }
    p.flow.gates = defaultGates(4, ['repeat', 'degreeUp', 'repeat', 'octaveUp'])
    p.time.bpm = 60
  }),
  make('Tight Vortex', (p) => {
    p.tuning.scaleId = 'penta-minor'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.7, air: 0.35, color: 0.5, decay: 0.3, space: 0.2, motion: 0.1 }
    p.flow.amount = 0.9
    p.flow.mappingId = 'falling-into-center'
    p.flow.macros = { energy: 0.7, chaos: 0.3, time: 0.6, space: 0.5 }
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
    p.sound.macros = { body: 0.8, air: 0.1, color: 0.6, decay: 1.0, space: 0.75, motion: 0.1 }
    p.flow.amount = 0.5
    p.flow.mappingId = 'bright-core'
    p.flow.vortex = { ...p.flow.vortex, spin: 0.08, pull: 0.015, decay: 0.95, turbulence: 0.02, alpha: 0.6 }
    p.flow.gates = defaultGates(3, ['repeat', 'octaveUp', 'degreeUp'])
    p.time.bpm = 52
  }),
  make('Register Collapse', (p) => {
    p.tuning.scaleId = '19tet'
    p.sound.model = 'pluck'
    p.sound.macros = { body: 0.5, air: 0.25, color: 0.6, decay: 0.4, space: 0.4, motion: 0.2 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'register-collapse'
    p.flow.vortex = { ...p.flow.vortex, spin: 0.3, pull: 0.06, decay: 0.9, turbulence: 0.08, alpha: 1.6 }
    p.flow.gates = defaultGates(6, ['repeat'])
    p.time.bpm = 96
  }),
  // ---- orbit ----
  make('Elliptic Pulse', (p) => {
    p.flow.mode = 'orbit'
    p.tuning.scaleId = 'jp-yo-approx'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.6, air: 0.3, color: 0.5, decay: 0.35, space: 0.3, motion: 0.1 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'spectral-orbit'
    p.flow.orbit = { ...p.flow.orbit, eccentricity: 0.75, speed: 0.25, precession: 0, drift: 0.05, quadrantEvents: true }
    p.flow.gates = defaultGates(4, ['repeat'])
    p.time.bpm = 100
  }),
  make('Long Orbit', (p) => {
    p.flow.mode = 'orbit'
    p.tuning.scaleId = 'ji-major'
    p.sound.macros = { body: 0.6, air: 0.1, color: 0.3, decay: 0.9, space: 0.7, motion: 0.15 }
    p.flow.amount = 0.6
    p.flow.mappingId = 'gravity-bass'
    p.flow.orbit = { ...p.flow.orbit, orbitSize: 0.95, eccentricity: 0.4, speed: 0.06, precession: 0.005, drift: 0.02, energy: 0.97 }
    p.flow.gates = defaultGates(2, ['repeat', 'degreeUp'])
    p.time.bpm = 60
  }),
  make('Precessing Bell', (p) => {
    p.flow.mode = 'orbit'
    p.tuning.scaleId = 'ji-harmonic-8-16'
    p.sound.macros = { body: 0.7, air: 0.1, color: 0.5, decay: 0.9, space: 0.6, motion: 0.2 }
    p.flow.amount = 0.7
    p.flow.mappingId = 'spiral-melody'
    p.flow.orbit = { ...p.flow.orbit, eccentricity: 0.6, speed: 0.15, precession: 0.04, drift: 0.1 }
    p.flow.gates = defaultGates(5, ['repeat'])
    p.time.bpm = 72
  }),
  make('Binary Drift', (p) => {
    p.flow.mode = 'orbit'
    p.tuning.scaleId = 'unequal-7'
    p.sound.model = 'pad'
    p.sound.macros = { body: 0.5, air: 0.2, color: 0.4, decay: 0.6, space: 0.7, motion: 0.4 }
    p.flow.amount = 0.7
    p.flow.mappingId = 'gravity-bass'
    p.flow.macros = { energy: 0.5, chaos: 0.6, time: 0.4, space: 0.7 }
    p.flow.orbit = { ...p.flow.orbit, eccentricity: 0.5, speed: 0.12, precession: 0.02, drift: 0.4, maxOrbiters: 2 }
    p.flow.gates = defaultGates(3, ['repeat', 'degreeUp', 'degreeDown'])
    p.time.bpm = 66
  }),
  // ---- wave field ----
  make('Standing Ring', (p) => {
    p.flow.mode = 'wave'
    p.tuning.scaleId = 'penta-major'
    p.sound.model = 'breath'
    p.sound.macros = { body: 0.5, air: 0.5, color: 0.4, decay: 0.4, space: 0.5, motion: 0.25 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'spiral-melody'
    p.flow.wave = { ...p.flow.wave, sourceCount: 2, ratios: [1, 1], wavelength: 0.6, sourceRadius: 0.9, baseRate: 0.25, threshold: 0.5 }
    p.time.bpm = 80
  }),
  make('Interference 3:4:5', (p) => {
    p.flow.mode = 'wave'
    p.tuning.scaleId = 'jp-in-approx'
    p.sound.model = 'breath'
    p.sound.macros = { body: 0.5, air: 0.5, color: 0.4, decay: 0.35, space: 0.5, motion: 0.25 }
    p.flow.amount = 0.85
    p.flow.mappingId = 'gravity-bass'
    p.flow.wave = { ...p.flow.wave, sourceCount: 3, ratios: [3, 4, 5], baseRate: 0.125, threshold: 0.45 }
    p.time.bpm = 90
  }),
  make('Slow Beating', (p) => {
    p.flow.mode = 'wave'
    p.tuning.scaleId = 'ji-major'
    p.sound.model = 'pad'
    p.sound.macros = { body: 0.6, air: 0.2, color: 0.35, decay: 0.7, space: 0.7, motion: 0.3 }
    p.flow.amount = 0.7
    p.flow.mappingId = 'spiral-melody'
    p.flow.wave = { ...p.flow.wave, sourceCount: 2, ratios: [1, 1.05], wavelength: 1.2, baseRate: 0.5, threshold: 0.6 }
    p.time.bpm = 70
  }),
  make('Irrational Drift', (p) => {
    p.flow.mode = 'wave'
    p.tuning.scaleId = 'unequal-5'
    p.sound.model = 'pluck'
    p.sound.macros = { body: 0.5, air: 0.3, color: 0.55, decay: 0.45, space: 0.4, motion: 0.3 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'gravity-bass'
    p.flow.wave = { ...p.flow.wave, sourceCount: 3, ratios: [1, Math.SQRT2, PHI], wavelength: 0.7, baseRate: 0.2, threshold: 0.4 }
    p.time.bpm = 96
  }),
  make('Expanding Waves', (p) => {
    p.flow.mode = 'wave'
    p.tuning.scaleId = 'maqam-rast-approx'
    p.sound.macros = { body: 0.6, air: 0.15, color: 0.45, decay: 0.7, space: 0.6, motion: 0.2 }
    p.flow.amount = 0.75
    p.flow.mappingId = 'spiral-melody'
    p.flow.wave = { ...p.flow.wave, sourceCount: 1, ratios: [1], sourceRadius: 0, wavelength: 0.35, baseRate: 0.5, threshold: 0.55, expanding: 1 }
    p.time.bpm = 84
  }),
  // ---- coupled ----
  make('Loose Swarm', (p) => {
    p.flow.mode = 'coupled'
    p.tuning.scaleId = 'penta-minor'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.6, air: 0.3, color: 0.45, decay: 0.3, space: 0.35, motion: 0.15 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'swarm-pulse'
    p.flow.macros = { energy: 0.5, chaos: 0.8, time: 0.5, space: 0.7 }
    p.flow.coupled = { ...p.flow.coupled, count: 10, coupling: 0.15, spread: 0.35, drift: 0.1 }
    p.time.bpm = 100
  }),
  make('Gathering Pulse', (p) => {
    p.flow.mode = 'coupled'
    p.tuning.scaleId = 'jp-yo-approx'
    p.sound.model = 'pluck'
    p.sound.macros = { body: 0.5, air: 0.25, color: 0.5, decay: 0.4, space: 0.4, motion: 0.2 }
    p.flow.amount = 0.85
    p.flow.mappingId = 'swarm-pulse'
    p.flow.macros = { energy: 0.55, chaos: 0.35, time: 0.5, space: 0.5 }
    p.flow.coupled = { ...p.flow.coupled, count: 8, coupling: 0.7, spread: 0.3, drift: 0.02 }
    p.time.bpm = 96
  }),
  make('Near Synchrony', (p) => {
    p.flow.mode = 'coupled'
    p.tuning.scaleId = 'ji-major'
    p.sound.macros = { body: 0.6, air: 0.15, color: 0.5, decay: 0.5, space: 0.5, motion: 0.2 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'swarm-pulse'
    p.flow.macros = { energy: 0.5, chaos: 0.1, time: 0.5, space: 0.3 }
    p.flow.coupled = { ...p.flow.coupled, count: 12, coupling: 1.4, spread: 0.2, drift: 0, syncThreshold: 0.9 }
    p.time.bpm = 90
  }),
  make('Breathing Cluster', (p) => {
    p.flow.mode = 'coupled'
    p.tuning.scaleId = 'maqam-rast-approx'
    p.sound.model = 'breath'
    p.sound.macros = { body: 0.5, air: 0.55, color: 0.4, decay: 0.5, space: 0.6, motion: 0.3 }
    p.flow.amount = 0.7
    p.flow.mappingId = 'swarm-pulse'
    p.flow.macros = { energy: 0.4, chaos: 0.5, time: 0.35, space: 0.6 }
    p.flow.coupled = { ...p.flow.coupled, count: 6, coupling: 0.5, spread: 0.4, drift: 0.15, baseRate: 0.2 }
    p.time.bpm = 72
  }),
  // ---- chaos ----
  make('Edge of Chaos', (p) => {
    p.flow.mode = 'chaos'
    p.tuning.scaleId = 'penta-major'
    p.sound.model = 'pluck'
    p.sound.macros = { body: 0.5, air: 0.3, color: 0.55, decay: 0.4, space: 0.4, motion: 0.2 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'chaotic-melody'
    p.flow.macros = { energy: 0.5, chaos: 0.5, time: 0.5, space: 0.5 }
    p.flow.chaos = { ...p.flow.chaos, r: 3.57, updateRate: 3, smoothing: 0.4 }
    p.time.bpm = 96
  }),
  make('Stable Cycle', (p) => {
    p.flow.mode = 'chaos'
    p.tuning.scaleId = 'jp-yo-approx'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.6, air: 0.3, color: 0.45, decay: 0.3, space: 0.3, motion: 0.1 }
    p.flow.amount = 0.8
    p.flow.mappingId = 'chaotic-melody'
    p.flow.macros = { energy: 0.5, chaos: 0.1, time: 0.5, space: 0.4 }
    p.flow.chaos = { ...p.flow.chaos, r: 3.5, updateRate: 4, smoothing: 0.2 }
    p.time.bpm = 110
  }),
  make('Broken Symmetry', (p) => {
    p.flow.mode = 'chaos'
    p.tuning.scaleId = 'unequal-7'
    p.sound.macros = { body: 0.6, air: 0.15, color: 0.5, decay: 0.7, space: 0.55, motion: 0.2 }
    p.flow.amount = 0.75
    p.flow.mappingId = 'spiral-melody'
    p.flow.macros = { energy: 0.5, chaos: 0.7, time: 0.45, space: 0.5 }
    p.flow.chaos = { ...p.flow.chaos, r: 3.83, updateRate: 2, smoothing: 0.6, threshold: 0.45 }
    p.time.bpm = 84
  }),
  make('Dense Attractor', (p) => {
    p.flow.mode = 'chaos'
    p.tuning.scaleId = '12tet'
    p.sound.model = 'wood'
    p.sound.macros = { body: 0.7, air: 0.4, color: 0.5, decay: 0.25, space: 0.25, motion: 0.1 }
    p.flow.amount = 0.9
    p.flow.mappingId = 'chaotic-melody'
    p.flow.macros = { energy: 0.8, chaos: 0.9, time: 0.7, space: 0.5 }
    p.flow.chaos = { ...p.flow.chaos, r: 3.95, updateRate: 6, smoothing: 0.15, sensitivity: 1.5 }
    p.flow.limits = { maxEventsPerSecond: 16, maxEventsPerStep: 4 }
    p.time.bpm = 120
  }),
]

// ---------------------------------------------------------------- sanitize

type Range = [number, number]
const num = (v: unknown, lo: number, hi: number, d: number) => clamp(finite(Number(v), d), lo, hi)

/** Clamp every numeric field of `raw` into its range; keep booleans; default the rest. */
function sanitizeParams<T extends object>(raw: unknown, defaults: T, ranges: Partial<Record<keyof T, Range>>): T {
  const out = { ...defaults } as Record<string, unknown>
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  for (const k of Object.keys(defaults) as (keyof T & string)[]) {
    const d = defaults[k]
    const v = r[k]
    if (typeof d === 'number') {
      const rg = ranges[k] ?? [-1e9, 1e9]
      out[k] = num(v, rg[0], rg[1], d)
    } else if (typeof d === 'boolean') {
      out[k] = typeof v === 'boolean' ? v : d
    } else if (Array.isArray(d) && Array.isArray(v)) {
      out[k] = v.slice(0, 8).map((x) => num(x, 0.01, 64, 1))
    }
  }
  return out as T
}

export function sanitizePreset(raw: unknown): Preset {
  const base = defaultPreset()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Preset> & { flow?: Partial<Preset['flow']> & { vortex?: unknown } }
  const f = (r.flow ?? {}) as Partial<Preset['flow']>
  const p: Preset = {
    version: 2,
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
      macros: sanitizeParams(r.sound?.macros, base.sound.macros, { body: [0, 1], air: [0, 1], color: [0, 1], decay: [0, 1], space: [0, 1], motion: [0, 1] }),
    },
    flow: {
      mode: (['manual', 'vortex', 'orbit', 'wave', 'coupled', 'chaos'] as FlowMode[]).includes(f.mode as FlowMode) ? (f.mode as FlowMode) : base.flow.mode,
      amount: num(f.amount, 0, 1, base.flow.amount),
      macros: sanitizeParams(f.macros, base.flow.macros, { energy: [0, 1], chaos: [0, 1], time: [0, 1], space: [0, 1] }),
      mappingId: MAPPING_PRESETS.some((m) => m.id === f.mappingId) ? (f.mappingId as string) : base.flow.mappingId,
      vortex: sanitizeParams(f.vortex, base.flow.vortex, {
        spin: [0, 2],
        pull: [0, 0.5],
        alpha: [0, 2.5],
        decay: [0.3, 1],
        minRadius: [0.01, 0.5],
        energyLoss: [0, 0.5],
        turbulence: [0, 1],
        density: [0, 1],
        tempoInfluence: [0, 1],
        maxParticles: [1, 128],
        maxAge: [1, 300],
        minEnergy: [0.001, 0.5],
        maxChildrenPerParent: [0, 8],
        maxGeneration: [0, 6],
      }),
      orbit: sanitizeParams(f.orbit, base.flow.orbit, {
        orbitSize: [0.1, 1],
        eccentricity: [0, 0.95],
        precession: [-0.5, 0.5],
        speed: [0.01, 2],
        drift: [0, 1],
        energy: [0.3, 1],
        maxOrbiters: [1, 32],
        maxAge: [1, 600],
        minEnergy: [0.001, 0.5],
      }),
      wave: sanitizeParams(f.wave, base.flow.wave, {
        sourceCount: [1, 6],
        baseRate: [0.01, 4],
        wavelength: [0.05, 4],
        sourceRadius: [0, 1],
        sourceRotation: [0, 1],
        phaseSpread: [0, 1],
        amplitude: [0, 1],
        threshold: [0.02, 0.98],
        expanding: [-1, 1],
        maxProbes: [1, 16],
        nullLevel: [0, 0.3],
      }),
      coupled: sanitizeParams(f.coupled, base.flow.coupled, {
        count: [1, 16],
        coupling: [0, 4],
        spread: [0, 1],
        phaseSpread: [0, 1],
        drift: [0, 1],
        syncThreshold: [0.05, 0.99],
        baseRate: [0.01, 4],
        maxCount: [1, 16],
      }),
      chaos: sanitizeParams(f.chaos, base.flow.chaos, {
        r: [2.5, 4],
        x0: [0.01, 0.99],
        updateRate: [0.1, 32],
        smoothing: [0, 0.97],
        sensitivity: [0.1, 4],
        threshold: [0.02, 0.98],
        historyLength: [64, 1024],
      }),
      gates: Array.isArray(f.gates)
        ? (f.gates as Partial<Gate>[]).slice(0, 16).map(
            (g, i): Gate => ({
              id: typeof g?.id === 'string' ? g.id : `g${i}`,
              angle: num(g?.angle, 0, Math.PI * 2, 0),
              action: GATE_ACTIONS.includes(g?.action as Gate['action']) ? (g!.action as Gate['action']) : 'repeat',
              probability: num(g?.probability, 0, 1, 1),
              enabled: g?.enabled !== false,
            }),
          )
        : base.flow.gates,
      seed: Math.round(num(f.seed, 0, 4294967295, base.flow.seed)),
      limits: sanitizeParams(f.limits, base.flow.limits, { maxEventsPerSecond: [1, 64], maxEventsPerStep: [1, 16] }),
    },
    time: {
      bpm: num(r.time?.bpm, 20, 300, base.time.bpm),
      mode: (['free', 'soft', 'hard'] as const).includes(r.time?.mode as never) ? r.time!.mode : base.time.mode,
      quantize: (['1/4', '1/8', '1/16', '1/8T', '1/16T'] as const).includes(r.time?.quantize as never) ? r.time!.quantize : base.time.quantize,
    },
  }
  p.flow.wave.expanding = p.flow.wave.expanding < 0 ? -1 : 1
  if (!p.flow.wave.ratios.length) p.flow.wave.ratios = [...base.flow.wave.ratios]
  return p
}
