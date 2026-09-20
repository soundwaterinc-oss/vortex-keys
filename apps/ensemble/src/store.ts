import { useSyncExternalStore } from 'react'
import { Ensemble } from './ensemble'

export const ensemble = new Ensemble()
;(window as unknown as { __ensemble: Ensemble }).__ensemble = ensemble

export function useEnsembleUi() {
  return useSyncExternalStore(
    (l) => ensemble.subscribe(l),
    () => ensemble.ui,
  )
}
export function useHostState() {
  return useSyncExternalStore(
    (l) => {
      const a = ensemble.subscribe(l)
      const b = ensemble.host?.subscribe(l)
      return () => {
        a()
        b?.()
      }
    },
    () => ensemble.host?.global ?? null,
  )
}
