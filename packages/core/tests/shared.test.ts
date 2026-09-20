import { describe, it, expect } from 'vitest'
import { deriveSeed, createPrng, beatsToSeconds, secondsToBeats, ManualClock, SourceClock, MusicalEventQueue, FixedStepRunner, EventBus, makeEvent } from '../src'

describe('derived seeds', () => {
  it('same global seed + id -> same seed; different id -> different', () => {
    expect(deriveSeed(1234, 'vortex-keys')).toBe(deriveSeed(1234, 'vortex-keys'))
    expect(deriveSeed(1234, 'vortex-keys')).not.toBe(deriveSeed(1234, 'orbit'))
    expect(deriveSeed(1234, 'orbit')).not.toBe(deriveSeed(1235, 'orbit'))
  })
  it('derived streams are independent and reproducible', () => {
    const a = createPrng(deriveSeed(7, 'a'))
    const b = createPrng(deriveSeed(7, 'b'))
    const a2 = createPrng(deriveSeed(7, 'a'))
    const xs = [a.next(), a.next(), a.next()]
    expect(xs).toEqual([a2.next(), a2.next(), a2.next()])
    expect(xs).not.toEqual([b.next(), b.next(), b.next()])
  })
})

describe('clock', () => {
  it('beat/second conversion', () => {
    expect(beatsToSeconds(2, 120)).toBe(1)
    expect(secondsToBeats(1.5, 120)).toBe(3)
  })
  it('manual + source clocks count beats from origin', () => {
    const m = new ManualClock(120)
    m.advance(2)
    expect(m.nowBeats()).toBe(4)
    let t = 10
    const s = new SourceClock(() => t, 60)
    t = 13
    expect(s.nowSeconds()).toBe(13)
    expect(s.nowBeats()).toBe(3)
    s.reset()
    expect(s.nowBeats()).toBe(0)
  })
})

describe('scheduler', () => {
  it('queue drains in time order with stable ties', () => {
    const q = new MusicalEventQueue<string>()
    q.push({ time: 2, type: 'n', payload: 'c' })
    q.push({ time: 1, type: 'n', payload: 'a' })
    q.push({ time: 1, type: 'n', payload: 'b' })
    q.push({ time: 3, type: 'n', payload: 'd' })
    expect(q.drain(2).map((e) => e.payload)).toEqual(['a', 'b', 'c'])
    expect(q.size).toBe(1)
    expect(q.drain(10).map((e) => e.payload)).toEqual(['d'])
  })
  it('fixed-step runner steps in exact dt regardless of tick cadence', () => {
    const run = (ticks: number[]) => {
      const c = new ManualClock(120)
      const steps: number[] = []
      const r = new FixedStepRunner(c, (dt, t) => steps.push(t), { dt: 0.01, lookahead: 0.05, maxCatchUp: 1 })
      for (const d of ticks) {
        c.advance(d)
        r.tick()
      }
      return steps
    }
    const a = run([0.02, 0.02, 0.02, 0.02, 0.02])
    const b = run([0.05, 0.05])
    expect(a).toEqual(b)
    for (let i = 1; i < a.length; i++) expect(a[i] - a[i - 1]).toBeCloseTo(0.01, 9)
  })
  it('runner skips instead of bursting after a long stall', () => {
    const c = new ManualClock(120)
    let n = 0
    const r = new FixedStepRunner(c, () => n++, { dt: 0.01, lookahead: 0.05, maxCatchUp: 1 })
    c.advance(30)
    r.tick()
    expect(n).toBeLessThan(20)
  })
})

describe('event bus', () => {
  it('delivers typed and any-subscriptions, unsubscribes', () => {
    const bus = new EventBus()
    const got: string[] = []
    const off = bus.on('notePlayed', (e) => got.push(`np:${e.sourceInstrument}`))
    bus.onAny((e) => got.push(`any:${e.type}`))
    bus.emit(makeEvent('vortex-keys', 'notePlayed', 0, {}))
    bus.emit(makeEvent('orbit', 'orbitHit', 1, {}))
    off()
    bus.emit(makeEvent('vortex-keys', 'notePlayed', 2, {}))
    expect(got).toEqual(['np:vortex-keys', 'any:notePlayed', 'any:orbitHit', 'any:notePlayed'])
  })
})
