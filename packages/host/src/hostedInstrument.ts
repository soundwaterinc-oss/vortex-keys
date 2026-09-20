import type { SystemEvent } from '@el-systema/core'
import type { EnsembleHost } from './ensembleHost'

/**
 * What ENSEMBLE needs from an instrument — and nothing more. Both engines
 * implement this directly; standalone apps call `start()` with a host they
 * created themselves.
 */
export interface HostedInstrument<S = unknown> {
  readonly id: string
  start(host: EnsembleHost): Promise<void> | void
  stop(): void
  handleSystemEvent(event: SystemEvent): void
  getState(): S
  setState(state: Partial<S>): void
}
