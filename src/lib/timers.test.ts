import { describe, expect, it } from 'vitest'
import { CHIME } from './motion'
import {
  add,
  chimeSlot,
  ended,
  endOf,
  formatLeft,
  formatOvertime,
  fraction,
  lead,
  long,
  names,
  nextTick,
  order,
  overtime,
  pause,
  remaining,
  resume,
  start,
  type Timer,
} from './timers'

const MIN = 60_000
const now = Date.UTC(2026, 10, 19, 15, 22)
const timer = (id: string, endsAt: number, more: Partial<Timer> = {}): Timer => ({
  id,
  kind: 'timer',
  endsAt,
  total: 25 * MIN,
  ...more,
})

describe('start', () => {
  it('ends that long from now, with its label', () => {
    const t = start(25 * MIN, now, 'pâtes')
    expect(t).toMatchObject({ kind: 'timer', endsAt: now + 25 * MIN, total: 25 * MIN, label: 'pâtes' })
    expect(formatLeft(t, now)).toBe('25:00')
  })

  it('leaves out an empty label, and never gives two timers the same id', () => {
    const [a, b] = [start(MIN, now), start(MIN, now, '')]
    expect('label' in b).toBe(false)
    expect(a.id).not.toBe(b.id)
  })
})

describe('pause and resume', () => {
  it('freezes the time left, and ends that much later once resumed', () => {
    const paused = pause(start(25 * MIN, now), now + 5 * MIN)
    expect(paused.left).toBe(20 * MIN)
    // Ten minutes later, nothing has moved.
    expect(remaining(paused, now + 15 * MIN)).toBe(20 * MIN)
    expect(formatLeft(paused, now + 15 * MIN)).toBe('20:00')
    const resumed = resume(paused, now + 15 * MIN)
    expect('left' in resumed).toBe(false)
    expect(resumed.endsAt).toBe(now + 35 * MIN)
    expect(remaining(resumed, now + 16 * MIN)).toBe(19 * MIN)
  })

  it('never ends while paused, however old its end: it has no end until it resumes', () => {
    // A paused timer keeps the end it had when it was paused, now in the past: it means nothing while `left` is set.
    const paused = pause(timer('t', now + MIN), now)
    expect(ended(paused, now + 60 * MIN)).toBe(false)
    expect(chimeSlot(paused, now + 60 * MIN)).toBeUndefined()
    expect(endOf(paused, now + 60 * MIN)).toBe(now + 61 * MIN)
  })

  it('leaves alone a timer already paused, already running, or already ended', () => {
    const paused = timer('t', 0, { left: MIN })
    expect(pause(paused, now)).toBe(paused)
    const running = timer('t', now + MIN)
    expect(resume(running, now)).toBe(running)
    const done = timer('t', now - 1)
    expect(pause(done, now)).toBe(done)
    // At its very last millisecond it has already ended: nothing is left to freeze.
    expect(pause(timer('t', now), now).left).toBeUndefined()
  })
})

describe('add', () => {
  it('pushes the end of a running timer and fills its ring', () => {
    const t = add(timer('t', now + MIN), 5 * MIN, now)
    expect(t).toMatchObject({ id: 't', endsAt: now + 6 * MIN, total: 30 * MIN })
    expect(fraction(t, now)).toBeCloseTo(6 / 30)
  })

  it('adds to a paused timer and keeps it paused', () => {
    const t = add(timer('t', 0, { left: MIN }), 5 * MIN, now)
    expect(t).toMatchObject({ id: 't', left: 6 * MIN, total: 30 * MIN })
    expect(ended(t, now + 60 * MIN)).toBe(false)
  })

  it('starts a timer that ended over, under its name and a new id', () => {
    const t = add(timer('t', now - 3 * MIN, { label: 'pâtes' }), MIN, now)
    expect(t).toMatchObject({ kind: 'timer', endsAt: now + MIN, total: MIN, label: 'pâtes' })
    expect(t.id).not.toBe('t')
  })
})

describe('ended, remaining and the ring', () => {
  it('ends at its very millisecond', () => {
    const t = timer('t', now)
    expect(ended(t, now - 1)).toBe(false)
    expect(ended(t, now)).toBe(true)
    expect(remaining(t, now + 5000)).toBe(0)
    expect(overtime(t, now + 5000)).toBe(5000)
    expect(overtime(t, now - 5000)).toBe(0)
  })

  it('empties the ring from full to nothing', () => {
    const t = start(10 * MIN, now)
    expect(fraction(t, now)).toBe(1)
    expect(fraction(t, now + 5 * MIN)).toBe(0.5)
    expect(fraction(t, now + 20 * MIN)).toBe(0)
    expect(fraction({ ...t, total: 0 }, now)).toBe(0)
  })

  it('needs the hours once the digits read an hour, as the countdown rounds up', () => {
    expect(long(timer('t', now + 3_599_000), now)).toBe(false)
    expect(long(timer('t', now + 3_599_001), now)).toBe(true)
    expect(formatLeft(timer('t', now + 3_599_001), now)).toBe('1:00:00')
  })

  it('counts from the wall clock, so a sleep or a change of daylight saving time changes nothing', () => {
    // Paris moves its clocks forward at 01:00 UTC on 29 March 2026: a 2-hour timer across it still lasts 2 hours.
    const before = Date.UTC(2026, 2, 29, 0, 30)
    const t = start(2 * 60 * MIN, before)
    expect(remaining(t, before + 60 * MIN)).toBe(60 * MIN)
    // Woken after the end, the page finds it ended by the same rule, with no tick missed or added.
    expect(ended(t, before + 3 * 60 * MIN)).toBe(true)
    expect(formatOvertime(overtime(t, before + 3 * 60 * MIN))).toBe('+1:00:00')
  })
})

describe('order and lead', () => {
  it('sorts by end, a paused timer ending its time left from now', () => {
    const [soon, paused, later] = [
      timer('soon', now + MIN),
      timer('p', 0, { left: 2 * MIN }),
      timer('l', now + 3 * MIN),
    ]
    expect(order([later, paused, soon], now).map((t) => t.id)).toEqual(['soon', 'p', 'l'])
  })

  it('leads with the running timer that ends first, never a paused or ended one', () => {
    const [done, paused, later] = [timer('d', now - 1), timer('p', 0, { left: 1000 }), timer('l', now + 3 * MIN)]
    expect(lead([done, paused, later], now)?.id).toBe('l')
    expect(lead([done, paused], now)).toBeUndefined()
  })
})

describe('chimes', () => {
  it('chimes at the end, then every 10 s for a minute, then stays silent', () => {
    const t = timer('t', now)
    expect(chimeSlot(t, now - 1)).toBeUndefined()
    expect(chimeSlot(t, now)).toBe(0)
    expect(chimeSlot(t, now + 9_999)).toBe(0)
    expect(chimeSlot(t, now + 10_000)).toBe(1)
    expect(chimeSlot(t, now + 59_999)).toBe(CHIME.times - 1)
    expect(chimeSlot(t, now + 60_000)).toBeUndefined()
  })

  it('stays silent for a timer that ended long ago, such as one found after the PC slept', () => {
    expect(chimeSlot(timer('t', now - 3 * MIN), now)).toBeUndefined()
  })
})

describe('nextTick', () => {
  it('waits for nothing at rest, or with only a paused timer', () => {
    expect(nextTick([], [], now)).toBeUndefined()
    const paused = timer('p', 0, { left: MIN })
    expect(nextTick([paused], [paused], now)).toBeUndefined()
  })

  it('wakes once a second for a timer on screen, in step with its end', () => {
    const t = timer('t', now + 10_300)
    expect(nextTick([t], [t], now)).toBe(300)
  })

  it('wakes only for the end of a timer off screen', () => {
    const t = timer('t', now + 5 * MIN)
    expect(nextTick([t], [], now)).toBe(5 * MIN)
  })

  it('wakes for each chime, then for nothing once they are over', () => {
    const t = timer('t', now - 12_000)
    expect(nextTick([t], [], now)).toBe(8_000)
    expect(nextTick([t], [], now + 48_000)).toBeUndefined()
    // On screen, the time since the end keeps counting.
    expect(nextTick([t], [t], now + 48_000)).toBe(1000)
  })

  it('wakes for the soonest of several', () => {
    const [a, b] = [timer('a', now + 2 * MIN), timer('b', now + MIN)]
    expect(nextTick([a, b], [], now)).toBe(MIN)
  })
})

describe('formatOvertime', () => {
  it('counts up from +0:00, a second at a time', () => {
    expect(formatOvertime(0)).toBe('+0:00')
    expect(formatOvertime(999)).toBe('+0:00')
    expect(formatOvertime(12_900)).toBe('+0:12')
    expect(formatOvertime(190_000)).toBe('+3:10')
    expect(formatOvertime(2 * 3_600_000 + 14 * MIN)).toBe('+2:14:00')
    expect(formatOvertime(-5)).toBe('+0:00')
  })
})

describe('names', () => {
  it('names a timer by its label', () => {
    expect(names([timer('t', now, { label: 'pâtes' })], 'fr').get('t')).toBe('pâtes')
  })

  it('leaves a lone timer without a label unnamed, and numbers several by creation', () => {
    expect(names([timer('a', now)], 'fr').size).toBe(0)
    const list = [timer('a', now + 2 * MIN), timer('l', now, { label: 'thé' }), timer('b', now + MIN)]
    expect([...names(list, 'fr')]).toEqual([
      ['a', 'Minuteur 1'],
      ['l', 'thé'],
      ['b', 'Minuteur 2'],
    ])
    expect(names(list, 'en').get('b')).toBe('Timer 2')
  })
})
