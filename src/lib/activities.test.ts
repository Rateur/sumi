import { describe, expect, it } from 'vitest'
import { CLOCK, arrange, peeks, stillPicked, type Activity } from './activities'
import { pause, type Timer } from './timers'

const call: Activity = { id: 'call', kind: 'call', mic: true, camera: false }
// Running for as long as the tests take.
const timer: Activity = { id: 'timer', kind: 'timer', endsAt: Number.MAX_SAFE_INTEGER, total: 60_000 }
const song = (id: string): Activity => ({ id, kind: 'music', title: id, artist: '', color: '#fff' })
const [a, b] = [song('a'), song('b')]

describe('arrange', () => {
  it('leaves the island to the clock when nothing runs', () => {
    expect(arrange([])).toEqual({ island: undefined, bubble: undefined, waiting: [] })
  })

  it('gives the island to a call, the bubble to a timer and makes music wait', () => {
    expect(arrange([a, timer, call])).toEqual({ island: call, bubble: timer, waiting: [a] })
  })

  it('puts the time in the bubble beside a lone activity, and on the island once picked', () => {
    expect(arrange([a])).toEqual({ island: a, bubble: CLOCK, waiting: [] })
    expect(arrange([a], arrange([a]), 'clock')).toEqual({ island: undefined, bubble: a, waiting: [] })
  })

  it('makes the time wait while two activities share the island and the bubble', () => {
    expect(arrange([a, b])).toEqual({ island: a, bubble: b, waiting: [] })
    expect(arrange([a, b], undefined, 'clock')).toEqual({ island: undefined, bubble: a, waiting: [b] })
  })

  it('lets a higher priority take the island from what is shown', () => {
    const shown = arrange([a])
    expect(arrange([a, timer], shown)).toEqual({ island: timer, bubble: a, waiting: [] })
  })

  it('keeps arrival order between equals', () => {
    expect(arrange([a, b])).toEqual({ island: a, bubble: b, waiting: [] })
  })

  it('keeps what is shown in place between equals', () => {
    const shown = arrange([b, a])
    expect(arrange([a, b], shown)).toEqual({ island: b, bubble: a, waiting: [] })
  })

  it('moves what had the island to the bubble, ahead of an equal that waited', () => {
    const c = song('c')
    const shown = arrange([a, b, c])
    expect(arrange([c, b, a, timer], shown)).toEqual({ island: timer, bubble: a, waiting: [b, c] })
  })

  it('gives the island to the one picked from the bubble, but never ahead of a call', () => {
    const shown = arrange([a, b])
    expect(arrange([a, b], shown, 'b')).toEqual({ island: b, bubble: a, waiting: [] })
    expect(arrange([a, timer], undefined, 'a')).toEqual({ island: a, bubble: timer, waiting: [] })
    expect(arrange([a, call], undefined, 'a')).toEqual({ island: call, bubble: a, waiting: [] })
  })

  it('hands the island back when the higher priority ends', () => {
    const shown = arrange([timer, a])
    expect(arrange([a], shown)).toEqual({ island: a, bubble: CLOCK, waiting: [] })
  })
})

describe('arrange with timers', () => {
  const now = 1_000_000
  const at = (id: string, endsAt: number, more: Partial<Timer> = {}): Timer => ({
    id,
    kind: 'timer',
    endsAt,
    total: 600_000,
    ...more,
  })

  it('gives the island to the running timer and the bubble to the music', () => {
    const t = at('t', now + 60_000)
    expect(arrange([a, t], undefined, undefined, now)).toEqual({ island: t, bubble: a, waiting: [] })
  })

  it('puts a paused timer below the music, so a forgotten pause never takes the island back', () => {
    const paused = at('p', 0, { left: 60_000 })
    expect(arrange([a, paused], undefined, undefined, now)).toEqual({ island: a, bubble: paused, waiting: [] })
    expect(arrange([paused], undefined, undefined, now)).toEqual({ island: paused, bubble: CLOCK, waiting: [] })
  })

  it('ranks only the timer that ends first as a timer: the others wait below the music, soonest first', () => {
    const [soon, later, last] = [at('soon', now + 60_000), at('later', now + 120_000), at('last', now + 180_000)]
    expect(arrange([last, a, later, soon], undefined, undefined, now)).toEqual({
      island: soon,
      bubble: a,
      waiting: [later, last],
    })
    expect(arrange([last, later, soon], undefined, undefined, now)).toEqual({
      island: soon,
      bubble: later,
      waiting: [last],
    })
  })

  it('sorts timers by their end, not by what was shown', () => {
    const [soon, later] = [at('soon', now + 60_000), at('later', now + 120_000)]
    const shown = arrange([later], undefined, undefined, now)
    expect(arrange([later, soon], shown, undefined, now).island).toBe(soon)
  })

  it('lets a timer that ended take the island from the one picked, but not from a call', () => {
    const done = at('done', now - 1000)
    expect(arrange([a, done], undefined, 'a', now)).toEqual({ island: done, bubble: a, waiting: [] })
    expect(arrange([a, done, call], undefined, 'a', now)).toEqual({ island: call, bubble: done, waiting: [a] })
  })

  it('gives the island to the latest end, even when two end in the same second', () => {
    const [first, second] = [at('first', now - 900), at('second', now - 100)]
    expect(arrange([second, first], undefined, undefined, now)).toEqual({
      island: second,
      bubble: first,
      waiting: [],
    })
  })

  it('lets a fresh end take the island from a done pill shown for minutes', () => {
    const old = at('old', now - 300_000)
    const shown = arrange([old, at('fresh', now + 1000)], undefined, undefined, now)
    expect(shown.island).toBe(old)
    const fresh = at('fresh', now - 10)
    expect(arrange([old, fresh], shown, undefined, now)).toEqual({ island: fresh, bubble: old, waiting: [] })
  })

  it('keeps a timer paused from its panel on the island until the panel closes', () => {
    const t = pause(at('t', now + 60_000), now)
    expect(arrange([a, t], undefined, undefined, now, 't').island).toBe(t)
    expect(arrange([a, t], undefined, undefined, now).island).toBe(a)
    const other = at('other', now + 120_000)
    expect(arrange([t, other], undefined, undefined, now, 't').island).toBe(t)
    expect(arrange([t, other], undefined, undefined, now).island).toBe(other)
  })

  it('still lets a timer that ends take the island from an open panel', () => {
    const [t, done] = [at('t', now + 60_000), at('done', now - 1)]
    expect(arrange([t, done], undefined, undefined, now, 't').island).toBe(done)
  })

  it('takes the island at the very millisecond a timer ends', () => {
    const t = at('t', now)
    expect(arrange([a, t], undefined, 'a', now - 1).island).toBe(a)
    expect(arrange([a, t], undefined, 'a', now).island).toBe(t)
  })
})

describe('stillPicked', () => {
  const t: Activity = { id: 't', kind: 'timer', endsAt: 1, total: 1 }

  it('keeps a timer picked while it is there, music or not', () => {
    expect(stillPicked('t', [t])).toBe('t')
    expect(stillPicked('t', [a])).toBeUndefined()
  })

  it('keeps the time picked while anything runs', () => {
    expect(stillPicked('clock', [t])).toBe('clock')
    expect(stillPicked('clock', [])).toBeUndefined()
    expect(stillPicked(undefined, [a])).toBeUndefined()
  })
})

describe('peeks', () => {
  it('peeks anything while you are free', () => {
    expect(peeks(a, 'shown')).toBe(true)
  })

  it('lets only a call and a timer that ended through while you are busy', () => {
    expect(peeks(call, 'quiet')).toBe(true)
    expect(peeks(a, 'quiet')).toBe(false)
    expect(peeks(timer, 'quiet')).toBe(false)
    const done: Activity = { id: 'done', kind: 'timer', endsAt: 1000, total: 1000 }
    expect(peeks(done, 'quiet', 999)).toBe(false)
    expect(peeks(done, 'quiet', 1000)).toBe(true)
  })

  it('shows nothing while hidden, not even a timer that ended', () => {
    expect(peeks(call, 'hidden')).toBe(false)
    expect(peeks({ id: 'done', kind: 'timer', endsAt: 0, total: 1000 }, 'hidden', 1000)).toBe(false)
  })
})
