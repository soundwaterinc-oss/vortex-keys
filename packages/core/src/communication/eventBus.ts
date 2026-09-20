/**
 * Internal communication between instruments (and, later, bridges to
 * MIDI/OSC/WebSocket). Instruments publish what happened; nothing here
 * knows what any subscriber does with it.
 */
export interface SystemEvent<T = unknown> {
  sourceInstrument: string
  type: string
  timestamp: number
  payload: T
}

export type SystemEventType =
  | 'notePlayed'
  | 'noteReleased'
  | 'particleSpawned'
  | 'gateCrossed'
  | 'orbitHit'
  | 'wavePeak'
  | 'syncChanged'
  | 'energyChanged'
  | (string & {})

type Handler<T = unknown> = (e: SystemEvent<T>) => void

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

export function makeEvent<T>(sourceInstrument: string, type: SystemEventType, timestamp: number, payload: T): SystemEvent<T> {
  return { sourceInstrument, type, timestamp, payload }
}
