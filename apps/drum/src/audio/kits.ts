import { createPrng, safeParam } from '@el-systema/core'
import type { Hit, TrackId } from '../engine/pattern'
import { bitCurve, foldCurve, impulse, knock, noiseBuffer, percEnv, pinkBuffer, saturationCurve, sweptBand, vinylBuffer } from './dsp'

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

/**
 * A metallic resonator: a very short delay fed back on itself rings at
 * 1/delay Hz. Ping it with an impulse and you get a tuned, inharmonic ping
 * with no oscillator at all — the Monolake kit is built out of these.
 *
 * It tears itself down after `life` seconds. A delay in a feedback loop is
 * never collected on its own — it is a cycle, and it keeps running — so
 * without this every hit would leave a ringing loop behind and the graph
 * would fill up and eventually blow out.
 *
 * Note the loop delay cannot go below one render quantum (128 samples), so
 * the feedback gain is computed from the delay the graph will actually use,
 * not from the one we asked for.
 */
function resonator(
  ctx: AudioContext,
  t: number,
  hz: number,
  decay: number,
  damp = 5200,
  life = decay * 2.5 + 0.2,
): { input: GainNode; output: GainNode } {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const d = ctx.createDelay(0.2)
  const asked = 1 / Math.max(40, hz)
  const actual = Math.max(128 / ctx.sampleRate, asked)
  d.delayTime.value = safeParam(asked, 0.0002, 0.2, 0.004)
  const fb = ctx.createGain()
  // feedback for the wanted decay: g = 10^(-3 * delay / decay)
  fb.gain.value = safeParam(Math.pow(10, (-3 * actual) / Math.max(0.02, decay)), 0, 0.96, 0.9)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = safeParam(damp, 200, 18000, 5000)
  input.connect(d)
  d.connect(lp).connect(fb).connect(d)
  d.connect(output)

  // close the loop down, then let the nodes go
  const end = t + life
  fb.gain.setValueAtTime(fb.gain.value, Math.max(t, ctx.currentTime))
  fb.gain.setTargetAtTime(0, end, 0.05)
  output.gain.setTargetAtTime(0, end, 0.06)
  window.setTimeout(
    () => {
      for (const node of [input, d, lp, fb, output]) node.disconnect()
    },
    Math.max(0, (end + 0.6 - ctx.currentTime) * 1000),
  )
  return { input, output }
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

// ───────────────────────── CHAIN · after Monolake ─────────────────────────
/**
 * Robert Henke's dub techno, not Basic Channel's: the reverb is replaced by
 * grid-locked ping-pong delay, the chord by metallic resonators, and every
 * edge is deliberate. Surgical rather than submerged — the space is
 * architecture, and the delay taps are part of the pattern.
 */
const chain: Kit = {
  id: 'chain',
  kickTrim: 1.0,
  trim: 1.7,
  name: 'CHAIN / Monolake',
  description: 'After Monolake: grid-locked ping-pong delay instead of a room, metallic resonators instead of a chord, every edge deliberate.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.6, 1.8, m.decay)
    // the mass axis makes the weight itself breathe over 13 turns
    const w = m.weight * m.mass
    // the resonators are tuned to a fifth apart and drift over the spiral
    const drift = 1 + 0.02 * Math.sin(m.spiral * Math.PI * 2)
    switch (h.track) {
      case 'kick': {
        // clean and closed: no saturation grit, just a controlled drop
        const o = body(ctx, t, lerp(120, 190, m.punch) * tune, 49 * tune, lerp(0.05, 0.026, m.punch))
        const g = percEnv(ctx, t, { attack: 0.0015, decay: lerp(0.3, 0.17, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.6 })
        const fd = folder(ctx, a, m.fold * 0.35, m.grind * 0.5)
        o.connect(g).connect(fd).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.1 * m.punch * h.velocity, tone: 1400, decay: 0.005, cutoff: 2800 })
        sub(ctx, t, 30 * tune, n.punch, 0.42 * w * h.velocity, lerp(0.2, 0.55, w) * dec)
        o.stop(t + 0.9 * dec)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 62 * tune, 38 * tune, 0.22)
        const g = percEnv(ctx, t, { attack: 0.008, decay: lerp(0.7, 1.4, w) * dec, peak: (0.5 + 0.5 * w) * h.velocity, curve: 1.8 })
        o.connect(g).connect(n.out)
        sub(ctx, t, 31 * tune, n.punch, 0.3 * w * h.velocity, 0.42 * dec)
        o.stop(t + 3 * dec)
        break
      }
      case 'snare': {
        // a short filtered burst pinging a resonator: body without a drum
        const s = source(ctx, a.noise, t, 0.3 + h.step * 0.01)
        const f = sweptBand(ctx, t, 2400, 1200, 1.1, 0.14)
        const g = percEnv(ctx, t, { attack: 0.001, decay: lerp(0.09, 0.16, w) * dec, peak: (0.22 + 0.16 * w) * h.velocity, curve: 3.4 })
        const res = resonator(ctx, t, 196 * tune * drift, 0.2 * dec, 3000)
        s.connect(f).connect(g)
        g.connect(res.input)
        g.connect(n.out)
        res.output.connect(n.out)
        // the repeats are the arrangement
        const e = ctx.createGain()
        e.gain.value = 0.35 + 0.5 * m.space
        res.output.connect(e).connect(n.echo)
        sub(ctx, t, 60 * tune, n.out, 0.2 * w * h.velocity, 0.18 * dec)
        s.stop(t + 0.6 * dec)
        break
      }
      case 'hat': {
        // a click through a high resonator: metal, and very short
        const res = resonator(ctx, t, lerp(3200, 5600, m.grit) * tune, 0.04 + 0.04 * w, 6800)
        click(ctx, t, res.input, (0.16 + 0.07 * w) * h.velocity, lerp(3400, 6000, m.grit), 9, 0.002)
        res.output.connect(n.out)
        const e = ctx.createGain()
        e.gain.value = 0.25 + 0.45 * m.space
        res.output.connect(e).connect(n.echo)
        break
      }
      case 'perc': {
        // the voice of the kit: two resonators a fifth apart, pinged, then
        // handed to the delay, which is where the harmony actually happens
        const base = 146.8 * tune * drift
        const g = percEnv(ctx, t, { attack: 0.0008, decay: 0.02, peak: 0.34 * h.velocity, curve: 5 })
        const src = source(ctx, a.noise, t, 0.12 + h.step * 0.02)
        const hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 320
        src.connect(hp).connect(g)
        src.stop(t + 0.1)
        const mix = ctx.createGain()
        mix.gain.value = 0.5
        for (const [ratio, lvl] of [[1, 1], [1.498, 0.7], [2.997, 0.4]] as const) {
          const res = resonator(ctx, t, base * ratio, lerp(0.35, 0.9, m.decay), lerp(1800, 3800, m.grit))
          g.connect(res.input)
          const rg = ctx.createGain()
          rg.gain.value = lvl
          res.output.connect(rg).connect(mix)
        }
        const fd = folder(ctx, a, m.fold * 0.5, m.grind * 0.6)
        mix.connect(fd)
        fan(fd, n, m.space * 0.35)
        const e = ctx.createGain()
        e.gain.value = 0.5 + 0.6 * m.space
        fd.connect(e).connect(n.echo)
        sub(ctx, t, 36.7 * tune, n.out, 0.2 * w * h.velocity, 0.5 * dec)
        break
      }
      case 'air': {
        // low rumble, not hiss: the bed carries weight, not noise
        const s = source(ctx, a.pink, t, (h.turn * 0.37) % 2, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = lerp(700, 220, w)
        f.Q.value = 0.9
        const g = percEnv(ctx, t, { attack: 0.2, decay: 0.9 * dec, peak: (0.05 + 0.08 * w) * h.velocity, curve: 1.8 })
        const pan = ctx.createStereoPanner()
        pan.pan.value = Math.sin(m.spiral * Math.PI * 2) * 0.6
        s.connect(f).connect(g).connect(pan)
        fan(pan, n, 0.2 + m.space * 0.5)
        s.stop(t + 3 * dec)
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
        // wide and soft-edged: the body carries it, the noise is a skin
        const s = source(ctx, a.noise, t, 0.05 + h.step * 0.02)
        const f = sweptBand(ctx, t, 1700, 1100, 0.8, 0.11)
        const g = percEnv(ctx, t, { attack: 0.0015, decay: 0.22 * dec, peak: 0.4 * h.velocity, curve: 2.8 })
        const o = body(ctx, t, 185 * tune, 150 * tune, 0.09, 'triangle')
        const og = percEnv(ctx, t, { attack: 0.0015, decay: lerp(0.12, 0.26, w) * dec, peak: (0.48 + 0.42 * w) * h.velocity })
        s.connect(f).connect(g).connect(crush)
        o.connect(og).connect(crush)
        sub(ctx, t, 65 * tune, n.out, 0.16 * w * h.velocity, 0.2 * dec)
        s.stop(t + 1 * dec)
        o.stop(t + 0.6 * dec)
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
  for (let i = 0; i < o.count; i++) {
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
    const peak = o.peak * (0.4 + 0.6 * rnd.next()) * Math.pow(1 - i / o.count, o.decay)
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
  kickTrim: 1.05,
  trim: 7.6,
  name: 'GRAIN / Jan Jelinek',
  description: 'After Jelinek: warm looped haze from a record rather than clicks — long overlapping grains, muted, the hit only a shape in the cloud.',
  humanize: 0.25,
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.7, 2.0, m.decay)
    const w = m.weight * m.mass
    const density = Math.round(lerp(6, 34, m.grit))
    const seed = h.turn * 7717 + h.step * 131 + (['kick', 'sub', 'snare', 'hat', 'perc', 'air'] as TrackId[]).indexOf(h.track)
    const bus = ctx.createGain()
    bus.gain.value = h.velocity
    // the haze: everything in this kit passes a gentle low-pass, so no grain
    // ever arrives as a click
    const haze = ctx.createBiquadFilter()
    haze.type = 'lowpass'
    haze.frequency.value = lerp(2600, 5200, m.grit)
    haze.Q.value = 0.6
    const fd = folder(ctx, a, m.fold * 0.45, m.grind * 0.4)
    bus.connect(haze).connect(fd)
    fan(fd, n, 0.3 + m.space * 0.8)

    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, lerp(125, 185, m.punch) * tune, 48 * tune, lerp(0.055, 0.03, m.punch))
        const g = percEnv(ctx, t, { attack: 0.002, decay: lerp(0.28, 0.16, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.4 })
        o.connect(g).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.1 * m.punch * h.velocity, tone: 1100, decay: 0.006, cutoff: 2200 })
        sub(ctx, t, 31 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.2, 0.58, w) * dec)
        o.stop(t + 0.9 * dec)
        cloud(ctx, a, t + 0.006, bus, { count: Math.max(4, density >> 1), spread: 0.06, grain: 0.05, rate: 0.45, centre: 240, q: 1.2, peak: 0.19, decay: 2.2, seed })
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
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.16 * dec, grain: lerp(0.06, 0.11, w), rate: lerp(1.1, 0.7, w), centre: lerp(1300, 600, w), q: 1.6, peak: 0.34 + 0.17 * w, decay: 1.4, seed })
        sub(ctx, t, 62 * tune, n.out, 0.15 * w * h.velocity, 0.24 * dec)
        break
      case 'hat':
        cloud(ctx, a, t, bus, { count: Math.max(3, density >> 1), spread: 0.05, grain: lerp(0.02, 0.04, w), rate: lerp(2, 1.2, w), centre: lerp(4800, 2600, w), q: 2.6, peak: 0.22 + 0.11 * w, decay: 2, seed })
        break
      case 'perc': {
        // a loop fragment rather than a click: filtered until only shape is left
        const s = source(ctx, a.vinyl, t, ((h.turn * 0.37 + h.step * 0.11) % 3) + 0.2, lerp(0.8, 1.1, m.grit))
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.setValueAtTime(safeParam(lerp(500, 2400, (h.spiral * 3) % 1), 100, 6000, 900), t)
        bp.frequency.exponentialRampToValueAtTime(safeParam(lerp(300, 900, (h.spiral * 3) % 1), 100, 6000, 500), t + 0.2 * dec)
        bp.Q.value = 3.5
        const g = percEnv(ctx, t, { attack: 0.006, decay: 0.12 * dec, peak: 0.42, curve: 2.6 })
        s.connect(bp).connect(g).connect(bus)
        s.stop(t + 0.6 * dec)
        cloud(ctx, a, t + 0.01, bus, { count: 6, spread: 0.16 * dec, grain: 0.08, rate: 0.85, centre: 900, q: 1, peak: 0.14, decay: 1.2, seed: seed + 1 })
        break
      }
      case 'air':
        // the haze the record was carrying all along
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.9 * dec, grain: lerp(0.09, 0.18, w), rate: lerp(0.6, 0.35, w), centre: lerp(800, 300, w), q: 0.8, peak: 0.09 + 0.09 * w, decay: 0.7, seed: seed + 9 })
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
  trim: 0.72,
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
