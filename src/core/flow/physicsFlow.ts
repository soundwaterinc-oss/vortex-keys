import type { FlowContext, FlowModel, GeneratedEvent, SeedNote } from './types'
import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, PhysicsSnapshot, GlobalMacros } from '../physics/types'
import type { MappingContext, MusicalMapper, PitchInstruction, TimbreInstruction } from '../mapping/types'
import { clamp } from '../math/util'

export interface FlowLimits {
  maxEventsPerSecond: number
  maxEventsPerStep: number
}

export const DEFAULT_LIMITS: FlowLimits = { maxEventsPerSecond: 24, maxEventsPerStep: 6 }

/** What the physics monitor shows: last mapped event with its numbers. */
export interface MonitorSample {
  time: number
  bodyId: string
  eventType: string
  snapshot: PhysicsSnapshot
  pitch: PitchInstruction | null
  velocity: number
  timbre: TimbreInstruction
  triggered: boolean
}

export interface FlowStats {
  /** semantic physics events in the last second */
  physicsEventsPerSecond: number
  /** notes actually generated in the last second */
  notesPerSecond: number
  droppedLastSecond: number
}

/**
 * Adapter: PhysicsModel + MusicalMapper → FlowModel.
 * Physics never touches sound; the mapper never touches physics state except
 * the body's musical identity (gate transposition) and a child request.
 * Event-rate protection lives here so every model gets it for free:
 *   - per-step cap (lowest-energy events dropped first)
 *   - per-second cap (sliding window)
 */
export class PhysicsFlow implements FlowModel {
  readonly id: string
  params = {}
  limits: FlowLimits
  macros: GlobalMacros
  octaves = 4
  private window: number[] = []
  private physWindow: number[] = []
  private dropWindow: number[] = []
  lastSample: MonitorSample | null = null
  /** recent semantic events (for visual flashes) */
  recent: PhysicsEvent[] = []

  constructor(
    public physics: PhysicsModel,
    public mapper: MusicalMapper,
    macros: GlobalMacros,
    limits: FlowLimits = DEFAULT_LIMITS,
  ) {
    this.id = physics.id
    this.macros = macros
    this.limits = limits
  }

  private pctx(ctx: FlowContext): PhysicsContext {
    return { scaleLength: ctx.scaleLength, octaves: this.octaves, beatSeconds: ctx.beatSeconds, amount: ctx.amount, prng: ctx.prng, macros: this.macros }
  }

  setFrozen(f: boolean) {
    this.physics.setFrozen(f)
  }
  clear() {
    this.physics.clear()
    this.recent = []
  }
  reset(ctx: FlowContext) {
    this.physics.reset?.(this.pctx(ctx))
  }
  inject(note: SeedNote, ctx: FlowContext) {
    this.physics.inject({ degree: note.degree, octave: note.octave, velocity: note.velocity }, this.pctx(ctx), note.time)
  }

  stats(now: number): FlowStats {
    const cut = now - 1
    return {
      physicsEventsPerSecond: this.physWindow.filter((t) => t >= cut).length,
      notesPerSecond: this.window.filter((t) => t >= cut).length,
      droppedLastSecond: this.dropWindow.filter((t) => t >= cut).length,
    }
  }

  update(dt: number, now: number, ctx: FlowContext): GeneratedEvent[] {
    const pctx = this.pctx(ctx)
    let events = this.physics.step(dt, now, pctx)
    const cut = now - 1
    this.window = this.window.filter((t) => t >= cut)
    this.physWindow = this.physWindow.filter((t) => t >= cut)
    this.dropWindow = this.dropWindow.filter((t) => t >= cut)
    for (const e of events) this.physWindow.push(e.time)
    if (events.length) {
      this.recent.push(...events)
      if (this.recent.length > 64) this.recent.splice(0, this.recent.length - 64)
    }

    // per-step cap: keep the most energetic events
    if (events.length > this.limits.maxEventsPerStep) {
      events = [...events].sort((a, b) => b.current.energy - a.current.energy)
      for (let i = this.limits.maxEventsPerStep; i < events.length; i++) this.dropWindow.push(now)
      events = events.slice(0, this.limits.maxEventsPerStep)
    }

    const bodies = new Map<string, PhysicsBody>()
    for (const b of this.physics.bodies()) bodies.set(b.id, b)
    const out: GeneratedEvent[] = []
    const globals = this.physics.globals()

    for (const e of events) {
      const body = bodies.get(e.bodyId)
      if (!body) continue
      const mctx: MappingContext = {
        scaleLength: ctx.scaleLength,
        octaves: this.octaves,
        identity: body.identity,
        globals,
        event: e,
        amount: ctx.amount,
        beatSeconds: ctx.beatSeconds,
      }
      const triggered = this.mapper.shouldTrigger(e.prev, e.current, mctx)
      // pitch mapping may transform identity (gate actions) even when the
      // event type does not trigger a note, so the particle keeps evolving
      const pitch = this.mapper.mapPitch(e.current, mctx)
      if (mctx.requestChild) this.physics.spawnChild?.(body.id, pctx, now)
      const velocity = this.mapper.mapVelocity(e.current, mctx)
      const timbre = this.mapper.mapTimbre(e.current, mctx)
      this.lastSample = { time: now, bodyId: body.id, eventType: e.type, snapshot: e.current, pitch, velocity, timbre, triggered }
      if (!triggered || !pitch || ctx.amount <= 0) continue
      if (this.window.length >= this.limits.maxEventsPerSecond) {
        this.dropWindow.push(now)
        continue
      }
      this.window.push(now)
      out.push({
        time: now,
        note: pitch,
        velocity,
        duration: clamp(ctx.beatSeconds * this.mapper.config.durationBeats * (0.5 + e.current.energy), 0.05, 3),
        brightness: timbre.brightness,
        width: timbre.width,
        sourceId: body.id,
      })
    }
    return out
  }
}
