import type { FlowSettings } from '../preset/types'
import { ManualModel, PhysicsFlow, ConfigurableMapper, getMapping, type FlowModel } from '@el-systema/mapping'
import { GravityModel, OrbitModel, WaveFieldModel, CoupledModel, ChaosModel, type PhysicsModel } from '@el-systema/physics'

/**
 * VORTEX KEYS' curated combination table: which physics model each mode
 * uses, wrapped with the selected mapping. Pure — no audio, no DOM — so the
 * same settings always yield the same flow (see tests/determinism.test.ts).
 */
export function createFlow(f: FlowSettings, octaves: number, frozen = false): FlowModel {
  let physics: PhysicsModel | null = null
  switch (f.mode) {
    case 'vortex':
      physics = new GravityModel({ ...f.vortex, gates: f.gates })
      break
    case 'orbit':
      physics = new OrbitModel({ ...f.orbit, gates: f.gates })
      break
    case 'wave':
      physics = new WaveFieldModel({ ...f.wave, ratios: [...f.wave.ratios] })
      break
    case 'coupled':
      physics = new CoupledModel({ ...f.coupled })
      break
    case 'chaos':
      physics = new ChaosModel({ ...f.chaos })
      break
  }
  let flow: FlowModel
  if (physics) {
    const pf = new PhysicsFlow(physics, new ConfigurableMapper(getMapping(f.mappingId)), { ...f.macros }, { ...f.limits })
    pf.octaves = octaves
    flow = pf
  } else {
    flow = new ManualModel()
  }
  flow.setFrozen(frozen)
  return flow
}

/** Push parameter edits into a live flow without resetting its state. */
export function pushFlowParams(flow: FlowModel, f: FlowSettings, octaves: number) {
  if (!(flow instanceof PhysicsFlow)) return
  flow.macros = { ...f.macros }
  flow.limits = { ...f.limits }
  flow.octaves = octaves
  if (flow.mapper.config.id !== f.mappingId) flow.mapper = new ConfigurableMapper(getMapping(f.mappingId))
  const ph = flow.physics
  if (ph instanceof GravityModel) Object.assign(ph.params, f.vortex, { gates: f.gates })
  else if (ph instanceof OrbitModel) Object.assign(ph.params, f.orbit, { gates: f.gates })
  else if (ph instanceof WaveFieldModel) Object.assign(ph.params, f.wave, { ratios: [...f.wave.ratios] })
  else if (ph instanceof CoupledModel) Object.assign(ph.params, f.coupled)
  else if (ph instanceof ChaosModel) Object.assign(ph.params, f.chaos)
}
