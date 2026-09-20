# VORTEX KEYS / Spiral Resonator

An experimental browser instrument in which **pitch, tuning, geometry, physical
motion and rhythm are one system**. You play notes on a spiral keyboard; each
note can enter a physical model (gravity vortex, Kepler orbit, wave field,
coupled oscillators, logistic chaos) whose motion, through a configurable
musical mapping, generates further notes. It is playable first, generative second: at
FLOW 0% it is a microtonal spiral synthesizer, at 100% a single touch can
develop into an autonomous pattern.

Local-first: `npm run dev`, open the URL, press **start audio** (or click a
node), play.

## Concept

- The spiral is the tuning made visible. One revolution = one octave, so every
  scale degree owns a radial axis regardless of how many degrees the scale has
  or how unequal its steps are.
- The vortex sits inside the spiral. A played note spawns a particle on the
  spawn ring at its own degree axis, which is then pulled inward, spinning
  faster as it approaches the centre.
- Gates are radial lines. Each crossing transforms the particle's note *by
  scale degree* (never semitones) and sounds it.
- Nothing on screen moves unless the model moved it: the renderer draws a
  snapshot of the simulation and the active voice list.

## Architecture

```
Performer input  ─▶  PhysicsModel.step()  ─▶  PhysicsEvent[] (semantic)  ─▶  MusicalMapper
                     (bodies, snapshots)       gate / phase / threshold /       pitch · velocity ·
                                               periapsis / extrema / sync …     timbre · trigger
                                                                                     │
Synth ◀─ Scheduler (quantize, lookahead) ◀─ GeneratedEvent[] ◀─ PhysicsFlow (limits) ◀┘
```

A physics model never calls the synth and never knows what a scale is. It
updates bodies, each carrying a `PhysicsSnapshot` (r, θ, ω, dr/dt, |a|,
energy, phase, curvature, value, slope, age) and a `MusicalIdentity`
(degree/octave/velocity from the performer), and emits `PhysicsEvent`s. The
`MusicalMapper` turns one event + snapshot into pitch, velocity, timbre and
a trigger decision. `PhysicsFlow` glues them, enforces rate limits and keeps
the monitor sample. Physics presets (mode + params) and mapping presets are
independent fields of the state, so *Kepler Orbit + Gravity Bass* or
*Chaos + Spiral Melody* are just two dropdowns.

```
src/
  core/
    physics/
      types.ts        PhysicsSnapshot, PhysicsEvent, PhysicsBody, PhysicsModel, GlobalMacros
      normalize.ts    normalize / mapRange / clamp01 / curve / applyCurve (linear, exp, invExp, scurve)
      frame.ts        shared angular frame: degree axis ↔ angle
      gravity.ts      Gravity Vortex           (mode 'vortex')
      orbit.ts        Kepler-like orbits       (mode 'orbit')
      wavefield.ts    spatial interference     (mode 'wave')
      coupled.ts      Kuramoto oscillators     (mode 'coupled')
      chaos.ts        logistic map             (mode 'chaos')
    mapping/
      types.ts        MappingConfig, MappingContext, MusicalMapper, Pitch/TimbreInstruction
      mapper.ts       ConfigurableMapper — the one mapper, driven by MappingConfig
      presets.ts      mapping presets (Spiral Melody, Gravity Bass, Spectral Orbit, Swarm Pulse, …)
    flow/
      types.ts        FlowModel (what the Instrument steps), GeneratedEvent
      physicsFlow.ts  PhysicsModel + MusicalMapper → FlowModel, event-rate limits, monitor sample
      gates.ts        Gate, applyGate (scale-degree transposition)
      manual.ts       no generation
    tuning/ spiral/ clock/ preset/ math/     (cents, spiral geometry, quantize, presets, PRNG)
  audio/    sink.ts (NoteSink/PitchedNote), synth.ts, models.ts, midiSink.ts
  engine/instrument.ts   state, model construction, fixed-step scheduler, sinks
  visual/renderer.ts     one visual identity per model, drawn from the snapshot only
  ui/                    Panel (left), Transport (top), Monitor (physics monitor), SpiralCanvas
tests/                   vitest: tuning, spiral, prng, quantize, presets, physics, mapping, midi
scripts/smoke.mjs        playwright: plays every model, cross-maps, mode-switches, screenshots
```

## How to run

```
npm install
npm run dev        # Vite dev server
npm test           # vitest (pure logic)
npm run build      # tsc --noEmit + vite build -> dist/
npm run preview    # serve dist on :4173
node scripts/smoke.mjs   # headless Chromium: click nodes, switch modes, screenshot (needs preview on :4179)
```

Modern desktop Chrome/Edge/Firefox/Safari. AudioContext is created only on
the first click.

## Controls

**Spiral**: click/tap = note on, release = off, drag across nodes = glissando,
multi-touch. Degree numbers ring the outside; the tonic axis is 12 o'clock.

**Transport**: SUSTAIN · LATCH · FREEZE (physics stops, audio tails continue)
· CLEAR (generated state) · PANIC · RANDOMIZE (new seed, params of every
model) · RESET (re-initialise phases / x0 deterministically) · MONITOR ·
SAVE / LOAD.

**FLOW**: mode MAN / VORTEX / ORBIT / WAVE / COUPLED / CHAOS, the large
**FLOW** amount, four global macros, the mapping preset, and an *advanced*
fold with the model's physical parameters, gates (vortex/orbit) and limits.

| macro | meaning | vortex | orbit | wave | coupled | chaos |
|---|---|---|---|---|---|---|
| ENERGY | activity | spawn chance, slower decay | slower decay | lower threshold | faster base rate | faster iteration |
| ORDER↔CHAOS | regularity | turbulence | e/size jitter, drift | detunes ratios toward irrational | lowers K, widens spread | moves r toward 4 |
| TIME | temporal scale ×0.5…×2 | ω, pull | mean motion, precession | field time | all rates | iteration rate |
| SPACE | spread | spawn radius | orbit size | source ring radius | (width via mapper) | (width via mapper) |

**Physics monitor** (MONITOR): the last mapped event's normalised r, θ, ω,
dr/dt, accel, energy, phase, curvature, value, then the mapper's result
(pitch, velocity, brightness, width, trigger status), event rates
(physics/s, notes/s, dropped) and the model globals (R, x, …). Polled at 15 Hz.

## Physics architecture and equations

All models step at a fixed dt = 1/120 s, 120 ms ahead of the audio clock.
Radius 1 = the spawn ring (innermost spiral radius on screen). All
randomness comes from one seeded PRNG: same seed + params + input = same
output (tested).

**Gravity Vortex** (simulation, simplified)
```
dθ/dt = ω0 · (1 / max(r, rmin))^α · (1 + turb·ξ)     ω0 from SPIN (rev/beat ↔ rev/s by TEMPO)
dr/dt = −pull + turb·ξ′
E     = E · decay^dt ;  E ·= (1 − energyLoss) per gate crossing
events: gateCrossing (θ passes a gate), centerEntry (r ≤ rmin → dies)
```

**Orbit** (kinematic Kepler solution, not force integration)
```
M += n·dt ;  E − e·sin E = M (Newton) ;  ν = 2·atan2(√(1+e) sin E/2, √(1−e) cos E/2) ;  r = a(1 − e cos E)
θ = ϖ + ν ;  ϖ += precession·dt ;  (e, a) drift sinusoidally with a seeded phase
events: periapsis (M wraps 2π), apoapsis (M crosses π), quadrant (optional), gateCrossing
```
Speed near periapsis vs apoapsis follows from the solution itself (tested
> 3× at e = 0.7). Bodies do not interact; the interface leaves room for it.

**Wave Field** (artistic approximation: no dispersion or attenuation)
```
wave_i(p, t) = A_i · sin(k_i·|p − s_i| − 2π(f_i t + φ_i)),  k_i = 2π/λ_i,  f_i = ratio_i · RATE / beat
field(p, t)  = Σ wave_i / Σ|A_i|      ∈ [−1, 1]
```
Sources sit on a ring; probes are placed by the performer (degree axis,
octave radius). Events per probe: thresholdCrossing ± (crossings only),
extrema (local max/min with |f| > thr/2), nullCrossing (|f| falls below
nullLevel). Irrational ratios are a rhythmic mapping, not physics.

**Coupled Oscillators** (Kuramoto, N ≤ 16)
```
dθ_i/dt = ω_i + (K/N) Σ_j sin(θ_j − θ_i) ;  R·e^{iψ} = (1/N) Σ e^{iθ_j}
events: phaseCrossing (θ_i wraps 0), sync (R crosses syncThreshold, direction ±)
```
R is exposed as global `R` for mappings (pitch range, brightness, width).

**Chaos** (deterministic logistic map)
```
x[n+1] = r·x[n]·(1 − x[n]),  clamped to (0,1), iterated at RATE per beat
xs += (x − xs)·(1 − smoothing) per iteration
events: thresholdCrossing ± on xs; extrema of xs, fired only when the
        accumulated |Δxs| since the last extrema event > 0.15 / sensitivity
```
One iteration is deliberately *not* one note: smoothing and the travel
floor turn the raw sequence into graded event density. Later models
(Lorenz, Rössler, double pendulum, cellular automata) only need to produce
snapshots and events of the same types.

## Mapping system

`MappingConfig` fields and what they read:

| field | options |
|---|---|
| pitchSource | `angle` (nearest degree axis) · `radius` (inner = high degree) · `identity` (the performer's note) · `gate` (identity transformed by the gate action, incl. child spawn) · `value` (x · n) |
| registerSource | `none` · `radius` · `radiusInverse` · `speed` · `slope` · `sync` · `valueDelta`, over `registerSpan` octaves |
| velocitySource | `energy` · `angularVelocity` · `constant` · `amplitude` · `distanceFromHalf` · `phaseVelocity`, shaped by `velocityCurve` |
| timbreSource | `radius` · `radiusInverse` · `energy` · `acceleration` · `sync` · `slope` · `constant` → brightness |
| widthSource | `constant` · `syncInverse` · `radius` → stereo width |
| triggerOn / accentOn | lists of PhysicsEvent types |
| pitchRangeFromSync | high R folds degrees toward the tonic |

Velocity is always multiplied by the performer's velocity and by FLOW, so
FLOW 0 % is silent generation and the performer stays in charge. Sources a
model does not produce read as neutral (value 0, R 0), which is the point of
cross-combinations: the same simulation heard differently.

## How to implement another FlowModel (physics)

1. Create `src/core/physics/<name>.ts` implementing `PhysicsModel<P>`:
   `step(dt, now, ctx)` updates bodies' `snapshot`/`prev` and returns
   `PhysicsEvent[]`; `inject(identity, ctx, now)` receives performed notes;
   `bodies()`, `globals()`, `visual()`, `clear()`, `setFrozen()`; optional
   `spawnChild`, `reset`. Use only `ctx.prng` for randomness and read
   `ctx.macros` for ENERGY/CHAOS/TIME/SPACE.
2. Add the mode to `FlowMode` and a params slice in `preset/types.ts`,
   defaults + ranges in `preset/presets.ts` (sanitizer).
3. Construct it in `Instrument.rebuildFlow` and push params in `pushFlowParams`.
4. Draw its state in `visual/renderer.ts` from `snap.visual` and add an
   advanced block in `ui/Panel.tsx`.
Existing mappings work immediately as long as the snapshot fields are filled.

## How to implement another MusicalMapper

Either add a `MappingConfig` to `mapping/presets.ts` (no code), or implement
`MusicalMapper` (`shouldTrigger`, `mapPitch`, `mapVelocity`, `mapTimbre`)
and construct it in `Instrument.rebuildFlow`/`pushFlowParams` in place of
`ConfigurableMapper`. `mapPitch` may update `ctx.identity` and set
`ctx.requestChild`; nothing else in the physics is reachable from a mapper.

## Known performance limits

| limit | default | where |
|---|---|---|
| generated notes / s | 24 (per preset `limits`) | PhysicsFlow sliding window |
| events / simulation step | 6, lowest energy dropped first | PhysicsFlow |
| particles (vortex) | 48 | GravityParams.maxParticles |
| children per parent / generation depth | 3 / 3 | GravityParams |
| orbiters | 24 | OrbitParams.maxOrbiters |
| probes (wave) | 8 | WaveFieldParams.maxProbes |
| oscillators | 16 | CoupledParams.maxCount |
| synth voices | 24, steal releasing first | SynthEngine |
| catch-up after tab hidden | skip, never burst | Instrument.tick |

Cost per step: gravity/orbit O(bodies × gates), wave O(probes × sources),
coupled O(N²) with N ≤ 16, chaos O(1). The wave field visual samples a
56×56 grid per frame (≈19k sin per frame with 6 sources); it is the most
expensive view and is rendered only in wave mode.

## Tuning representation

`Scale { id, name, cents[], ratios?, source?, approximation?, period? }`.
Cents are canonical; ratios document exact sources. Non-octave periods are
supported (Bohlen–Pierce example). Scales labelled *approximation* are
12-TET/24-TET simplifications of pitch collections associated with a
tradition and do not claim to represent that tradition's musical system.
Scala `.scl` / `.kbm` import only needs to produce this shape.

Output abstraction: every sounded note is a `PitchedNote { note, frequencyHz,
cents, rootHz, velocity, brightness, generated }` sent to a `NoteSink`. The
synth is one sink; `midiSink.ts` shows an MPE-style MIDI sink (nearest note +
per-channel pitch bend from `cents`) and an OSC-over-WebSocket bridge sink.
`instrument.addSink(...)` fans out.

## Current limitations

- No Scala import UI, no MIDI input; MIDI/OSC sinks exist but are not wired to the UI.
- Scheduling runs on a main-thread timer with 120 ms lookahead (AudioWorklet seam: `Instrument.tick`).
- Gates are edited by count/action, not dragged; no per-gate probability UI.
- No crossfade between two flow models; a `CrossfadeFlow` wrapping two `PhysicsFlow`s and scaling their velocities would fit the `FlowModel` interface without redesign.
- Orbiters do not interact (no N-body).
- Presets store parameters, not bodies in flight.

## Roadmap

draggable gates · Scala import · Web MIDI/MPE and OSC bridge wiring ·
AudioWorklet scheduler · Lorenz / Rössler / double pendulum / CA models ·
model crossfade · recording/export · QWERTY mapping.
