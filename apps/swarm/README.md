# SWARM (planned)

Role: macro structure / emergent rhythm / conductor.

Not implemented yet. The architecture already provides what it needs:

- physics: `CoupledModel` (Kuramoto, order parameter R, `sync` events) and `ChaosModel` in `@el-systema/physics`
- mapping: `swarm-pulse` mapping preset (R → pitch range / brightness / width)
- controls: ORDER↔CHAOS, COUPLING, ENERGY, DENSITY, DRIFT, SPACE are already the `GlobalMacros` + `CoupledParams`
- bus: publishes `syncChanged` / `energyChanged`; an ENSEMBLE host can map R to other instruments' density

See `docs/ARCHITECTURE.md` → "Path to SWARM".
