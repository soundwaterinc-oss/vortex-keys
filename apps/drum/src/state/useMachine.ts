import { useSyncExternalStore } from 'react'
import { machine } from '../engine/machine'

/** The machine is the source of truth; React only re-renders on its emit. */
export function useMachineState() {
  return useSyncExternalStore(
    (fn) => machine.subscribe(fn),
    () => machine.state,
  )
}

/** Pattern identity changes whenever a step is edited. */
export function usePattern() {
  return useSyncExternalStore(
    (fn) => machine.subscribe(fn),
    () => machine.pattern,
  )
}

export { machine }
