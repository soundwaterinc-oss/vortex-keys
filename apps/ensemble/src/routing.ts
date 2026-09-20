import { EventBus, deriveEvent, createPrng, deriveSeed, clamp, type SystemEvent, type Prng } from '@el-systema/core'
import type { OrbitSpawnRequest } from '@el-systema/orbit'

export interface RoutingState {
  vortexToOrbit: boolean
  /** probability that a played note spawns a body (deterministic, seeded) */
  spawnAmount: number
  /** keep the played degree/octave; off = ORBIT's own fixed identity (tonic) */
  pitchFollow: boolean
  /** how much performed velocity becomes physical energy */
  velocityToEnergy: number
}

export const DEFAULT_ROUTING: RoutingState = { vortexToOrbit: true, spawnAmount: 1, pitchFollow: true, velocityToEnergy: 0.7 }

export interface NotePlayedPayload {
  scaleDegree: number
  octave: number
  frequency: number
  velocity: number
  sourceId?: string
}

/**
 * The ensemble's routing rules. Only explicit rules create cross-instrument
 * events; every derived event goes through `deriveEvent`, which increments
 * the generation and refuses chains deeper than the host limit. Nothing
 * here reacts to `orbit.noteGenerated`, so ORBIT can never feed itself.
 */
export class Router {
  state: RoutingState = { ...DEFAULT_ROUTING }
  private prng: Prng
  private unsub: (() => void) | null = null
  /** counters for diagnostics */
  routed = 0
  dropped = 0

  constructor(
    private bus: EventBus,
    seed: number,
    private now: () => number,
    private maxGeneration = 2,
  ) {
    this.prng = createPrng(deriveSeed(seed, 'routing'))
  }

  reseed(seed: number) {
    this.prng = createPrng(deriveSeed(seed, 'routing'))
  }

  attach() {
    this.detach()
    this.unsub = this.bus.on<NotePlayedPayload>('vortex.notePlayed', (e) => this.onVortexNote(e))
  }
  detach() {
    this.unsub?.()
    this.unsub = null
  }

  /** vortex.notePlayed → ensemble.orbitSpawnRequested (rule 1). */
  onVortexNote(e: SystemEvent<NotePlayedPayload>) {
    const r = this.state
    if (!r.vortexToOrbit) return
    if (r.spawnAmount < 1 && this.prng.next() > r.spawnAmount) return
    const req = this.buildRequest(e.payload, r)
    const out = deriveEvent(e, 'ensemble', 'ensemble.orbitSpawnRequested', this.now(), req, this.maxGeneration)
    if (!out) {
      this.dropped++
      return
    }
    this.routed++
    this.bus.emit(out)
  }

  /** Pure mapping from a played note to a spawn request (tested). */
  buildRequest(p: NotePlayedPayload, r: RoutingState = this.state): OrbitSpawnRequest {
    const v = clamp(p.velocity, 0, 1)
    // VELOCITY → ENERGY: 0% = neutral energy regardless of velocity, 100% = velocity is energy
    const energy = clamp(0.5 + (v - 0.5) * r.velocityToEnergy, 0.05, 1)
    return {
      scaleDegree: r.pitchFollow ? p.scaleDegree : 0,
      octave: r.pitchFollow ? p.octave : 1,
      velocity: v,
      energy,
      sourceId: p.sourceId,
    }
  }
}
