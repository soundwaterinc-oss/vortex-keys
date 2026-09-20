import type { NoteSink, PitchedNote } from './sink'

/**
 * Microtonal MIDI mapping: nearest 12-TET note + pitch bend in cents.
 * With a ±2 semitone bend range any cents value maps exactly; per-note bend
 * requires one channel per sounding note (MPE-style rotation over ch 2–16).
 */
export function centsToMidi(cents: number, rootMidi: number): { note: number; bendCents: number } {
  const semis = cents / 100
  const note = Math.round(rootMidi + semis)
  return { note, bendCents: (rootMidi + semis - note) * 100 }
}

/** 14-bit pitch bend value for a cents offset given the bend range in semitones. */
export function bendValue(bendCents: number, rangeSemis = 2): number {
  const v = Math.round(8192 + (bendCents / (rangeSemis * 100)) * 8191)
  return Math.max(0, Math.min(16383, v))
}

/**
 * Minimal MPE-style sink for Web MIDI (one note per channel, bend per channel).
 * Not wired into the UI yet; `instrument.addSink(new MidiSink(output, rootMidi))`.
 * Timing: Web MIDI takes a DOMHighResTimeStamp; we convert from audio time
 * using the offset captured at construction.
 */
export class MidiSink implements NoteSink {
  private chan = new Map<string, number>()
  private next = 1 // channels 1..15 (0-based) => MIDI ch 2..16
  constructor(
    private out: { send(data: number[], timestamp?: number): void },
    private rootMidi: number,
    private audioToPerf: (t: number) => number = (t) => performance.now() + t * 1000,
  ) {}
  noteOn(n: PitchedNote, time: number) {
    const ch = this.next
    this.next = (this.next % 15) + 1
    this.chan.set(n.id, ch)
    const { note, bendCents } = centsToMidi(n.cents, this.rootMidi)
    const b = bendValue(bendCents)
    const ts = this.audioToPerf(time)
    this.out.send([0xe0 | ch, b & 0x7f, b >> 7], ts)
    this.out.send([0x90 | ch, note & 0x7f, Math.round(n.velocity * 127)], ts)
    ;(n as PitchedNote & { _midiNote?: number })._midiNote = note
  }
  noteOff(id: string, time: number) {
    const ch = this.chan.get(id)
    if (ch === undefined) return
    this.chan.delete(id)
    // note number is unknown here; send all-notes-off on that channel
    this.out.send([0xb0 | ch, 123, 0], this.audioToPerf(time))
  }
  allNotesOff() {
    for (let ch = 0; ch < 16; ch++) this.out.send([0xb0 | ch, 123, 0])
    this.chan.clear()
  }
}

/**
 * OSC-ish sink: posts JSON messages to a WebSocket bridge (e.g. a tiny node
 * process forwarding to TouchDesigner / Max via UDP OSC). Address layout:
 *   /vortex/note/on  id degree octave cents hz velocity generated
 *   /vortex/note/off id
 */
export class OscBridgeSink implements NoteSink {
  constructor(private socket: { send(data: string): void }) {}
  noteOn(n: PitchedNote, time: number) {
    this.socket.send(JSON.stringify({ address: '/vortex/note/on', time, args: [n.id, n.note.degree, n.note.octave, n.cents, n.frequencyHz, n.velocity, n.generated ? 1 : 0] }))
  }
  noteOff(id: string, time: number) {
    this.socket.send(JSON.stringify({ address: '/vortex/note/off', time, args: [id] }))
  }
  allNotesOff() {
    this.socket.send(JSON.stringify({ address: '/vortex/allnotesoff', args: [] }))
  }
}
