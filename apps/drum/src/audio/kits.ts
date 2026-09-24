import { createPrng, safeParam } from '@el-systema/core'
import type { Hit, TrackId } from '../engine/pattern'
import { bitCurve, foldCurve, impulse, knock, noiseBuffer, percEnv, pinkBuffer, saturationCurve, vinylBuffer } from './dsp'

/**
 * Four kits, four ideas of what a drum is.
 *
 *   chain   Basic Channel / Chain Reaction: a sine kick, a hiss, and a chord
 *           stab that exists mainly as its own reverb tail. Almost nothing
 *           is dry; the room is the instrument.
 *   dust    late-80s sampler hip-hop: 12-bit quantisation, a short room, tape
 *           saturation and a vinyl bed. Grit comes from bit depth, not EQ.
 *   grain   Jan Jelinek / clicks & cuts: every hit is a cloud of short grains
 *           read from a vinyl buffer at random offsets, plus micro-clicks.
 *           Rhythm is made of particles, not of drums.
 *   liquid  2026 electronica: pitch-gliding glass, swept formants, smeared
 *           transients, long wet tails. Clean, fluid, no grit at all.
 *
 * Every kit gets the same call: voice(hit, ctx, macros) and returns nothing —
 * it schedules itself on the audio clock and disposes on its own.
 */

export type KitId = 'chain' | 'dust' | 'grain' | 'liquid'
export const KIT_IDS: KitId[] = ['chain', 'dust', 'grain', 'liquid']

export interface KitMacros {
  /** overall tuning of the kit in semitones (-12..+12) */
  tune: number
  /** kit-specific colour: bit depth, grain density, saturation, formant openness */
  grit: number
  /** 0..1 — transient hardness: beater click, shorter body, harder saturation */
  punch: number
  /** 0..1 — mass: sub layer under every voice, drive, low-end lift */
  weight: number
  /** per-hit detune in cents, from the spiral's pitch axis */
  bend: number
  /** per-hit extra distortion 0..1, from the spiral's fold axis */
  fold: number
  /** per-hit grit 0..1, from the spiral's grind axis */
  grind: number
  /** per-hit sub-layer multiplier, from the spiral's mass axis */
  mass: number
  /** how long tails are (0..1) */
  decay: number
  /** send level to the shared delay/reverb (0..1) */
  space: number
  /** 0..1 — where the playhead is along the spiral; kits morph with it */
  spiral: number
}

export interface KitNodes {
  ctx: AudioContext
  /** dry destination for everything but the kick */
  out: AudioNode
  /** send destination (delay → reverb) */
  send: GainNode
  /**
   * Tempo-synced ping-pong delay. Unlike `send`, this is a rhythmic device
   * rather than a room: the taps land on the grid and alternate across the
   * stereo field, which is how a Monolake track's delays become part of the
   * pattern instead of a wash behind it.
   */
  echo: GainNode
  /**
   * The kick's own path: saturated, never sent to the room, and it ducks
   * everything else. Kicks go here so nothing smears the transient.
   */
  punch: AudioNode
}

/** Buffers and curves built once per context — never per hit. */
export class KitAssets {
  readonly noise: AudioBuffer
  readonly pink: AudioBuffer
  readonly vinyl: AudioBuffer
  readonly room: AudioBuffer
  readonly sat: Float32Array<ArrayBuffer>
  private bitCache = new Map<number, Float32Array<ArrayBuffer>>()
  private foldCache = new Map<string, Float32Array<ArrayBuffer>>()
  constructor(ctx: BaseAudioContext) {
    this.noise = noiseBuffer(ctx, 2)
    this.pink = pinkBuffer(ctx, 3)
    this.vinyl = vinylBuffer(ctx, 4)
    this.room = impulse(ctx, 0.6, 3.5)
    this.sat = saturationCurve(2.2)
  }
  /** wavefolder curves, quantised so a hit never builds a new table */
  fold(amount: number, grit = 0): Float32Array<ArrayBuffer> {
    const a = Math.round(Math.max(0, Math.min(1, amount)) * 8)
    const g = Math.round(Math.max(0, Math.min(1, grit)) * 8)
    const key = `${a}:${g}`
    let c = this.foldCache.get(key)
    if (!c) this.foldCache.set(key, (c = foldCurve(a / 8, g / 8)))
    return c
  }
  bits(b: number): Float32Array<ArrayBuffer> {
    const key = Math.round(b)
    let c = this.bitCache.get(key)
    if (!c) this.bitCache.set(key, (c = bitCurve(key)))
    return c
  }
}

export interface Kit {
  id: KitId
  name: string
  description: string
  /**
   * Output trim. The kits are built from different material (a sine kick, a
   * bit-crushed sample, a cloud of grains), so their natural levels differ by
   * a lot; this brings them to the same loudness at the bus.
   */
  trim: number
  /**
   * Kick trim. `trim` normalises each kit's body, but the kick has its own
   * bus, so it needs its own small correction — a bit-crushed kick and a
   * glassy one do not arrive with the same weight.
   */
  kickTrim: number
  /**
   * The kit's feel: a fixed offset per track in fractions of a step. This is
   * where a groove that refuses the grid lives — Dilla's snare arrives late
   * and his hats sit a hair early, and no amount of swing produces that,
   * because swing moves every odd step by the same amount.
   */
  timing?: Partial<Record<TrackId, number>>
  /**
   * 0..1 — how much the hits wander in time and level from one pass to the
   * next. Seeded, so a take still reproduces.
   */
  humanize?: number
  voice(hit: Hit, t: number, n: KitNodes, a: KitAssets, m: KitMacros): void
}

const semi = (s: number) => Math.pow(2, s / 12)
const cents = (c: number) => Math.pow(2, c / 1200)
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/**
 * The weight layer: a sine an octave under the voice, longer than it, with
 * its own slow decay. Every track gets one — that is what turns a kit from
 * a set of sounds into something with mass.
 */
function sub(ctx: AudioContext, t: number, hz: number, dest: AudioNode, level: number, decay: number) {
  if (level <= 0.002) return
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(safeParam(hz, 18, 400, 50), t)
  o.frequency.exponentialRampToValueAtTime(safeParam(hz * 0.86, 18, 400, 45), t + decay * 0.8)
  const g = percEnv(ctx, t, { attack: 0.004, decay, peak: level, curve: 2.2 })
  o.connect(g).connect(dest)
  o.start(t)
  o.stop(t + decay * 3 + 0.1)
}

/**
 * A per-hit wavefolder, driven by the spiral's fold axis and bitten by its
 * grind axis. One node, so a voice's graph stays cheap however deep the grit.
 */
function folder(ctx: AudioContext, a: KitAssets, amount: number, grit = 0): WaveShaperNode {
  const w = ctx.createWaveShaper()
  w.curve = a.fold(amount, grit)
  w.oversample = '2x'
  return w
}

/** Connect a node to dry + send in one call; `amount` scales the send. */
function fan(src: AudioNode, n: KitNodes, amount: number) {
  src.connect(n.out)
  if (amount > 0.001) {
    const g = n.ctx.createGain()
    g.gain.value = safeParam(amount, 0, 1.5, 0.2)
    src.connect(g).connect(n.send)
  }
}

/** A tuned sine/triangle body with a pitch drop — the core of every kick. */
function body(ctx: AudioContext, t: number, from: number, to: number, dur: number, type: OscillatorType = 'sine'): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(safeParam(from, 20, 4000, 120), t)
  o.frequency.exponentialRampToValueAtTime(safeParam(to, 18, 4000, 45), t + Math.max(0.01, dur))
  return o
}

function source(ctx: AudioContext, buf: AudioBuffer, t: number, offset = 0, rate = 1, loop = false): AudioBufferSourceNode {
  const s = ctx.createBufferSource()
  s.buffer = buf
  s.loop = loop
  s.playbackRate.value = safeParam(rate, 0.05, 8, 1)
  s.start(t, Math.min(offset, Math.max(0, buf.duration - 0.05)))
  return s
}

/** A single very short impulse: the smallest event that still has a pitch. */
function click(ctx: AudioContext, t: number, dest: AudioNode, level: number, hz: number, q = 12, len = 0.004) {
  const o = ctx.createOscillator()
  o.type = 'square'
  o.frequency.value = safeParam(hz, 40, 18000, 2000)
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = safeParam(hz, 40, 18000, 2000)
  f.Q.value = q
  const g = percEnv(ctx, t, { attack: 0.0002, decay: len, peak: level, curve: 6 })
  o.connect(f).connect(g).connect(dest)
  o.start(t)
  o.stop(t + len * 6 + 0.01)
}

/**
 * A struck membrane: a pitched head that drops fast, a slap of band-passed
 * noise, and a body that rings low. This is a hand drum rather than a
 * machine — the tuning moves from hit to hit and the slap is what carries
 * the rhythm, not a transient click.
 */
function membrane(
  ctx: AudioContext,
  t: number,
  dest: AudioNode,
  a: KitAssets,
  o: { hz: number; slap: number; decay: number; level: number; damp: number },
) {
  const o1 = body(ctx, t, o.hz * 1.8, o.hz, 0.035, 'triangle')
  const g = percEnv(ctx, t, { attack: 0.0015, decay: o.decay, peak: o.level, curve: 3 })
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = safeParam(o.damp, 200, 9000, 1800)
  o1.connect(g).connect(lp).connect(dest)
  o1.stop(t + o.decay * 3 + 0.1)

  if (o.slap > 0.002) {
    // the hand: a dark band of noise, gone in twenty milliseconds
    const s = ctx.createBufferSource()
    s.buffer = a.noise
    s.start(t, 0.3 + (o.hz % 7) * 0.05)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = safeParam(o.hz * 4.5, 120, 6000, 900)
    bp.Q.value = 1.4
    const sg = percEnv(ctx, t, { attack: 0.0006, decay: 0.018, peak: o.slap, curve: 4 })
    s.connect(bp).connect(sg).connect(dest)
    s.stop(t + 0.12)
  }
}

// ───────────────────── CHAIN · after Azu Tiwaline ─────────────────────
/**
 * Desert dub rather than Berlin dub: the weight is in skin and earth, not
 * in metal. Hand drums carry the rhythm, the bass is long and filtered, the
 * delay is dark and smeared, and the top is sand rather than hi-hat. Nothing
 * up there is bright on purpose — the air in this kit is dust in the wind.
 */
const chain: Kit = {
  id: 'chain',
  kickTrim: 1.0,
  trim: 2.4,
  name: 'CHAIN / Azu Tiwaline',
  description: 'After Azu Tiwaline: desert dub — hand drums and skin instead of metal, a long filtered bass, dark smeared delay, sand in the top.',
  humanize: 0.3,
  timing: { perc: 0.05, hat: -0.02 },
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.6, 1.8, m.decay)
    const w = m.weight * m.mass
    // the drums retune slowly as the spiral turns, the way a skin does
    const skin = 1 + 0.05 * Math.sin(m.spiral * Math.PI * 2)
    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, lerp(115, 175, m.punch) * tune, 47 * tune, lerp(0.055, 0.03, m.punch))
        const g = percEnv(ctx, t, { attack: 0.002, decay: lerp(0.33, 0.2, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.2 })
        const fd = folder(ctx, a, m.fold * 0.35, m.grind * 0.4)
        o.connect(g).connect(fd).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.09 * m.punch * h.velocity, tone: 900, decay: 0.008, cutoff: 1800 })
        sub(ctx, t, 29 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.22, 0.6, w) * dec)
        o.stop(t + 0.95 * dec)
        break
      }
      case 'sub': {
        // the long bass: a filter opens across the note rather than an attack
        const o = body(ctx, t, 58 * tune, 36 * tune, 0.3)
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(safeParam(90, 40, 4000, 90), t)
        lp.frequency.exponentialRampToValueAtTime(safeParam(lerp(180, 520, m.grit), 60, 4000, 300), t + 0.25 * dec)
        lp.Q.value = 3
        const g = percEnv(ctx, t, { attack: 0.012, decay: lerp(0.8, 1.6, w) * dec, peak: (0.55 + 0.45 * w) * h.velocity, curve: 1.7 })
        o.connect(lp).connect(g)
        fan(g, n, m.space * 0.25)
        const e = ctx.createGain()
        e.gain.value = m.space * 0.2
        g.connect(e).connect(n.echo)
        sub(ctx, t, 29 * tune, n.punch, 0.3 * w * h.velocity, 0.5 * dec)
        o.stop(t + 3.5 * dec)
        break
      }
      case 'snare': {
        // a dark rim and a skin: no snare wires, nothing above 3 kHz
        membrane(ctx, t, n.out, a, {
          hz: 178 * tune * skin,
          slap: 0.2 * h.velocity,
          decay: lerp(0.12, 0.22, w) * dec,
          level: (0.4 + 0.25 * w) * h.velocity,
          damp: lerp(1900, 3600, m.grit),
        })
        const e = ctx.createGain()
        e.gain.value = 0.3 + 0.45 * m.space
        membrane(ctx, t, e, a, { hz: 178 * tune * skin, slap: 0.12 * h.velocity, decay: 0.1 * dec, level: 0.2 * h.velocity, damp: 1600 })
        e.connect(n.echo)
        sub(ctx, t, 59 * tune, n.out, 0.18 * w * h.velocity, 0.2 * dec)
        break
      }
      case 'hat': {
        // sand, not metal: a short band of noise low enough to stay warm
        const s = source(ctx, a.pink, t, 0.4 + h.step * 0.019, lerp(1, 1.5, m.grit))
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = lerp(3000, 5600, m.grit)
        f.Q.value = lerp(1.2, 0.6, w)
        const g = percEnv(ctx, t, { attack: 0.0008, decay: lerp(0.035, 0.07, w), peak: (0.22 + 0.1 * w) * h.velocity, curve: 3.5 })
        s.connect(f).connect(g)
        fan(g, n, m.space * 0.3)
        s.stop(t + 0.3)
        break
      }
      case 'perc': {
        // the hand drum that carries the rhythm — two strokes, dark and tuned
        const hz = (h.step % 3 === 0 ? 118 : 156) * tune * skin
        membrane(ctx, t, n.out, a, {
          hz,
          slap: 0.3 * h.velocity,
          decay: lerp(0.16, 0.34, m.decay) * dec,
          level: (0.5 + 0.2 * w) * h.velocity,
          damp: lerp(1600, 3400, m.grit),
        })
        const e = ctx.createGain()
        e.gain.value = 0.45 + 0.6 * m.space
        membrane(ctx, t, e, a, { hz, slap: 0.14 * h.velocity, decay: 0.14 * dec, level: 0.28 * h.velocity, damp: 1500 })
        e.connect(n.echo)
        sub(ctx, t, hz * 0.25, n.out, 0.22 * w * h.velocity, 0.3 * dec)
        break
      }
      case 'air': {
        // wind over sand: low noise moving slowly across the field
        const s = source(ctx, a.pink, t, (h.turn * 0.37) % 2, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.setValueAtTime(safeParam(lerp(900, 300, w), 120, 4000, 500), t)
        f.frequency.exponentialRampToValueAtTime(safeParam(lerp(400, 180, w), 100, 4000, 260), t + 1.2 * dec)
        f.Q.value = 0.9
        const g = percEnv(ctx, t, { attack: 0.3, decay: 1.1 * dec, peak: (0.07 + 0.1 * w) * h.velocity, curve: 1.7 })
        const pan = ctx.createStereoPanner()
        pan.pan.value = Math.sin(m.spiral * Math.PI * 2) * 0.7
        s.connect(f).connect(g).connect(pan)
        fan(pan, n, 0.2 + m.space * 0.5)
        s.stop(t + 3.5 * dec)
        break
      }
    }
  },
}

// ───────────────────────── DUST · after J Dilla ─────────────────────────
/**
 * The feel is the instrument here. Dilla's drums are not quantised: the
 * snare lands late enough to be wrong on paper, the hats sit a hair early,
 * and the velocities never repeat — the groove comes from that argument
 * between the parts, not from swing. The sound is the MPC behind it: fat,
 * filtered, dusty, more low-mid than top.
 */
const dust: Kit = {
  id: 'dust',
  kickTrim: 1.4,
  trim: 1.15,
  name: 'DUST / J Dilla',
  description: 'After Dilla: the snare drags behind the beat, the hats lean early, nothing repeats its velocity. Fat, filtered, dusty.',
  // the famous drunk feel, in fractions of a step
  timing: { snare: 0.16, hat: -0.045, perc: 0.09, sub: 0.03 },
  humanize: 0.55,
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.6, 1.5, m.decay)
    const w = m.weight * m.mass
    // GRIT = bit depth, gently: the dust is in the filter more than the bits
    const crush = ctx.createWaveShaper()
    crush.curve = a.bits(Math.round(lerp(13, 8, m.grit)))
    const sat = ctx.createWaveShaper()
    sat.curve = a.sat
    // the sampler's ceiling: everything is low-passed, always
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = lerp(5200, 2400, m.grit)
    lp.Q.value = 0.8
    const room = ctx.createConvolver()
    room.buffer = a.room
    const roomG = ctx.createGain()
    roomG.gain.value = lerp(0.06, 0.22, m.space)
    const fd = folder(ctx, a, m.fold * 0.6, m.grind * 0.7)
    crush.connect(sat)
    sat.connect(lp).connect(fd)
    fd.connect(room).connect(roomG)
    fan(fd, n, m.space * 0.2)
    roomG.connect(n.out)

    switch (h.track) {
      case 'kick': {
        // fat and round: a slower drop and a softer beater than a techno kick
        const o = body(ctx, t, lerp(130, 185, m.punch) * tune, 54 * tune, lerp(0.055, 0.03, m.punch), 'triangle')
        const g = percEnv(ctx, t, { attack: 0.0015, decay: lerp(0.3, 0.19, m.punch) * dec, peak: 1.05 * h.velocity, curve: 3.4 })
        const kickLP = ctx.createBiquadFilter()
        kickLP.type = 'lowpass'
        kickLP.frequency.value = lerp(2400, 900, m.grit)
        const kickCrush = ctx.createWaveShaper()
        kickCrush.curve = a.bits(Math.round(lerp(13, 8, m.grit)))
        const kickSat = ctx.createWaveShaper()
        kickSat.curve = a.sat
        kickCrush.connect(kickSat).connect(kickLP).connect(n.punch)
        o.connect(g).connect(kickCrush)
        knock(ctx, t, kickCrush, a.noise, { level: 0.18 * m.punch * h.velocity, tone: 1500, decay: 0.01, cutoff: 3000, offset: 0.11 })
        sub(ctx, t, 34 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.22, 0.6, w) * dec)
        o.stop(t + 0.8 * dec)
        break
      }
      case 'sub': {
        // the bass note, fretted and slightly behind the kick
        const o = body(ctx, t, 66 * tune, 41 * tune, 0.18)
        const g = percEnv(ctx, t, { attack: 0.012, decay: lerp(0.42, 0.95, w) * dec, peak: (0.55 + 0.35 * w) * h.velocity, curve: 2.2 })
        o.connect(g).connect(crush)
        sub(ctx, t, 33 * tune, n.punch, 0.3 * w * h.velocity, 0.45 * dec)
        o.stop(t + 2.2 * dec)
        break
      }
      case 'snare': {
        // A rimshot off an old record: stick on rim, then the shell. There
        // are no snare wires here — what used to be a broadband skin is now
        // a woody crack around 1.8 kHz, gone in fifteen milliseconds, and
        // the length comes from a low tuned shell under it.
        const crack = source(ctx, a.noise, t, 0.05 + h.step * 0.02)
        const woody = ctx.createBiquadFilter()
        woody.type = 'bandpass'
        woody.frequency.setValueAtTime(safeParam(lerp(1500, 2300, m.grit), 400, 6000, 1800), t)
        woody.frequency.exponentialRampToValueAtTime(safeParam(lerp(900, 1400, m.grit), 300, 6000, 1100), t + 0.03)
        woody.Q.value = 2.6
        const cg = percEnv(ctx, t, { attack: 0.0006, decay: 0.014, peak: 0.5 * h.velocity, curve: 4.5 })
        crack.connect(woody).connect(cg).connect(crush)
        crack.stop(t + 0.12)

        // the shell: low, slightly detuned pair so it beats the way wood does
        for (const [ratio, lvl, det] of [[1, 1, 0], [1.42, 0.35, 4]] as const) {
          const o = body(ctx, t, 152 * tune * ratio, 118 * tune * ratio, 0.05, 'triangle')
          o.detune.value = det
          const og = percEnv(ctx, t, {
            attack: 0.0012,
            decay: lerp(0.16, 0.3, w) * dec * (ratio > 1 ? 0.6 : 1),
            peak: (0.5 + 0.4 * w) * lvl * h.velocity,
            curve: 2.6,
          })
          o.connect(og).connect(crush)
          o.stop(t + 1 * dec)
        }
        // a hair of skin rattle, well under the wood
        const rattle = source(ctx, a.noise, t + 0.004, 0.3 + h.step * 0.01)
        const rf = ctx.createBiquadFilter()
        rf.type = 'bandpass'
        rf.frequency.value = safeParam(lerp(2600, 3600, m.grit), 800, 8000, 3000)
        rf.Q.value = 1.2
        const rg = percEnv(ctx, t + 0.004, { attack: 0.001, decay: 0.05 * dec, peak: 0.12 * h.velocity, curve: 3 })
        rattle.connect(rf).connect(rg).connect(crush)
        rattle.stop(t + 0.4)

        sub(ctx, t, 76 * tune, n.out, 0.2 * w * h.velocity, 0.24 * dec)
        break
      }
      case 'hat': {
        const s = source(ctx, a.noise, t, 0.5 + h.step * 0.017, lerp(1, 1.5, m.grit))
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.Q.value = lerp(1.8, 0.8, w)
        f.frequency.value = lerp(6200, 3200, w)
        // the open hat lands where a hand would open it, not on a rule
        const open = (h.step % 8 === 6 ? 0.1 : 0.035) * lerp(1, 1.7, w)
        const g = percEnv(ctx, t, { attack: 0.0006, decay: open * dec, peak: 0.18 * h.velocity })
        s.connect(f).connect(g).connect(crush)
        s.stop(t + 0.5)
        break
      }
      case 'perc': {
        const o = body(ctx, t, 900 * tune, 560 * tune, 0.03, 'square')
        const g = percEnv(ctx, t, { attack: 0.0005, decay: lerp(0.05, 0.11, w) * dec, peak: (0.3 + 0.24 * w) * h.velocity, curve: 4 })
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 1500 * tune
        f.Q.value = 3
        o.connect(f).connect(g).connect(crush)
        sub(ctx, t, 112 * tune, n.out, 0.15 * w * h.velocity, 0.1 * dec)
        o.stop(t + 0.3)
        break
      }
      case 'air': {
        const s = source(ctx, a.vinyl, t, (h.turn * 0.73) % 3, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = lerp(4500, 1100, Math.max(m.grit, w))
        const g = percEnv(ctx, t, { attack: 0.1, decay: 0.7 * dec, peak: (0.09 + 0.07 * w) * h.velocity, curve: 1.8 })
        s.connect(f).connect(g).connect(sat)
        s.stop(t + 5 * dec)
        break
      }
    }
  },
}

/**
 * One hit = a cloud. Grains are short windows read from the vinyl buffer at
 * random offsets, each with its own pitch and pan; the "drum" is only the
 * cloud's envelope and centre frequency. Every grain gets a triangular
 * window, so however dense the cloud gets it never clicks.
 */
function cloud(
  ctx: AudioContext,
  a: KitAssets,
  t: number,
  dest: AudioNode,
  o: { count: number; spread: number; grain: number; rate: number; centre: number; q: number; peak: number; decay: number; seed: number },
) {
  const rnd = createPrng(o.seed)
  // A grain is four nodes, and at fine settings a single hit can ask for
  // more than a hundred of them; past this the texture stops getting finer
  // and only gets more expensive.
  const count = Math.min(64, o.count)
  for (let i = 0; i < count; i++) {
    const at = t + rnd.next() * o.spread
    const dur = o.grain * (0.5 + rnd.next())
    const s = ctx.createBufferSource()
    s.buffer = a.vinyl
    s.playbackRate.value = safeParam(o.rate * (1 + rnd.signed() * 0.35), 0.05, 6, 1)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = safeParam(o.centre * (1 + rnd.signed() * 0.5), 40, 16000, 800)
    f.Q.value = o.q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    const peak = o.peak * (0.4 + 0.6 * rnd.next()) * Math.pow(1 - i / count, o.decay)
    g.gain.linearRampToValueAtTime(peak, at + dur * 0.4)
    g.gain.linearRampToValueAtTime(0, at + dur)
    const pan = ctx.createStereoPanner()
    pan.pan.value = rnd.signed() * 0.85
    s.connect(f).connect(g).connect(pan).connect(dest)
    s.start(at, rnd.next() * Math.max(0.1, a.vinyl.duration - dur - 0.05), dur + 0.02)
  }
}

// ───────────────────────── GRAIN · after Jan Jelinek ─────────────────────────
/**
 * Jelinek takes a few seconds of a record and loops the part that was never
 * the music — the haze between the notes — until it becomes the music. So
 * this kit is warm and muted rather than clicky: grains are long, low-passed
 * and overlapping, and the percussion is what is left when you filter a loop
 * hard enough that only its shape survives.
 */
const grain: Kit = {
  id: 'grain',
  kickTrim: 1.45,
  trim: 7.6,
  name: 'GRAIN / Jan Jelinek',
  description: 'After Jelinek: very fine grains cut from a record — a few milliseconds each, many of them — micro-clicks, and a hard kick standing under the dust.',
  humanize: 0.25,
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.7, 2.0, m.decay)
    const w = m.weight * m.mass
    const density = Math.round(lerp(10, 52, m.grit))
    const seed = h.turn * 7717 + h.step * 131 + (['kick', 'sub', 'snare', 'hat', 'perc', 'air'] as TrackId[]).indexOf(h.track)
    const bus = ctx.createGain()
    bus.gain.value = h.velocity
    // the haze: everything in this kit passes a gentle low-pass, so no grain
    // ever arrives as a click
    const haze = ctx.createBiquadFilter()
    haze.type = 'lowpass'
    haze.frequency.value = lerp(5200, 11000, m.grit)
    haze.Q.value = 0.5
    const fd = folder(ctx, a, m.fold * 0.45, m.grind * 0.4)
    bus.connect(haze).connect(fd)
    fan(fd, n, 0.3 + m.space * 0.8)

    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, lerp(135, 200, m.punch) * tune, 48 * tune, lerp(0.05, 0.026, m.punch))
        const g = percEnv(ctx, t, { attack: 0.0012, decay: lerp(0.32, 0.18, m.punch) * dec, peak: 1.2 * h.velocity, curve: 3.8 })
        o.connect(g).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.28 * m.punch * h.velocity, tone: 1450, decay: 0.006, cutoff: 3400 })
        sub(ctx, t, 31 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.2, 0.58, w) * dec)
        o.stop(t + 0.9 * dec)
        cloud(ctx, a, t + 0.004, bus, { count: Math.max(6, density >> 1), spread: 0.035, grain: 0.009, rate: 0.5, centre: 280, q: 1.8, peak: 0.16, decay: 2.2, seed })
        break
      }
      case 'sub': {
        const o = body(ctx, t, 58 * tune, 37 * tune, 0.28)
        const g = percEnv(ctx, t, { attack: 0.015, decay: lerp(0.8, 1.5, w) * dec, peak: 0.45 + 0.4 * w, curve: 1.9 })
        o.connect(g).connect(bus)
        sub(ctx, t, 29 * tune, n.punch, 0.3 * w * h.velocity, 0.5 * dec)
        o.stop(t + 3 * dec)
        break
      }
      case 'snare':
        // long overlapping grains, not a burst: the hit is the envelope
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.07 * dec, grain: lerp(0.006, 0.016, w), rate: lerp(1.5, 0.9, w), centre: lerp(2200, 1000, w), q: 3.2, peak: 0.26 + 0.13 * w, decay: 1.9, seed })
        sub(ctx, t, 62 * tune, n.out, 0.15 * w * h.velocity, 0.24 * dec)
        break
      case 'hat':
        cloud(ctx, a, t, bus, { count: Math.max(5, Math.round(density * 0.7)), spread: 0.018, grain: lerp(0.0035, 0.008, w), rate: lerp(2.8, 1.6, w), centre: lerp(8000, 4200, w), q: 5, peak: 0.17 + 0.09 * w, decay: 2.4, seed })
        break
      case 'perc': {
        // the click first — a single impulse through a narrow band — and the
        // loop fragment behind it
        const s2 = source(ctx, a.noise, t, 0.2 + h.step * 0.03)
        const bp2 = ctx.createBiquadFilter()
        bp2.type = 'bandpass'
        bp2.frequency.value = safeParam(lerp(900, 5200, (h.spiral * 3) % 1), 200, 9000, 1500)
        bp2.Q.value = 16
        const cg = percEnv(ctx, t, { attack: 0.0003, decay: 0.02 * dec, peak: 0.42, curve: 5 })
        s2.connect(bp2).connect(cg).connect(bus)
        s2.stop(t + 0.2)
        const s3 = source(ctx, a.vinyl, t + 0.006, ((h.turn * 0.37 + h.step * 0.11) % 3) + 0.2, lerp(0.85, 1.15, m.grit))
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = safeParam(lerp(700, 2600, (h.spiral * 3) % 1), 150, 7000, 1100)
        bp.Q.value = 3
        const g = percEnv(ctx, t + 0.006, { attack: 0.004, decay: 0.08 * dec, peak: 0.3, curve: 3 })
        s3.connect(bp).connect(g).connect(bus)
        s3.stop(t + 0.4 * dec)
        cloud(ctx, a, t + 0.01, bus, { count: 10, spread: 0.1 * dec, grain: 0.012, rate: 0.9, centre: 1400, q: 2.2, peak: 0.12, decay: 1.2, seed: seed + 1 })
        break
      }
      case 'air':
        // the haze the record was carrying all along
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.8 * dec, grain: lerp(0.014, 0.035, w), rate: lerp(0.7, 0.4, w), centre: lerp(1100, 400, w), q: 1.4, peak: 0.08 + 0.08 * w, decay: 0.7, seed: seed + 9 })
        break
    }
  },
}

// ───────────────────────── PULSE · after Ryoji Ikeda ─────────────────────────
/**
 * Ikeda's material is the test signal itself: pure sine tones at the edges
 * of hearing, single-sample impulses, gated noise, and silence used as an
 * event. Nothing is smeared, nothing is warmed — a hit either exists at full
 * scale or does not exist. The only weight is a sine, and it is exact.
 */
const liquid: Kit = {
  id: 'liquid',
  kickTrim: 1.9,
  trim: 1.0,
  name: 'PULSE / Ryoji Ikeda',
  description: 'After Ikeda: sine test tones, single-sample impulses, gated noise and silence as an event. Nothing smeared, nothing warmed.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.5, 1.4, m.decay)
    const w = m.weight * m.mass
    // the sine grid: frequencies step, they do not glide
    const step = Math.floor(m.spiral * 8)
    switch (h.track) {
      case 'kick': {
        // a sine pulse with a hard edge: no beater, no saturation, just a
        // frequency that stops existing
        const o = ctx.createOscillator()
        o.type = 'sine'
        const f0 = 52 * tune
        o.frequency.setValueAtTime(safeParam(f0 * lerp(1.6, 2.6, m.punch), 20, 400, 90), t)
        o.frequency.exponentialRampToValueAtTime(safeParam(f0, 20, 400, 52), t + lerp(0.03, 0.012, m.punch))
        const g = ctx.createGain()
        const peak = 1.0 * h.velocity
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + 0.0008)
        const hold = lerp(0.11, 0.05, m.punch) * dec
        g.gain.setValueAtTime(peak, t + hold)
        // the gate: back to exactly zero, not a decay
        g.gain.linearRampToValueAtTime(0, t + hold + 0.004)
        o.connect(g).connect(n.punch)
        o.start(t)
        o.stop(t + hold + 0.02)
        sub(ctx, t, 26 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.16, 0.4, w) * dec)
        break
      }
      case 'sub': {
        // a held sine, gated: the low end as a data value
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = safeParam(38 * tune, 18, 200, 38)
        const g = ctx.createGain()
        const peak = (0.55 + 0.4 * w) * h.velocity
        const hold = lerp(0.18, 0.5, w) * dec
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + 0.002)
        g.gain.setValueAtTime(peak, t + hold)
        g.gain.linearRampToValueAtTime(0, t + hold + 0.006)
        o.connect(g).connect(n.out)
        o.start(t)
        o.stop(t + hold + 0.03)
        break
      }
      case 'snare': {
        // white noise, gated hard: a burst with square edges
        const s = source(ctx, a.noise, t, 0.2 + h.step * 0.03)
        const hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = lerp(900, 3200, m.grit)
        const g = ctx.createGain()
        const peak = (0.34 + 0.16 * w) * h.velocity
        const len = lerp(0.03, 0.012, m.punch) * dec
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + 0.0005)
        g.gain.setValueAtTime(peak, t + len)
        g.gain.linearRampToValueAtTime(0, t + len + 0.002)
        s.connect(hp).connect(g)
        fan(g, n, m.space * 0.25)
        s.stop(t + len + 0.05)
        sub(ctx, t, 58 * tune, n.out, 0.2 * w * h.velocity, 0.12 * dec)
        break
      }
      case 'hat': {
        // a sine pip at the top of hearing, two milliseconds long
        const hz = [8200, 9600, 11200, 12800, 7400, 10400, 13600, 6800][step % 8] * (1 + m.bend / 4000)
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = safeParam(hz, 2000, 17000, 9000)
        const g = ctx.createGain()
        const peak = 0.075 * h.velocity
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + 0.0004)
        g.gain.setValueAtTime(peak, t + 0.0022)
        g.gain.linearRampToValueAtTime(0, t + 0.003)
        o.connect(g).connect(n.out)
        o.start(t)
        o.stop(t + 0.02)
        break
      }
      case 'perc': {
        // the impulse: as short as an event can be and still have a pitch
        const hz = [1480, 2960, 740, 3920, 1120, 5240, 1860, 2480][(step + h.step) % 8]
        click(ctx, t, n.out, 0.28 * h.velocity, hz * tune, lerp(6, 22, m.grit), 0.0025)
        // and its echo, exactly one tap away
        const e = ctx.createGain()
        e.gain.value = m.space * 0.5
        click(ctx, t, e, 0.28 * h.velocity, hz * tune, lerp(6, 22, m.grit), 0.0025)
        e.connect(n.echo)
        break
      }
      case 'air': {
        // a single high sine held steady: a tone, not a texture
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = safeParam([2960, 4440, 5920, 7400][step % 4] * tune, 500, 16000, 4000)
        const g = ctx.createGain()
        const peak = 0.028 * h.velocity
        const hold = 0.5 * dec
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(peak, t + 0.01)
        g.gain.setValueAtTime(peak, t + hold)
        g.gain.linearRampToValueAtTime(0, t + hold + 0.01)
        const pan = ctx.createStereoPanner()
        pan.pan.value = (step % 2 ? 1 : -1) * 0.7
        o.connect(g).connect(pan)
        fan(pan, n, m.space * 0.2)
        o.start(t)
        o.stop(t + hold + 0.05)
        break
      }
    }
  },
}

export const KITS: Record<KitId, Kit> = { chain, dust, grain, liquid }
