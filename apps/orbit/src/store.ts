import { useSyncExternalStore } from 'react'
import { OrbitEngine } from './engine'

export const engine = new OrbitEngine()
;(window as unknown as { __orbit: OrbitEngine }).__orbit = engine

export function useOrbitState() {
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.state,
  )
}
