# EL-SYSTEMA INSTRUMENT FAMILY — architecture

> One ecosystem, several instruments, one shared set of natural laws.
> Each instrument is a distinct species in the same world.

## Philosophy

Nature and mathematics provide common laws. Each instrument interprets those
laws differently. The same gravity-vortex model means *increasing note
density* to VORTEX KEYS, *changing orbital rhythm* to ORBIT, *movement of
wave sources* to WAVE FIELD and *clustering* to SWARM. The code therefore
separates three questions that are easy to confuse:

| question | package |
|---|---|
| **What happens in nature?** | `@el-systema/physics` — models, state, semantic events; knows nothing about sound or scales |
| **What does that mean musically?** | `@el-systema/mapping` — pitch, velocity, timbre, trigger decisions from physics events |
| **How does a specific instrument use it?** | `apps/*` — curated physics × mapping × sound combinations, interaction surface, visuals |

and keeps four axes independent:

```
PHYSICS   Vortex · Orbit · Wave · Coupled · Chaos
MAPPING   Spiral Melody · Gravity Bass · Spectral Orbit · Swarm Pulse · Chaotic Melody · Pulse · …
SOUND     Glass · Pluck · Wood · Breath · Pad (shared voice library, instrument-selected subsets)
INSTRUMENT  VORTEX KEYS · ORBIT · WAVE FIELD · SWARM
```

`Vortex + Spiral Melody + Glass + VORTEX KEYS` is one behaviour;
`Orbit + Pulse + Wood + ORBIT` is another. Each instrument ships a curated
subset of the combination space so it keeps a strong identity.

## Instrument roles

| instrument | role | interaction surface | status |
|---|---|---|---|
| VORTEX KEYS | melody / pitch / expressive playing | spiral keyboard | complete (primary app) |
| ORBIT | rhythm / pulse / percussion | orbital dial | prototype (proof of shared core) |
| WAVE FIELD | harmony / drone / resonance / space | spatial wave field | planned — physics & mapping exist |
| SWARM | macro structure / emergent organisation | agents / phase view | planned — physics & mapping exist |

## Diagram

```
                        GLOBAL CORE  (@el-systema/core)
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
     TUNING                 TIME                 STATE
  cents/ratios/        MusicalClock ·        GlobalState ·
  degree wrap ·        FixedStepRunner ·     InstrumentState ·
  Scala-ready          MusicalEventQueue ·   deriveSeed ·
                       quantize              EventBus
       │                     │                     │
       └──────────────┬──────┴──────────────┬─────┘
                      │                     │
                   PHYSICS               MAPPING
            (@el-systema/physics)  (@el-systema/mapping)
                      │                     │
                      └──────────┬──────────┘
                                 ↓
                         MUSICAL EVENTS  (GeneratedEvent / PitchedNote)
                                 │
                            SCHEDULER  (quantizeTime → NoteSink @ audio time)
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       ↓                         ↓                         ↓
 VORTEX KEYS                  ORBIT                  WAVE FIELD
       │                         │                         │
    melody                    rhythm                  harmony
       └─────────────────────────┼─────────────────────────┘
                                 ↓
                               SWARM
                         macro organization
```

Data flow inside any instrument:

```
Input → Physics model → PhysicsSnapshot + PhysicsEvent[] → MusicalMapper
      → GeneratedEvent[] → quantize/schedule → instrument sound engine → MasterChain → output
```

## Folder / package structure

```
packages/
  core/        math (prng, util, normalize) · tuning · time (clock, quantize, scheduler)
               state (GlobalState, InstrumentState, deriveSeed) · communication (EventBus)
               instrument (InstrumentDefinition contract)
  physics/     types (PhysicsSnapshot, PhysicsEvent, PhysicsModel, GlobalMacros) · frame
               gravity · orbit · wavefield · coupled · chaos · gates
  mapping/     MappingConfig · ConfigurableMapper · generic mapping presets
               flow/ (FlowModel, PhysicsFlow adapter with rate limits, ManualModel)
  audio/       NoteSink/PitchedNote · dsp (noise, impulse, MasterChain) · voices (shared voice
               library) · SynthEngine (voice management) · midiSink (MPE + OSC bridge stubs)
  shared-ui/   Section/Slider/Select/Toggle/Segmented + base.css (palette, panel/stage/transport layout)
apps/
  vortex-keys/ spiral geometry · presets (VORTEX's curated state) · Instrument engine
               flowFactory (mode → physics × mapping) · renderer · Panel/Transport/Monitor
  orbit/       OrbitEngine · ORBIT-specific mappings (Pulse, Apsides) · dial canvas · panel
  wave-field/  README only (planned)
  swarm/       README only (planned)
scripts/       assemble-dist (/, /orbit/) · smoke tests (playwright)
docs/          this file
```

Dependency direction (no cycles):

```
core  ←  physics  ←  mapping  ←  apps
core  ←  audio               ←  apps
core  ←  shared-ui           ←  apps
```

`physics` imports only `core`. `mapping` imports `core` + `physics`.
`audio` imports only `core` (for clamping). Apps import everything; packages
never import apps.

Packages are consumed as TypeScript source through npm workspaces (`main:
src/index.ts`); there is no build step per package. Vite and vitest resolve
them through the workspace symlinks.

## Shared clock

`MusicalClock { bpm, nowSeconds(), nowBeats(), origin }`.
`SourceClock` wraps any monotonic source — in the browser the
`AudioContext.currentTime`, so scheduled notes land on the audio clock.
`FixedStepRunner` advances a simulation in exact `dt` steps ahead of the
clock (lookahead 120 ms) from any timer; frame rate never enters.
`quantizeTime(t, mode, grid, bpm, origin)` is applied per instrument:

| instrument | default timing |
|---|---|
| VORTEX KEYS | FREE (the mathematics is the rhythm) |
| ORBIT | HARD 1/16 (tempo-synced) |
| WAVE FIELD | FREE |
| SWARM | partial (SOFT) |

All still reference the same `origin` and `bpm`, so a future ENSEMBLE host
can hand one clock to all of them.

## Deterministic seeds

`deriveSeed(globalSeed, instrumentId)` gives each instrument an
independent, reproducible PRNG stream from one global seed. Inside
generative code only `ctx.prng` is used; `Math.random()` appears only in
RANDOMIZE (which picks a new seed and then is deterministic again).
`apps/vortex-keys/tests/determinism.test.ts` replays every factory preset
twice and requires identical event streams.

## Communication

`EventBus` carries `SystemEvent { sourceInstrument, type, timestamp, payload }`.
Instruments publish; nothing on the bus knows subscribers. Current emitters:

| instrument | events |
|---|---|
| VORTEX KEYS | `notePlayed`, `noteReleased`, `gateCrossed`, `syncChanged`, `wavePeak`, plus every other physics event type verbatim (`periapsis`, `centerEntry`, …) |
| ORBIT | `orbitHit`, `particleSpawned` |

Planned cross-instrument reactions, all expressible as bus subscriptions:

```
VORTEX KEYS notePlayed   → ORBIT.launch(degree)            (a note becomes a rhythm object)
ORBIT orbitHit/periapsis → WAVE FIELD impulse on a source  (a hit excites the field)
WAVE FIELD energyChanged → VORTEX KEYS COLOR / brightness  (field amplitude colours the notes)
SWARM syncChanged (R)    → every instrument's density      (coherence organises the system)
```

External bridges (Web MIDI/MPE, OSC over WebSocket, TouchDesigner, Max,
Ableton) attach with `bus.onAny(...)`; `audio/midiSink.ts` already shows the
note-level MIDI and OSC-bridge sinks.

## State

`GlobalState` (tempo, masterGain, tuningId, rootFrequency, seed) is what
an ensemble shares. `InstrumentState<P>` is opaque per instrument. VORTEX
KEYS' `Preset` is its own richer instrument state; ORBIT's `OrbitState` is
tiny. A `PresetState` bundles both for a future ENSEMBLE save file.

## Instrument contract

```ts
interface InstrumentDefinition<S> {
  id; name; role: 'melody' | 'rhythm' | 'harmony' | 'structure'
  createState(): S
  attach(host: { clock, bus, global, audio }): void
  detach(): void
  handleMusicalEvent(e: MusicalEvent): void
  serializeState(): S
  loadState(data: unknown): void
}
```

Neither app implements it *formally* yet (both expose the equivalent
methods on their engine classes: start/dispose, setState/loadPreset, bus,
clock). Wrapping them is the first step of the ENSEMBLE host — see
"technical debt".

## Adding a new instrument

1. `apps/<name>/` with `package.json` depending on the `@el-systema/*` packages, `vite.config.ts` (`base: './'`), `index.html`, `src/main.tsx`.
2. Choose a physics model from `@el-systema/physics` (or add one there — it must stay sound-free).
3. Write the instrument's curated `MappingConfig`s in `src/mappings.ts` (instrument-specific presets) or reuse generic ones from `@el-systema/mapping`.
4. Engine: `SourceClock` on the AudioContext, `FixedStepRunner`, `PhysicsFlow(physics, mapper)`, quantize with the instrument's default timing, sound through `SynthEngine` (or a bespoke voice engine) on a `MasterChain`. Seed with `deriveSeed(globalSeed, id)`. Publish on the `EventBus`.
5. Interaction surface + visuals drawn only from the engine snapshot; shared controls from `@el-systema/shared-ui`, `@import` its `base.css`.
6. Register the app in root `package.json` scripts and `scripts/assemble-dist.mjs`; add tests under `apps/<name>/tests`.

ORBIT (`apps/orbit`, ~350 lines) is the template.

## Technical debt (introduced or kept, deliberately)

- **Stateful physics models.** `PhysicsModel` keeps state inside the instance (`step(dt, now, ctx)` mutates bodies) rather than the pure `step(state, params, dt) → { state, events }` form. Converting five working models was not worth the risk in this pass; the interface is small enough to migrate one model at a time.
- **Instrument contract not yet implemented** by the two engines; both have the equivalent surface. Formalising it is the first ENSEMBLE step.
- **Two schedulers.** VORTEX KEYS schedules straight into the `NoteSink` (Web Audio orders by time); ORBIT goes through `MusicalEventQueue`. Both are correct; VORTEX KEYS should adopt the queue when it grows a second sink.
- **Shared voice library lives in `audio/voices.ts`**; instruments choose a subset by convention, not by type.
- **CSS shared by `@import` of a package file path** (`@el-systema/shared-ui/src/base.css`) rather than a proper style export.
- **No ENSEMBLE app yet.** Both apps create their own AudioContext, clock and bus.

## Next recommended refactor

Introduce the ENSEMBLE host in three small moves: (1) wrap `Instrument` and
`OrbitEngine` in `InstrumentDefinition` adapters that accept an
`InstrumentHost` instead of creating their own AudioContext/clock/bus;
(2) one `MasterChain` per host with per-instrument input gains; (3) a
`apps/ensemble` page that mounts both canvases on one clock and subscribes
`notePlayed → orbit.launch`. Nothing in the packages needs to change.

## Path to WAVE FIELD

- Physics: `WaveFieldModel` already has sources, probes and threshold/extrema/null events. Add a `sources` mutation API (move / add / remove / impulse) — the performer manipulates sources, not notes.
- Mapping: a drone mapping (`amplitude → drone intensity`, `slope → brightness`, `probe position → pitch`, `nullCrossing → release`).
- Audio: a continuous-voice engine (sine/breath/pad drones whose gain follows `field` at each probe rather than note on/off) on the shared `MasterChain`.
- Interface: the field grid renderer from VORTEX KEYS' wave view becomes the instrument surface; drag = move source, click = add, hold = impulse.
- Bus: subscribe `orbitHit → impulse(source)`; publish `energyChanged`.

## Path to SWARM

- Physics: `CoupledModel` (R, ψ, `sync` events) plus `ChaosModel`; add attraction/repulsion positions later (agents on a plane) without changing the event vocabulary.
- Mapping: `swarm-pulse` exists; add a "conductor" mapping whose output is not notes but control events (`density`, `brightness`) for other instruments.
- Controls: ORDER↔CHAOS, COUPLING, ENERGY, DENSITY, DRIFT, SPACE map onto `GlobalMacros` + `CoupledParams` one-to-one.
- Interface: the phase-ring view from VORTEX KEYS' coupled mode, with agents draggable to kick phases.
- Bus: publish `syncChanged` with R; ENSEMBLE maps R to every instrument's FLOW amount.

## Simulation vs artistic approximation

| model | status |
|---|---|
| Gravity vortex | simplified simulation: (1/r)^α spin-up, constant pull, exponential energy |
| Orbit | exact two-body kinematics (Kepler solution); drift/precession are artistic |
| Wave field | artistic: point-source interference without dispersion/attenuation; irrational ratios are a rhythmic device |
| Coupled | Kuramoto model, faithful for N ≤ 16 |
| Chaos | exact logistic map; smoothing + travel-floor event extraction is artistic |
