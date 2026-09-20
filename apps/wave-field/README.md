# WAVE FIELD (planned)

Role: harmony / drone / resonance / spatial sound.

Not implemented yet. The architecture already provides what it needs:

- physics: `WaveFieldModel` in `@el-systema/physics` (sources, probes, threshold / extrema / null events, `fieldAt`)
- mapping: a drone-oriented `MappingConfig` (amplitude → drone intensity, slope → brightness, probe position → pitch)
- audio: `SynthEngine` with `breath` / `pad` voices on the shared `MasterChain`, later a continuous-voice engine
- interface: a field the performer places and drags wave sources in — not a keyboard
- bus: reacts to `orbitHit` (an impulse excites a source) and publishes `wavePeak` / `energyChanged`

See `docs/ARCHITECTURE.md` → "Path to WAVE FIELD".
