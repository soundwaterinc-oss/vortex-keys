import { createContext, useContext, useSyncExternalStore } from 'react'
import { OrbitEngine } from './engine'

/** Standalone app instance. ENSEMBLE provides its own through OrbitContext. */
export const defaultEngine = new OrbitEngine()
export const OrbitContext = createContext<OrbitEngine>(defaultEngine)
;(window as unknown as { __orbit: OrbitEngine }).__orbit = defaultEngine

export function useOrbit(): OrbitEngine {
  return useContext(OrbitContext)
}

export function useOrbitState() {
  const engine = useOrbit()
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.state,
  )
}
