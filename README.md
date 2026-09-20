# VORTEX KEYS / Spiral Resonator

An experimental browser instrument in which **pitch, tuning, geometry, physical
motion and rhythm are one system**. You play notes on a spiral keyboard; each
note can become a particle in a vortex; the particle's trajectory through
trigger gates generates further notes. A second generative model derives
rhythm from interfering waves. It is playable first, generative second: at
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
src/
  core/                      pure logic, no DOM, no React (unit-tested)
    math/prng.ts             seeded mulberry32 PRNG + string hash
    math/util.ts             clamp / finite / wrapAngle / crossedAngle
    tuning/types.ts          Scale (cents + optional ratios), ScaleNote
    tuning/tuning.ts         noteToFrequency, wrapDegree, transposeNote, ...
    tuning/scales.ts         factory tuning library
    spiral/spiral.ts         spiral coordinates, fitLayout, hitTest
    flow/types.ts            FlowModel, GeneratedEvent, FlowContext
    flow/gates.ts            Gate, applyGate (degree transposition)
    flow/vortex.ts           VortexModel (particles, gates, limits)
    flow/wave.ts             WaveModel (summed oscillators, threshold crossings)
    flow/manual.ts           ManualModel (no generation)
    clock/quantize.ts        FREE / SOFT / HARD timing
    preset/types.ts          Preset / InstrumentState
    preset/presets.ts        factory presets + JSON sanitizer
  audio/
    sink.ts                  NoteSink + PitchedNote: the output abstraction
    models.ts                5 sound models: macros -> voice parameters
    synth.ts                 SynthEngine (Web Audio, polyphonic, protected bus)
    midiSink.ts              MPE-style MIDI sink + OSC bridge sink (not wired to UI)
  engine/instrument.ts       Instrument: state, flow model, scheduler, sinks
  visual/renderer.ts         Canvas 2D renderer (reads a snapshot, draws)
  state/useInstrument.ts     React binding (useSyncExternalStore)
  ui/                        Panel (left), Transport (top), SpiralCanvas
tests/                       vitest unit tests for core + midi mapping
scripts/smoke.mjs            playwright smoke test against `vite preview`
```

Conceptual systems from the brief map as: TuningEngine → `core/tuning`,
SpiralKeyboard → `core/spiral` + `ui/SpiralCanvas`, SynthEngine →
`audio/synth`, FlowEngine → `core/flow/types` + `engine/instrument`,
VortexEngine → `core/flow/vortex`, EventScheduler → `Instrument.tick`,
VisualEngine → `visual/renderer`, Preset/State → `core/preset`, UI → `ui/`.

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

**Spiral**: click/tap = note on, release = off, drag across nodes = glissando.
Multi-touch works (one pointer per note). Degree numbers ring the outside;
the tonic axis is at 12 o'clock and tonic nodes have a ring.

**Transport (top)**: SUSTAIN holds released notes until off · LATCH toggles
notes on/off per click · FREEZE stops the flow simulation (audio tails
continue) · CLEAR removes generated particles/pool · PANIC stops everything ·
RANDOMIZE reseeds and randomises flow params · SAVE/LOAD preset JSON.

**TUNING**: scale, root (MIDI note → Hz), number of octaves shown. Changing
tuning silences everything first.

**SOUND**: model (Glass/Bell, Pluck/String, Wood/Mallet, Breath/Soft Reed,
Soft Pad) and macros BODY · AIR · COLOR · DECAY · SPACE · MOTION.

**FLOW**: MANUAL / VORTEX / WAVE, the large **FLOW** amount, and per-model
parameters. Vortex: SPIN, PULL, DECAY, TURB(ulence), DENSITY, TEMPO (how much
SPIN follows BPM), ALPHA, GATES (count + action per gate). Wave: ratio
preset, RATE, THRESH(old), direction ↑ ↓ ↕, and per-component ratio /
amplitude / phase (2–5 components). `seed` reseeds the PRNG.

**TIME**: BPM, FREE / SOFT / HARD, grid 1/4 · 1/8 · 1/16 · 1/8T · 1/16T.

## Mathematical mappings

Spiral (index `i`, scale size `n`):

```
theta  = thetaOffset + 2π i / n
radius = innerRadius + spacing · i
```

Pitch:

```
f = rootHz · 2^((octave · period + cents[degree]) / 1200)      period = 1200 unless the scale says otherwise
```

Vortex (simulation radius 1 = spawn ring, fixed step dt = 1/120 s):

```
ω0     = 2π · SPIN · lerp(1, 1/beatSeconds, TEMPO)      SPIN in rev/beat, blended with rev/s
dθ/dt  = ω0 · (1 / r)^ALPHA  · (1 + turb · ξ)            ξ ~ seeded U(−1,1)
dr/dt  = −PULL + turb · ξ'
E(t+dt)= E · DECAY^dt,  E ·= 0.96 per gate crossing
```

A particle dies when `E < minEnergy`, `age > maxAge`, or `r ≤ coreRadius`.
Crossing detection compares the previous and current angle against each gate
angle, handling the 0/2π seam and both spin directions. Gate actions: repeat,
±1 degree, ±octave, velocity ×1.25 / ×0.7, spawn child (same note, 60%
energy, generation ≤ 3). Event velocity = `v · (0.35 + 0.65 E) · (0.4 + 0.6 FLOW)`,
brightness = `1 − r`, duration = `beat · (0.3 + 0.8 E)`.

Wave:

```
A(t) = Σ aᵢ sin(2π · ratioᵢ · baseHz · t + φᵢ) / Σ |aᵢ|      baseHz = RATE / beatSeconds
```

An event fires only on a threshold *crossing* (rising, falling or both;
`both` also mirrors the threshold at −THRESH). Pitch comes from a pool of the
performer's recent notes taken in rotation; a falling crossing plays the pool
note one scale degree lower. |A| → velocity, |dA/dt| relative to the fastest
component → brightness. Irrational ratios (√2, φ) are an artistic mapping
to non-repeating rhythm, not a physical model.

Timing: the simulation runs ahead of the audio clock by 120 ms in fixed
steps inside a 25 ms timer; generated events carry an audio-clock time.
FREE passes it through, SOFT moves it halfway to the nearest grid point,
HARD snaps to the next grid point. The visual loop (requestAnimationFrame)
never touches timing.

Limits: max particles (default 48), max generated events/s (24 vortex, 16
wave), max voices 24 with steal (releasing tails first), child generation ≤ 3,
all AudioParams pass through `safeParam` (finite + clamped).

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

- No Scala import UI yet; no MIDI input; MIDI/OSC sinks are not wired to the UI.
- Scheduling runs on a main-thread timer (with 120 ms lookahead); an
  AudioWorklet-based scheduler would replace `Instrument.tick`.
- Reverb is a synthetic impulse; no per-model effects.
- Gate angles are edited by count/action only, not dragged.
- Wave history visual is 4.3 s of samples; long-period ratios show partially.
- Presets save flow state only, not particles in flight.

## Roadmap

harmonic-ratio, phyllotaxis/golden-angle, Fibonacci, coupled-oscillator and
logistic-map FlowModels · draggable gates with per-gate probability ·
Scala import · Web MIDI in/out with MPE · OSC bridge process · AudioWorklet
scheduler · recording/export · keyboard (QWERTY) mapping of the spiral.
