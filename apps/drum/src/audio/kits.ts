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

// ───────────────────────────── CHAIN (Basic Channel) ─────────────────────────────
const chain: Kit = {
  id: 'chain',
  kickTrim: 1.0,
  trim: 3.4,
  name: 'CHAIN / dub techno',
  description: 'Basic Channel: sine kick, hiss, and a chord stab that lives in its own tail. Space is the instrument.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.6, 1.8, m.decay)
    // the mass axis makes the weight itself breathe over 13 turns
    const w = m.weight * m.mass
    // the chord drifts a fifth over the spiral — the slow harmonic turn
    const drift = 1 + 0.02 * Math.sin(m.spiral * Math.PI * 2)
    switch (h.track) {
      case 'kick': {
        // tight sine kick: the pitch drop happens in 30 ms, so the body is
        // already at its note when the room hears it
        const o = body(ctx, t, lerp(130, 200, m.punch) * tune, 49 * tune, lerp(0.05, 0.026, m.punch))
        const g = percEnv(ctx, t, { attack: 0.0015, decay: lerp(0.3, 0.17, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.6 })
        const fd = folder(ctx, a, m.fold * 0.55, m.grind)
        o.connect(g).connect(fd).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.13 * m.punch * h.velocity, tone: 1400, decay: 0.006, cutoff: 3200 })
        // the mass under the hit: an octave down, three times as long
        sub(ctx, t, 30 * tune, n.punch, 0.42 * w * h.velocity, lerp(0.2, 0.55, w) * dec)
        o.stop(t + 0.9 * dec)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 62 * tune, 38 * tune, 0.22)
        const g = percEnv(ctx, t, { attack: 0.008, decay: lerp(0.7, 1.4, w) * dec, peak: (0.5 + 0.5 * w) * h.velocity, curve: 1.8 })
        const fd = folder(ctx, a, m.fold * 0.4, m.grind)
        o.connect(g).connect(fd)
        fan(fd, n, m.space * 0.15)
        sub(ctx, t, 31 * tune, n.punch, 0.3 * w * h.velocity, 0.42 * dec)
        o.stop(t + 3 * dec)
        break
      }
      case 'snare': {
        // a rim shot with a body under it, not a hiss
        const s = source(ctx, a.noise, t, 0.3 + h.step * 0.01)
        const f = sweptBand(ctx, t, 2400, 1200, 1.1, 0.14)
        const g = percEnv(ctx, t, { attack: 0.001, decay: lerp(0.16, 0.3, w) * dec, peak: (0.24 + 0.18 * w) * h.velocity })
        const o = body(ctx, t, 190 * tune, 150 * tune, 0.07, 'triangle')
        const og = percEnv(ctx, t, { attack: 0.001, decay: 0.12 * dec, peak: 0.5 * w * h.velocity, curve: 3 })
        const fd = folder(ctx, a, m.fold, m.grind)
        s.connect(f).connect(g).connect(fd)
        o.connect(og).connect(fd)
        fan(fd, n, m.space * 0.8)
        sub(ctx, t, 60 * tune, n.out, 0.2 * w * h.velocity, 0.18 * dec)
        s.stop(t + 1 * dec)
        o.stop(t + 0.6 * dec)
        break
      }
      case 'hat': {
        // weighted hat: a metal band, not air
        const s = source(ctx, a.noise, t, 0.7 + h.step * 0.013)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = lerp(3600, 8200, m.grit)
        f.Q.value = lerp(2.4, 0.9, w)
        const g = percEnv(ctx, t, { attack: 0.0008, decay: lerp(0.045, 0.085, w), peak: (0.19 + 0.11 * w) * h.velocity })
        const fd = folder(ctx, a, m.fold * 0.8, m.grind)
        s.connect(f).connect(g).connect(fd)
        fan(fd, n, m.space * 0.5)
        s.stop(t + 0.5)
        break
      }
      case 'perc': {
        // the stab: two detuned saw pairs, band-passed, mostly送り to the room
        const g = percEnv(ctx, t, { attack: 0.004, decay: 0.22 * dec, peak: 0.4 * h.velocity, curve: 2.2 })
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
        // low rumble, not hiss: the bed carries weight, not noise
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = lerp(700, 220, w)
        f.Q.value = 0.9
        const g = percEnv(ctx, t, { attack: 0.2, decay: 0.9 * dec, peak: (0.05 + 0.08 * w) * h.velocity, curve: 1.8 })
        s.connect(f).connect(g)
        fan(g, n, 0.25 + m.space * 0.6)
        s.stop(t + 3 * dec)
        break
      }
    }
  },
}

// ───────────────────────────── DUST (vintage hip-hop) ─────────────────────────────
const dust: Kit = {
  id: 'dust',
  kickTrim: 1.4,
  trim: 1.15,
  name: 'DUST / vintage hip-hop',
  description: '12-bit sampler grit: quantised to few levels, saturated, in a small room, over a vinyl bed.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.6, 1.5, m.decay)
    // the mass axis makes the weight itself breathe over 13 turns
    const w = m.weight * m.mass
    // GRIT = bit depth: 12 bits is clean-ish SP-1200, 6 bits is destroyed
    const crush = ctx.createWaveShaper()
    crush.curve = a.bits(Math.round(lerp(12, 5, m.grit)))
    const sat = ctx.createWaveShaper()
    sat.curve = a.sat
    const room = ctx.createConvolver()
    room.buffer = a.room
    const roomG = ctx.createGain()
    roomG.gain.value = lerp(0.08, 0.3, m.space)
    const fd = folder(ctx, a, m.fold, m.grind)
    crush.connect(sat)
    sat.connect(fd)
    fd.connect(room).connect(roomG)
    fan(fd, n, m.space * 0.25)
    roomG.connect(n.out)

    switch (h.track) {
      case 'kick': {
        // the sampled kick: hard beater, short body, crushed and saturated,
        // straight to the punch bus so the room never softens it
        const o = body(ctx, t, lerp(150, 225, m.punch) * tune, 56 * tune, lerp(0.04, 0.022, m.punch), 'triangle')
        const g = percEnv(ctx, t, { attack: 0.0008, decay: lerp(0.26, 0.15, m.punch) * dec, peak: 1.05 * h.velocity, curve: 4 })
        const kickCrush = ctx.createWaveShaper()
        kickCrush.curve = a.bits(Math.round(lerp(12, 6, m.grit)))
        const kickSat = ctx.createWaveShaper()
        kickSat.curve = a.sat
        kickCrush.connect(kickSat).connect(n.punch)
        o.connect(g).connect(kickCrush)
        knock(ctx, t, kickCrush, a.noise, { level: 0.24 * m.punch * h.velocity, tone: 1900, decay: 0.008, cutoff: 4200, offset: 0.11 })
        sub(ctx, t, 34 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.22, 0.6, w) * dec)
        o.stop(t + 0.8 * dec)
        break
      }
      case 'sub': {
        // the upright bass note: fundamental plus its octave-down weight
        const o = body(ctx, t, 66 * tune, 41 * tune, 0.18)
        const g = percEnv(ctx, t, { attack: 0.005, decay: lerp(0.42, 0.95, w) * dec, peak: (0.55 + 0.35 * w) * h.velocity, curve: 2.2 })
        o.connect(g).connect(crush)
        sub(ctx, t, 33 * tune, n.punch, 0.3 * w * h.velocity, 0.45 * dec)
        o.stop(t + 2.2 * dec)
        break
      }
      case 'snare': {
        const s = source(ctx, a.noise, t, 0.05 + h.step * 0.02)
        const f = sweptBand(ctx, t, 2100, 1300, 0.9, 0.09)
        const g = percEnv(ctx, t, { attack: 0.0008, decay: 0.2 * dec, peak: 0.45 * h.velocity, curve: 3.2 })
        // a tuned ring under the noise: the sampled snare's body
        const o = body(ctx, t, 195 * tune, 160 * tune, 0.08, 'triangle')
        const og = percEnv(ctx, t, { attack: 0.001, decay: lerp(0.1, 0.22, w) * dec, peak: (0.48 + 0.42 * w) * h.velocity })
        s.connect(f).connect(g).connect(crush)
        o.connect(og).connect(crush)
        sub(ctx, t, 65 * tune, n.out, 0.16 * w * h.velocity, 0.2 * dec)
        s.stop(t + 1 * dec)
        o.stop(t + 0.6 * dec)
        break
      }
      case 'hat': {
        const s = source(ctx, a.noise, t, 0.5 + h.step * 0.017, lerp(1, 1.6, m.grit))
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.Q.value = lerp(1.8, 0.8, w)
        f.frequency.value = lerp(6800, 3400, w)
        // every other hat is a touch longer: the loop's human unevenness
        const open = (h.step % 8 === 6 ? 0.1 : 0.035) * lerp(1, 1.7, w)
        const g = percEnv(ctx, t, { attack: 0.0006, decay: open * dec, peak: 0.18 * h.velocity })
        s.connect(f).connect(g).connect(crush)
        s.stop(t + 0.5)
        break
      }
      case 'perc': {
        // rim / wood knock
        const o = body(ctx, t, 900 * tune, 560 * tune, 0.03, 'square')
        const g = percEnv(ctx, t, { attack: 0.0005, decay: lerp(0.05, 0.11, w) * dec, peak: (0.38 + 0.3 * w) * h.velocity, curve: 4 })
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
        // the vinyl bed: loops under everything for a bar
        const s = source(ctx, a.vinyl, t, (h.turn * 0.73) % 3, 1, true)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = lerp(6000, 1100, Math.max(m.grit, w))
        const g = percEnv(ctx, t, { attack: 0.1, decay: 0.7 * dec, peak: (0.09 + 0.07 * w) * h.velocity, curve: 1.8 })
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
  kickTrim: 1.05,
  trim: 7.6,
  name: 'GRAIN / particle',
  description: 'Jelinek: every hit is a cloud of grains read from a record, plus micro-clicks. Rhythm made of particles.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.7, 2.0, m.decay)
    // the mass axis makes the weight itself breathe over 13 turns
    const w = m.weight * m.mass
    const density = Math.round(lerp(6, 34, m.grit))
    const seed = h.turn * 7717 + h.step * 131 + (['kick', 'sub', 'snare', 'hat', 'perc', 'air'] as TrackId[]).indexOf(h.track)
    const bus = ctx.createGain()
    bus.gain.value = h.velocity
    const fd = folder(ctx, a, m.fold * 0.7, m.grind)
    bus.connect(fd)
    fan(fd, n, 0.25 + m.space * 0.9)

    switch (h.track) {
      case 'kick': {
        // the thump is a real drum, not a grain: the cloud sits around it
        const o = body(ctx, t, lerp(125, 185, m.punch) * tune, 48 * tune, lerp(0.055, 0.03, m.punch))
        const g = percEnv(ctx, t, { attack: 0.0015, decay: lerp(0.28, 0.16, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.6 })
        o.connect(g).connect(n.punch)
        knock(ctx, t, n.punch, a.noise, { level: 0.15 * m.punch * h.velocity, tone: 1250, decay: 0.005, cutoff: 3000 })
        sub(ctx, t, 31 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.2, 0.58, w) * dec)
        o.stop(t + 0.9 * dec)
        // the cloud is the kick's shadow, short and behind it
        cloud(ctx, a, t + 0.004, bus, { count: Math.max(4, density >> 1), spread: 0.04, grain: 0.022, rate: 0.5, centre: 260, q: 1.5, peak: 0.19, decay: 2.2, seed })
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
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.09 * dec, grain: lerp(0.022, 0.05, w), rate: lerp(1.4, 0.75, w), centre: lerp(1800, 700, w), q: 2.5, peak: 0.34 + 0.17 * w, decay: 1.9, seed })
        sub(ctx, t, 62 * tune, n.out, 0.15 * w * h.velocity, 0.24 * dec)
        break
      case 'hat':
        cloud(ctx, a, t, bus, { count: Math.max(3, density >> 1), spread: 0.025, grain: lerp(0.008, 0.02, w), rate: lerp(2.6, 1.3, w), centre: lerp(7200, 3000, w), q: 4, peak: 0.22 + 0.11 * w, decay: 2.4, seed })
        break
      case 'perc': {
        // the click: a single sample-short impulse through a resonant band
        const s = source(ctx, a.noise, t, 0.2 + h.step * 0.03)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = lerp(900, 5200, ((h.spiral * 3) % 1))
        f.Q.value = 18
        const g = percEnv(ctx, t, { attack: 0.0003, decay: 0.02 * dec, peak: 0.42, curve: 5 })
        s.connect(f).connect(g).connect(bus)
        s.stop(t + 0.2)
        cloud(ctx, a, t + 0.01, bus, { count: 6, spread: 0.12 * dec, grain: 0.05, rate: 0.9, centre: 1200, q: 1.2, peak: 0.14, decay: 1.2, seed: seed + 1 })
        break
      }
      case 'air':
        // a long drizzle: the cloud that never quite settles
        cloud(ctx, a, t, bus, { count: density * 2, spread: 0.7 * dec, grain: lerp(0.06, 0.13, w), rate: lerp(0.7, 0.35, w), centre: lerp(1000, 300, w), q: 0.9, peak: 0.09 + 0.09 * w, decay: 0.7, seed: seed + 9 })
        break
    }
  },
}

// ───────────────────────────── LIQUID (2026 electronica) ─────────────────────────────
const liquid: Kit = {
  id: 'liquid',
  kickTrim: 1.9,
  trim: 0.72,
  name: 'LIQUID / 2026 electronica',
  description: 'Gliding glass and swept formants, smeared transients, long wet tails. Clean and fluid.',
  voice(h, t, n, a, m) {
    const ctx = n.ctx
    const tune = semi(m.tune) * cents(m.bend)
    const dec = lerp(0.9, 2.6, m.decay)
    // the mass axis makes the weight itself breathe over 13 turns
    const w = m.weight * m.mass
    // the whole kit opens and closes across the spiral
    const open = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(m.spiral * Math.PI * 2))
    switch (h.track) {
      case 'kick': {
        // still liquid, but it lands: the glide is fast and the tail is cut
        const o = body(ctx, t, lerp(160, 230, m.punch) * tune, 47 * tune, lerp(0.075, 0.035, m.punch))
        const g = percEnv(ctx, t, { attack: 0.002, decay: lerp(0.34, 0.2, m.punch) * dec, peak: 1.0 * h.velocity, curve: 3.2 })
        const sat = ctx.createWaveShaper()
        sat.curve = a.sat
        const fd = folder(ctx, a, m.fold * 0.6, m.grind)
        o.connect(g).connect(sat).connect(fd).connect(n.punch)
        knock(ctx, t, n.punch, a.pink, { level: 0.11 * m.punch * h.velocity, tone: 2200, decay: 0.007, cutoff: 5200 })
        sub(ctx, t, 32 * tune, n.punch, 0.46 * w * h.velocity, lerp(0.25, 0.7, w) * dec)
        o.stop(t + 1.1 * dec)
        break
      }
      case 'sub': {
        const o = body(ctx, t, 74 * tune, 37 * tune, 0.45, 'sine')
        const g = percEnv(ctx, t, { attack: 0.04, decay: lerp(1.1, 1.9, w) * dec, peak: (0.5 + 0.4 * w) * h.velocity, curve: 1.7 })
        const fd = folder(ctx, a, m.fold * 0.5, m.grind)
        o.connect(g).connect(fd)
        fan(fd, n, m.space * 0.5)
        sub(ctx, t, 30 * tune, n.punch, 0.3 * w * h.velocity, 0.5 * dec)
        o.stop(t + 3.5 * dec)
        break
      }
      case 'snare': {
        // no transient: a swept formant that arrives instead of hitting
        const s = source(ctx, a.pink, t, 0.4 + h.step * 0.02)
        const f = sweptBand(ctx, t, lerp(700, 2600, open), lerp(3200, 6400, m.grit), 3.5, 0.3 * dec)
        const g = percEnv(ctx, t, { attack: lerp(0.02, 0.006, w), decay: 0.34 * dec, peak: (0.26 + 0.16 * w) * h.velocity, curve: 2.2 })
        const fd = folder(ctx, a, m.fold, m.grind)
        s.connect(f).connect(g).connect(fd)
        fan(fd, n, 0.3 + m.space)
        sub(ctx, t, 58 * tune, n.out, 0.24 * w * h.velocity, 0.3 * dec)
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
        const g = percEnv(ctx, t, { attack: 0.001, decay: 0.05 * dec, peak: 0.26 * h.velocity })
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
        const g = percEnv(ctx, t, { attack: 0.004, decay: 0.5 * dec, peak: 0.44 * h.velocity, curve: 2.4 })
        const fd = folder(ctx, a, m.fold, m.grind)
        o.connect(g).connect(fd)
        fan(fd, n, 0.4 + m.space)
        sub(ctx, t, f0 * 0.25, n.out, 0.2 * w * h.velocity, 0.45 * dec)
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
        const g = percEnv(ctx, t, { attack: 0.25, decay: 0.8 * dec, peak: (0.04 + 0.04 * w) * h.velocity, curve: 1.8 })
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
