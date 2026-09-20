/**
 * Internal communication between instruments (and, later, bridges to
 * MIDI/OSC/WebSocket). Instruments publish what happened; nothing here
 * knows what any subscriber does with it.
 *
 * Naming: events are namespaced by their source — `vortex.notePlayed`,
 * `orbit.gateCrossed`, `ensemble.orbitSpawnRequested` — never bare
 * `note` / `trigger`, so a system with many instruments stays legible.
 */
export interface EventMeta {
  /** instrument (or router) that originally caused the chain */
  origin: string
  /** 0 = direct performer action; +1 for every cross-instrument hop */
  generation: number
  eventId: string
  parentEventId?: string
}

export interface SystemEvent<T = unknown> {
  sourceInstrument: string
  type: string
  timestamp: number
  payload: T
  meta: EventMeta
}

/** Cross-instrument hops allowed before a chain is dropped (feedback protection). */
export const MAX_EVENT_GENERATION = 2

export type SystemEventType =
  | 'vortex.notePlayed'
  | 'vortex.noteReleased'
  | 'vortex.particleSpawned'
  | 'vortex.gateCrossed'
  | 'vortex.physicsEvent'
  | 'ensemble.orbitSpawnRequested'
  | 'ensemble.tempoChanged'
  | 'ensemble.tuningChanged'
  | 'ensemble.seedChanged'
  | 'ensemble.reset'
  | 'orbit.bodySpawned'
  | 'orbit.gateCrossed'
  | 'orbit.periapsis'
  | 'orbit.apoapsis'
  | 'orbit.noteGenerated'
  | (string & {})

type Handler<T = unknown> = (e: SystemEvent<T>) => void

let eventCounter = 0
/** Monotonic ids: deterministic within a session, unique across the bus. */
export function nextEventId(prefix = 'e'): string {
  return `${prefix}${++eventCounter}`
}

export class EventBus {
  private handlers = new Map<string, Set<Handler>>()
  private any = new Set<Handler>()

  on<T = unknown>(type: SystemEventType, h: Handler<T>): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(h as Handler)
    return () => this.off(type, h)
  }
  off<T = unknown>(type: SystemEventType, h: Handler<T>) {
    this.handlers.get(type)?.delete(h as Handler)
  }
  /** Subscribe to every event (bridges, loggers). */
  onAny(h: Handler): () => void {
    this.any.add(h)
    return () => this.any.delete(h)
  }
  /** Subscribe to every event of a namespace, e.g. 'orbit.' */
  onNamespace(prefix: string, h: Handler): () => void {
    const wrapped: Handler = (e) => {
      if (e.type.startsWith(prefix)) h(e)
    }
    return this.onAny(wrapped)
  }
  emit<T = unknown>(e: SystemEvent<T>) {
    const set = this.handlers.get(e.type)
    if (set) for (const h of Array.from(set)) h(e as SystemEvent)
    for (const h of Array.from(this.any)) h(e as SystemEvent)
  }
  clear() {
    this.handlers.clear()
    this.any.clear()
  }
}

/** A root event: generation 0, origin = the emitting instrument. */
export function makeEvent<T>(sourceInstrument: string, type: SystemEventType, timestamp: number, payload: T): SystemEvent<T> {
  return { sourceInstrument, type, timestamp, payload, meta: { origin: sourceInstrument, generation: 0, eventId: nextEventId() } }
}

/**
 * An event caused by another event (cross-instrument response): keeps the
 * origin, increments the generation, links the parent. Returns null when the
 * chain would exceed MAX_EVENT_GENERATION — the caller must then not act.
 */
export function deriveEvent<T>(
  parent: SystemEvent,
  sourceInstrument: string,
  type: SystemEventType,
  timestamp: number,
  payload: T,
  maxGeneration = MAX_EVENT_GENERATION,
): SystemEvent<T> | null {
  const generation = parent.meta.generation + 1
  if (generation > maxGeneration) return null
  return {
    sourceInstrument,
    type,
    timestamp,
    payload,
    meta: { origin: parent.meta.origin, generation, eventId: nextEventId(), parentEventId: parent.meta.eventId },
  }
}

/**
 * An event that continues an existing chain *without* a new hop: e.g. an
 * orbit body spawned by a request emits its gate crossings at the request's
 * generation. Only a routing rule adds a generation.
 */
export function continueEvent<T>(meta: EventMeta, sourceInstrument: string, type: SystemEventType, timestamp: number, payload: T): SystemEvent<T> {
  return { sourceInstrument, type, timestamp, payload, meta: { origin: meta.origin, generation: meta.generation, eventId: nextEventId(), parentEventId: meta.eventId } }
}

export const eventNamespace = (type: string) => type.split('.')[0]
