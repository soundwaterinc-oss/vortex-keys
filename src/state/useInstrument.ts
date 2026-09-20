import { useSyncExternalStore } from 'react'
import { Instrument } from '../engine/instrument'

/** Single instrument instance for the app (module singleton). */
export const instrument = new Instrument()

export function useInstrumentState() {
  return useSyncExternalStore(
    (l) => instrument.subscribe(l),
    () => instrument.getState(),
  )
}
