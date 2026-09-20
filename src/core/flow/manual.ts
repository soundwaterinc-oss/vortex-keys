import type { FlowModel, GeneratedEvent } from './types'

/** Manual mode: nothing is generated; the spiral is a plain microtonal synth. */
export class ManualModel implements FlowModel<Record<string, never>> {
  readonly id = 'manual'
  params = {} as Record<string, never>
  update(): GeneratedEvent[] {
    return []
  }
  inject() {}
  setFrozen() {}
  clear() {}
}
