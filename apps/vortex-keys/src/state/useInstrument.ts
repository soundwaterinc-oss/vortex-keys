import { createContext, useContext, useSyncExternalStore } from 'react'
import { Instrument } from '../engine/instrument'

/** Standalone app instance. ENSEMBLE provides its own through InstrumentContext. */
export const defaultInstrument = new Instrument()
export const InstrumentContext = createContext<Instrument>(defaultInstrument)

export function useInstrument(): Instrument {
  return useContext(InstrumentContext)
}

export function useInstrumentState() {
  const inst = useInstrument()
  return useSyncExternalStore(
    (l) => inst.subscribe(l),
    () => inst.getState(),
  )
}
