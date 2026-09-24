import { createPrng, safeParam } from '@el-systema/core'
import type { Hit, TrackId } from '../engine/pattern'
import { bitCurve, impulse, noiseBuffer, percEnv, pinkBuffer, saturationCurve, sweptBand, vinylBuffer } from './dsp'

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
  /** how long tails are (0..1) */
  decay: number
  /** send level to the shared delay/reverb (0..1) */
  space: number
  /** 0..1 — where the playhead is along the spiral; kits morph with it */
  spiral: number
}

export interface KitNodes {
  ctx: AudioContext
  /** dry destination */
  out: AudioNode
  /** send destination (delay → reverb) */
  send: GainNode
}

/** Buffers and curves built once per context — never per hit. */
export class KitAssets {
  readonly noise: AudioBuffer
  readonly pink: AudioBuffer
  readonly vinyl: AudioBuffer
  readonly room: AudioBuffer
  readonly sat: Float32Array<ArrayBuffer>
  private bitCache = new Map<number, Float32Array<ArrayBuffer>>()
  constructor(ctx: BaseAudioContext) {
    this.noise = noiseBuffer(ctx, 2)
    this.pink = pinkBuffer(ctx, 3)
    this.vinyl = vinylBuffer(ctx, 4)
    this.room = impulse(ctx, 0.6, 3.5)
    this.sat = saturationCurve(2.2)
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
  voice(hit: Hit, t: number, n: KitNodes, a: KitAssets, m: KitMacros): void
}

const semi = (s: number) => Math.pow(2, s / 12)
const lerp = (a: number, b: number, x: number) => a + (b - a) * x

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

// ───────────────────────────── CHAIN (Basic Channel) ─────────────────────────────
const chain: Kit = {
  id: 'chain',
  trim: 4.2,
  name: 'CHAIN / dub techno',
  description: 'Basic Channel: sine kick, hiss, and a chord stab that lives in its own tail. Space is the instrument.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune)
    const dec = lerp(0.6, 1.8, m.decay)
    // the chord drifts a fifth over the spiral — the slow harmonic turn
    const drift = 1 + 0.02 * Math.sin(m.spiral * Math.PI * 2)
    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, 108 * tune, 42 * tune, 0.07)
        const g = percEnv(ctx, t, { attack: 0.002, decay: 0.38 * dec, peak: 0.95 * h.velocity })
        o.connect(g)
        fan(g, n, m.space * 0.1)
        o.stop(t + 1.2 * dec)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 58 * tune, 41 * tune, 0.2)
        const g = percEnv(ctx, t, { attack: 0.01, decay: 0.7 * dec, peak: 0.5 * h.velocity, curve: 2 })
        o.connect(g)
        fan(g, n, m.space * 0.15)
        o.stop(t + 2.5 * dec)
        break
      }
      case 'snare': {
        const s = source(ctx, a.noise, t, 0.3 + h.step * 0.01)
        const f = sweptBand(ctx, t, 2400, 1500, 1.2, 0.12)
        const g = percEnv(ctx, t, { attack: 0.001, decay: 0.16 * dec, peak: 0.35 * h.velocity })
        s.connect(f).connect(g)
        fan(g, n, m.space * 0.8)
        s.stop(t + 1 * dec)
        break
      }
      case 'hat': {
        const s = source(ctx, a.noise, t, 0.7 + h.step * 0.013)
        const f = ctx.createBiquadFilter()
        f.type = 'highpass'
        f.frequency.value = lerp(6000, 10500, m.grit)
        const g = percEnv(ctx, t, { attack: 0.0008, decay: 0.045, peak: 0.22 * h.velocity })
        s.connect(f).connect(g)
        fan(g, n, m.space * 0.5)
        s.stop(t + 0.4)
        break
      }
      case 'perc': {
        // the stab: two detuned saw pairs, band-passed, mostly送り to the room
        const g = percEnv(ctx, t, { attack: 0.004, decay: 0.22 * dec, peak: 0.3 * h.velocity, curve: 2.2 })
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.Q.value = 1.1
        f.frequency.setValueAtTime(lerp(420, 900, m.grit) * tune, t)
        f.frequency.exponentialRampToValueAtTime(lerp(300, 600, m.grit) * tune, t + 0.4)
        // minor 7th: the Chain Reaction chord
        for (const [ratio, lvl] of [[1, 1], [1.189, 0.8], [1.498, 0.7], [1.781, 0.55]] as const) {
          for (const det of [-7, 7]) {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'
            o.frequency.value = safeParam(146.8 * tune * ratio * drift, 20, 8000, 300)
            o.detune.value = det
            const og = ctx.createGain()
            og.gain.value = 0.16 * lvl
            o.connect(og).connect(f)
            o.start(t)
            o.stop(t + 2.2 * dec)
          }
        }
        f.connect(g)
        fan(g, n, 0.5 + m.space * 0.9)
        break
      }
      case 'air': {
        const s = source(ctx, a.pink, t, (h.turn * 0.37) % 2, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = lerp(900, 4000, m.grit)
        f.Q.value = 0.7
        const g = percEnv(ctx, t, { attack: 0.35, decay: 1.6 * dec, peak: 0.1 * h.velocity, curve: 1.6 })
        s.connect(f).connect(g)
        fan(g, n, 0.4 + m.space)
        s.stop(t + 4 * dec)
        break
      }
    }
  },
}

// ───────────────────────────── DUST (vintage hip-hop) ─────────────────────────────
const dust: Kit = {
  id: 'dust',
  trim: 0.85,
  name: 'DUST / vintage hip-hop',
  description: '12-bit sampler grit: quantised to few levels, saturated, in a small room, over a vinyl bed.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune)
    const dec = lerp(0.6, 1.5, m.decay)
    // GRIT = bit depth: 12 bits is clean-ish SP-1200, 6 bits is destroyed
    const crush = ctx.createWaveShaper()
    crush.curve = a.bits(Math.round(lerp(12, 5, m.grit)))
    const sat = ctx.createWaveShaper()
    sat.curve = a.sat
    const room = ctx.createConvolver()
    room.buffer = a.room
    const roomG = ctx.createGain()
    roomG.gain.value = lerp(0.08, 0.3, m.space)
    crush.connect(sat)
    sat.connect(room).connect(roomG)
    fan(sat, n, m.space * 0.25)
    roomG.connect(n.out)

    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, 128 * tune, 48 * tune, 0.045, 'triangle')
        const g = percEnv(ctx, t, { attack: 0.001, decay: 0.3 * dec, peak: 1.0 * h.velocity, curve: 3.5 })
        const click = source(ctx, a.noise, t, 0.11)
        const cg = percEnv(ctx, t, { attack: 0.0005, decay: 0.012, peak: 0.3 * h.velocity })
        const cf = ctx.createBiquadFilter()
        cf.type = 'lowpass'
        cf.frequency.value = 2600
        click.connect(cf).connect(cg).connect(crush)
        o.connect(g).connect(crush)
        o.stop(t + 1.2 * dec)
        click.stop(t + 0.2)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 62 * tune, 44 * tune, 0.16)
        const g = percEnv(ctx, t, { attack: 0.006, decay: 0.42 * dec, peak: 0.55 * h.velocity, curve: 2.4 })
        o.connect(g).connect(crush)
        o.stop(t + 1.8 * dec)
        break
      }
      case 'snare': {
        const s = source(ctx, a.noise, t, 0.05 + h.step * 0.02)
        const f = sweptBand(ctx, t, 2100, 1300, 0.9, 0.09)
        const g = percEnv(ctx, t, { attack: 0.0008, decay: 0.2 * dec, peak: 0.7 * h.velocity, curve: 3.2 })
        // a tuned ring under the noise: the sampled snare's body
        const o = body(ctx, t, 208 * tune, 176 * tune, 0.08, 'triangle')
        const og = percEnv(ctx, t, { attack: 0.001, decay: 0.1 * dec, peak: 0.35 * h.velocity })
        s.connect(f).connect(g).connect(crush)
        o.connect(og).connect(crush)
        s.stop(t + 1 * dec)
        o.stop(t + 0.6 * dec)
        break
      }
      case 'hat': {
        const s = source(ctx, a.noise, t, 0.5 + h.step * 0.017, lerp(1, 1.6, m.grit))
        const f = ctx.createBiquadFilter()
        f.type = 'highpass'
        f.frequency.value = 6800
        // every other hat is a touch longer: the loop's human unevenness
        const open = h.step % 8 === 6 ? 0.1 : 0.035
        const g = percEnv(ctx, t, { attack: 0.0006, decay: open * dec, peak: 0.3 * h.velocity })
        s.connect(f).connect(g).connect(crush)
        s.stop(t + 0.5)
        break
      }
      case 'perc': {
        // rim / wood knock
        const o = body(ctx, t, 1100 * tune, 780 * tune, 0.03, 'square')
        const g = percEnv(ctx, t, { attack: 0.0005, decay: 0.05 * dec, peak: 0.3 * h.velocity, curve: 4 })
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 1500 * tune
        f.Q.value = 3
        o.connect(f).connect(g).connect(crush)
        o.stop(t + 0.3)
        break
      }
      case 'air': {
        // the vinyl bed: loops under everything for a bar
        const s = source(ctx, a.vinyl, t, (h.turn * 0.73) % 3, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = lerp(6000, 2400, m.grit)
        const g = percEnv(ctx, t, { attack: 0.2, decay: 2.2 * dec, peak: 0.22 * h.velocity, curve: 1.4 })
        s.connect(f).connect(g).connect(sat)
        s.stop(t + 5 * dec)
        break
      }
    }
  },
}

// ───────────────────────────── GRAIN (Jelinek) ─────────────────────────────
/**
 * One hit = a cloud. Grains are 8–60 ms windows read from the vinyl buffer at
 * random offsets, each with its own pitch and pan; the "drum" is only the
 * cloud's envelope and centre frequency. GRIT sets grain count and spread.
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
    // a Hann-ish window per grain keeps the cloud free of clicks
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

const grain: Kit = {
  id: 'grain',
  trim: 3.8,
  name: 'GRAIN / particle',
  description: 'Jelinek: every hit is a cloud of grains read from a record, plus micro-clicks. Rhythm made of particles.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune)
    const dec = lerp(0.7, 2.0, m.decay)
    const density = Math.round(lerp(6, 34, m.grit))
    const seed = h.turn * 7717 + h.step * 131 + (['kick', 'sub', 'snare', 'hat', 'perc', 'air'] as TrackId[]).indexOf(h.track)
    const bus = ctx.createGain()
    bus.gain.value = h.velocity
    fan(bus, n, 0.25 + m.space * 0.9)

    switch (h.track) {
      case 'kick': {
        // a sine thump so the cloud has a floor to stand on
        const o = body(ctx, t, 96 * tune, 44 * tune, 0.08)
        const g = percEnv(ctx, t, { attack: 0.003, decay: 0.3 * dec, peak: 0.7 })
        o.connect(g).connect(bus)
        o.stop(t + 1.2 * dec)
        cloud(ctx, a, t, bus, { count: density, spread: 0.05, grain: 0.03, rate: 0.5, centre: 220, q: 1.5, peak: 0.35, decay: 1.6, seed })
        break
      }
      case 'sub': {
        const o = body(ctx, t, 54 * tune, 40 * tune, 0.25)
        const g = percEnv(ctx, t, { attack: 0.02, decay: 0.8 * dec, peak: 0.45, curve: 2 })
        o.connect(g).connect(bus)
        o.stop(t + 2.4 * dec)
        break
      }
      case 'snare':
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.09 * dec, grain: 0.022, rate: 1.4, centre: 1800, q: 2.5, peak: 0.42, decay: 1.9, seed })
        break
      case 'hat':
        cloud(ctx, a, t, bus, { count: Math.max(3, density >> 1), spread: 0.025, grain: 0.008, rate: 2.6, centre: 7200, q: 4, peak: 0.3, decay: 2.4, seed })
        break
      case 'perc': {
        // the click: a single sample-short impulse through a resonant band
        const s = source(ctx, a.noise, t, 0.2 + h.step * 0.03)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = lerp(900, 5200, ((h.spiral * 3) % 1))
        f.Q.value = 18
        const g = percEnv(ctx, t, { attack: 0.0003, decay: 0.02 * dec, peak: 0.5, curve: 5 })
        s.connect(f).connect(g).connect(bus)
        s.stop(t + 0.2)
        cloud(ctx, a, t + 0.01, bus, { count: 6, spread: 0.12 * dec, grain: 0.05, rate: 0.9, centre: 1200, q: 1.2, peak: 0.18, decay: 1.2, seed: seed + 1 })
        break
      }
      case 'air':
        // a long drizzle: the cloud that never quite settles
        cloud(ctx, a, t, bus, { count: density * 3, spread: 1.6 * dec, grain: 0.06, rate: 0.7, centre: 1000, q: 0.9, peak: 0.12, decay: 0.7, seed: seed + 9 })
        break
    }
  },
}

// ───────────────────────────── LIQUID (2026 electronica) ─────────────────────────────
const liquid: Kit = {
  id: 'liquid',
  trim: 0.95,
  name: 'LIQUID / 2026 electronica',
  description: 'Gliding glass and swept formants, smeared transients, long wet tails. Clean and fluid.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune)
    const dec = lerp(0.9, 2.6, m.decay)
    // the whole kit opens and closes across the spiral
    const open = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(m.spiral * Math.PI * 2))
    switch (h.track) {
      case 'kick': {
        const o = body(ctx, t, 150 * tune, 38 * tune, 0.11)
        const g = percEnv(ctx, t, { attack: 0.006, decay: 0.42 * dec, peak: 0.9 * h.velocity, curve: 2.6 })
        const s = ctx.createWaveShaper()
        s.curve = a.sat
        o.connect(g).connect(s)
        fan(s, n, m.space * 0.4)
        o.stop(t + 1.6 * dec)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 70 * tune, 39 * tune, 0.5, 'sine')
        const g = percEnv(ctx, t, { attack: 0.05, decay: 1.1 * dec, peak: 0.5 * h.velocity, curve: 1.8 })
        o.connect(g)
        fan(g, n, m.space * 0.5)
        o.stop(t + 3 * dec)
        break
      }
      case 'snare': {
        // no transient: a swept formant that arrives instead of hitting
        const s = source(ctx, a.pink, t, 0.4 + h.step * 0.02)
        const f = sweptBand(ctx, t, lerp(700, 2600, open), lerp(3200, 6400, m.grit), 3.5, 0.3 * dec)
        const g = percEnv(ctx, t, { attack: 0.02, decay: 0.34 * dec, peak: 0.42 * h.velocity, curve: 2.2 })
        s.connect(f).connect(g)
        fan(g, n, 0.3 + m.space)
        s.stop(t + 2 * dec)
        break
      }
      case 'hat': {
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.setValueAtTime(safeParam(7400 * tune * open, 200, 16000, 7000), t)
        o.frequency.exponentialRampToValueAtTime(safeParam(9800 * tune, 200, 17000, 9000), t + 0.06)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 9000
        f.Q.value = 6
        const g = percEnv(ctx, t, { attack: 0.001, decay: 0.05 * dec, peak: 0.2 * h.velocity })
        o.connect(f).connect(g)
        fan(g, n, 0.25 + m.space * 0.7)
        o.stop(t + 0.5)
        break
      }
      case 'perc': {
        // glass ping with a glide: the liquid signature
        const o = ctx.createOscillator()
        o.type = 'sine'
        const f0 = 520 * tune * (1 + 0.5 * ((h.step * 7) % 5) / 5)
        o.frequency.setValueAtTime(safeParam(f0 * 0.6, 30, 8000, 400), t)
        o.frequency.exponentialRampToValueAtTime(safeParam(f0, 30, 8000, 500), t + 0.12 * dec)
        const mod = ctx.createOscillator()
        mod.type = 'sine'
        mod.frequency.value = f0 * 2.7
        const mg = ctx.createGain()
        mg.gain.setValueAtTime(f0 * lerp(0.2, 1.4, m.grit), t)
        mg.gain.setTargetAtTime(0, t, 0.05)
        mod.connect(mg).connect(o.frequency)
        const g = percEnv(ctx, t, { attack: 0.004, decay: 0.5 * dec, peak: 0.34 * h.velocity, curve: 2.4 })
        o.connect(g)
        fan(g, n, 0.4 + m.space)
        mod.start(t)
        o.start(t)
        mod.stop(t + 2 * dec)
        o.stop(t + 3 * dec)
        return
      }
      case 'air': {
        // shimmer: pink noise through a slow formant pair
        const s = source(ctx, a.pink, t, (h.turn * 0.41) % 2, 1, true)
        const f1 = sweptBand(ctx, t, 600 * open, 2400, 2, 2 * dec)
        const f2 = ctx.createBiquadFilter()
        f2.type = 'bandpass'
        f2.frequency.value = 5200
        f2.Q.value = 1.4
        const g = percEnv(ctx, t, { attack: 0.5, decay: 2.4 * dec, peak: 0.13 * h.velocity, curve: 1.3 })
        s.connect(f1).connect(g)
        s.connect(f2).connect(g)
        fan(g, n, 0.5 + m.space)
        s.stop(t + 6 * dec)
        break
      }
    }
  },
}

export const KITS: Record<KitId, Kit> = { chain, dust, grain, liquid }
