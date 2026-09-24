import { FixedStepRunner, SourceClock, clamp, createPrng } from '@el-systema/core'
import { MasterChain, makeSaturation as saturationCurve } from '@el-systema/audio'
import { KITS, KitAssets, type KitId, type KitMacros, type KitNodes } from '../audio/kits'
import { lerp } from '@el-systema/core'
import { DEFAULT_SPIRAL, emptyPattern, hitsAt, resizePattern, seedPattern, swingOffset, TRACKS, type Hit, type Pattern, type SpiralConfig, type TrackId } from './pattern'

/**
 * SPIRA's transport. One AudioContext, one clock, one output chain.
 *
 * Scheduling: a 25 ms timer walks the step grid ahead of the audio clock and
 * hands each due step to the kit, which builds and disposes its own nodes.
 * Nothing is voiced on an animation frame, so the groove is immune to the
 * render loop — the canvas only reads `snapshot()`.
 */

const TICK_MS = 25
const LOOKAHEAD = 0.12

export interface MachineState {
  kit: KitId
  bpm: number
  playing: boolean
  swing: number
  macros: { tune: number; grit: number; decay: number; space: number; level: number; punch: number }
  spiral: SpiralConfig
  /** which track the spiral canvas edits */
  editing: TrackId
  /** per-track mute */
  mutes: Record<TrackId, boolean>
}

export interface Snapshot {
  now: number
  /** fractional step position along the current turn */
  step: number
  turn: number
  /** 0..1 along the whole spiral */
  position: number
  running: boolean
  level: number
  /** hits sounded recently, for the canvas flashes */
  recent: { track: TrackId; step: number; turn: number; velocity: number; time: number }[]
}

export function defaultState(): MachineState {
  return {
    kit: 'chain',
    bpm: 124,
    playing: false,
    swing: 0.12,
    macros: { tune: 0, grit: 0.45, decay: 0.5, space: 0.5, level: 0.8, punch: 0.7 },
    spiral: { ...DEFAULT_SPIRAL },
    editing: 'kick',
    mutes: { kick: false, sub: false, snare: false, hat: false, perc: false, air: false },
  }
}

export class Machine {
  state: MachineState = defaultState()
  pattern: Pattern = seedPattern('chain', DEFAULT_SPIRAL.stepsPerTurn)
  private ctx: AudioContext | null = null
  private chain: MasterChain | null = null
  private assets: KitAssets | null = null
  private nodes: KitNodes | null = null
  /** per-kit level trim, on both the dry and the send path */
  private kitDry: GainNode | null = null
  private kitSend: GainNode | null = null
  /** the kick's own path: saturated, dry, and never ducked */
  private punchBus: GainNode | null = null
  /** sidechain: everything but the kick passes these and ducks on every kick */
  private duckDry: GainNode | null = null
  private duckSend: GainNode | null = null
  /** clears the low end out of the non-kick tracks so the kick owns it */
  private bodyHP: BiquadFilterNode | null = null
  private clock: SourceClock | null = null
  private runner: FixedStepRunner | null = null
  private timer: number | null = null
  private listeners = new Set<() => void>()
  /** index of the next step to schedule, counted from the start of the spiral */
  private cursor = 0
  /** audio time of that step */
  private cursorTime = 0
  private recent: Snapshot['recent'] = []

  get audioReady() {
    return this.ctx !== null
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    for (const fn of this.listeners) fn()
  }

  setState(patch: Partial<MachineState> | ((s: MachineState) => Partial<MachineState>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch
    const prev = this.state
    this.state = { ...prev, ...p }
    if (p.spiral && p.spiral.stepsPerTurn !== prev.spiral.stepsPerTurn) {
      this.pattern = resizePattern(this.pattern, prev.spiral.stepsPerTurn, p.spiral.stepsPerTurn)
    }
    if (p.kit && p.kit !== prev.kit) this.applyTrim()
    if (p.macros && this.chain) {
      this.chain.setSpace(this.state.macros.space)
      this.chain.setMasterGain(0.35 + 0.45 * this.state.macros.level)
      this.applyPunch()
    }
    if (p.bpm && this.clock) this.clock.bpm = this.state.bpm
    this.emit()
  }

  /**
   * PUNCH in one gesture: how much of the low end the other tracks give up,
   * how hard the kick bus is driven, and how deep the sidechain duck goes.
   */
  private applyPunch() {
    const p = this.state.macros.punch
    const t = this.ctx?.currentTime ?? 0
    this.bodyHP?.frequency.setTargetAtTime(lerp(45, 190, p), t, 0.05)
    this.punchBus?.gain.setTargetAtTime(lerp(1.1, 1.9, p) * KITS[this.state.kit].kickTrim, t, 0.05)
  }

  /** Duck the body buses under a kick landing at `t`. */
  private duck(t: number, velocity: number) {
    const depth = 0.12 + 0.55 * this.state.macros.punch * velocity
    const release = 0.05 + 0.13 * (1 - this.state.macros.punch)
    for (const g of [this.duckDry, this.duckSend]) {
      if (!g) continue
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(1, t)
      g.gain.linearRampToValueAtTime(Math.max(0.05, 1 - depth), t + 0.006)
      g.gain.setTargetAtTime(1, t + 0.012, release / 3)
    }
  }

  private applyTrim() {
    const trim = KITS[this.state.kit].trim
    const t = this.ctx?.currentTime ?? 0
    this.kitDry?.gain.setTargetAtTime(trim, t, 0.03)
    this.kitSend?.gain.setTargetAtTime(trim, t, 0.03)
    // `trim` normalises the body only; the kick bus follows kickTrim
    this.applyPunch()
  }

  /** Replace the pattern (kit change, randomise, clear). */
  setPattern(p: Pattern) {
    this.pattern = p
    this.emit()
  }

  toggleStep(track: TrackId, step: number) {
    const row = this.pattern[track].slice()
    row[step] = row[step] > 0 ? 0 : 0.9
    this.pattern = { ...this.pattern, [track]: row }
    this.emit()
  }

  /**
   * Open the audio context. Must be called from a user gesture. This only
   * arms the machine — nothing sounds until play(), so START AUDIO never
   * starts a groove on its own.
   */
  async start() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'balanced' })
      this.ctx = ctx
      this.chain = new MasterChain(ctx, { delaySeconds: 0.42, delayFeedback: 0.45, reverbSeconds: 2.6, reverbDecay: 2.2 })
      this.chain.setSpace(this.state.macros.space)
      this.chain.setMasterGain(0.35 + 0.45 * this.state.macros.level)
      this.assets = new KitAssets(ctx)

      // ── kick path ──────────────────────────────────────────────
      // kick → drive → soft clip → low shelf → bus. No reverb send: a kick
      // that is in the room is a kick you feel later than you see.
      this.punchBus = ctx.createGain()
      const punchSat = ctx.createWaveShaper()
      punchSat.curve = saturationCurve(1.9)
      punchSat.oversample = '2x'
      // the weight you feel is 55-90 Hz, not 40: a peak there reads as
      // physical on speakers that cannot reproduce the fundamental at all
      const punchShelf = ctx.createBiquadFilter()
      punchShelf.type = 'peaking'
      punchShelf.frequency.value = 72
      punchShelf.Q.value = 0.9
      punchShelf.gain.value = 4.5
      this.punchBus.connect(punchSat).connect(punchShelf).connect(this.chain.input)

      // ── everything else ────────────────────────────────────────
      // high-passed and ducked by the kick, dry and wet alike
      this.kitDry = ctx.createGain()
      this.kitSend = ctx.createGain()
      this.bodyHP = ctx.createBiquadFilter()
      this.bodyHP.type = 'highpass'
      this.bodyHP.Q.value = 0.7
      this.duckDry = ctx.createGain()
      this.duckSend = ctx.createGain()
      this.kitDry.connect(this.bodyHP).connect(this.duckDry).connect(this.chain.input)
      this.kitSend.connect(this.duckSend).connect(this.chain.send)
      this.applyTrim()
      this.applyPunch()
      this.nodes = { ctx, out: this.kitDry, send: this.kitSend, punch: this.punchBus }
      this.clock = new SourceClock(() => ctx.currentTime, this.state.bpm)
      this.runner = new FixedStepRunner(this.clock, () => {}, { dt: 1 / 60, lookahead: LOOKAHEAD, maxCatchUp: 0.5 })
      this.cursor = 0
      this.cursorTime = ctx.currentTime + 0.1
      this.timer = window.setInterval(() => this.tick(), TICK_MS)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.emit()
  }

  /** Start the transport, opening the audio context first if needed. */
  async play() {
    await this.start()
    if (this.ctx) this.cursorTime = Math.max(this.cursorTime, this.ctx.currentTime + 0.05)
    this.setState({ playing: true })
  }

  stop() {
    this.setState({ playing: false })
  }

  /** Back to the top of the spiral without touching the pattern. */
  rewind() {
    if (!this.ctx) return
    this.cursor = 0
    this.cursorTime = this.ctx.currentTime + 0.05
    this.emit()
  }

  private stepSeconds() {
    // one turn is one bar, however many steps it is divided into
    return (60 / this.state.bpm) * (4 / this.state.spiral.stepsPerTurn)
  }

  /** Walk the grid ahead of the audio clock and voice what is due. */
  private tick() {
    const ctx = this.ctx
    if (!ctx || !this.nodes || !this.assets) return
    this.runner?.tick()
    if (!this.state.playing) {
      // keep the cursor next to the clock so PLAY starts immediately
      this.cursorTime = Math.max(this.cursorTime, ctx.currentTime + 0.05)
      return
    }
    const horizon = ctx.currentTime + LOOKAHEAD
    const cfg = this.state.spiral
    const total = Math.max(1, cfg.stepsPerTurn * cfg.turns)
    let guard = 0
    while (this.cursorTime < horizon && guard++ < 64) {
      const idx = ((this.cursor % total) + total) % total
      const step = idx % cfg.stepsPerTurn
      const turn = Math.floor(idx / cfg.stepsPerTurn)
      const stepSec = this.stepSeconds()
      const at = this.cursorTime + swingOffset(step, this.state.swing, stepSec)
      for (const h of hitsAt(this.pattern, step, turn, cfg)) {
        if (this.state.mutes[h.track]) continue
        this.voice(h, at)
      }
      this.cursor++
      this.cursorTime += stepSec
    }
    // trim the flash log
    const cutoff = ctx.currentTime - 1.5
    if (this.recent.length > 96) this.recent = this.recent.filter((r) => r.time > cutoff)
    this.emit()
  }

  private voice(h: Hit, t: number) {
    const kit = KITS[this.state.kit]
    const m = this.state.macros
    const macros: KitMacros = { tune: m.tune, grit: m.grit, decay: m.decay, space: m.space, punch: m.punch, spiral: h.spiral }
    // the kick drives the sidechain, so it must duck before it sounds
    if (h.track === 'kick') this.duck(t, h.velocity)
    try {
      kit.voice(h, t, this.nodes!, this.assets!, macros)
    } catch {
      /* a single bad hit must never stop the transport */
    }
    this.recent.push({ track: h.track, step: h.step, turn: h.turn, velocity: h.velocity, time: t })
  }

  /** Seeded re-roll of the whole pattern, biased to the kit's character. */
  randomize() {
    const rnd = createPrng((Date.now() ^ this.state.spiral.seed) >>> 0)
    const n = this.state.spiral.stepsPerTurn
    const base = seedPattern(this.state.kit, n)
    const p = emptyPattern(n)
    for (const t of TRACKS) {
      for (let i = 0; i < n; i++) {
        const keep = base[t][i] > 0 ? 0.72 : 0.12
        if (rnd.next() < keep) p[t][i] = clamp(0.45 + rnd.next() * 0.55, 0, 1)
      }
    }
    this.setState({ spiral: { ...this.state.spiral, seed: rnd.int(9999) } })
    this.setPattern(p)
  }

  clear() {
    this.setPattern(emptyPattern(this.state.spiral.stepsPerTurn))
  }

  /** Load the factory figure for a kit (called when the kit changes). */
  loadKitPattern(kit: KitId) {
    this.setPattern(seedPattern(kit, this.state.spiral.stepsPerTurn))
  }

  snapshot(): Snapshot {
    const ctx = this.ctx
    const cfg = this.state.spiral
    const total = Math.max(1, cfg.stepsPerTurn * cfg.turns)
    let pos = 0
    if (ctx && this.state.playing) {
      // where the audio clock is, not where the scheduler has got to
      const ahead = (this.cursorTime - ctx.currentTime) / this.stepSeconds()
      pos = ((this.cursor - ahead) % total + total) % total
    }
    return {
      now: ctx?.currentTime ?? 0,
      step: pos % cfg.stepsPerTurn,
      turn: Math.floor(pos / cfg.stepsPerTurn),
      position: pos / total,
      running: this.state.playing && ctx?.state === 'running',
      level: this.chain?.level() ?? 0,
      recent: this.recent,
    }
  }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    void this.ctx?.close()
    this.ctx = null
  }
}

export const machine = new Machine()
