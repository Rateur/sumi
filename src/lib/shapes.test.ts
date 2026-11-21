import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import {
  TIMER,
  cardSize,
  drip,
  layout,
  radius,
  resolveView,
  sizeOf,
  timerSize,
  welcomeWidth,
  type TimerFit,
  type Welcome,
} from './shapes'

const music: Activity = { id: 'm', kind: 'music', title: '', artist: '', color: '#fff' }
const timer: Activity = { id: 't', kind: 'timer', endsAt: 0, total: 60_000 }
const call: Activity = { id: 'c', kind: 'call', mic: true, camera: false }
const running: TimerFit = { ended: false, long: false, name: 0, digits: 36 }
const hello: Welcome = { name: 'welcome', step: 'hello', width: 200 }

describe('resolveView', () => {
  const rest = { hovered: false, expanded: false }

  it('shows the clock at rest and adds the date on hover', () => {
    expect(resolveView(rest)).toEqual({ name: 'idle' })
    expect(resolveView({ ...rest, hovered: true })).toEqual({ name: 'hover' })
  })

  it('opens the panel on click, over everything else', () => {
    expect(resolveView({ activity: call, hovered: true, expanded: true, peeking: 'c' })).toEqual({ name: 'expanded' })
  })

  it('opens a running timer into its own panel, of the clock panel size', () => {
    const view = resolveView({ ...rest, activity: timer, expanded: true, timer: running })
    expect(view).toEqual({ name: 'expanded', activity: timer })
    expect(sizeOf(view)).toEqual(sizeOf({ name: 'expanded' }))
  })

  it('never opens a finished timer: it peeks, then stays a done pill', () => {
    const done = { ...running, ended: true }
    expect(resolveView({ ...rest, activity: timer, expanded: true, peeking: 't', timer: done })).toEqual({
      name: 'peek',
      activity: timer,
    })
    expect(resolveView({ ...rest, activity: timer, timer: done })).toMatchObject({ name: 'compact', size: { height: 34 } })
  })

  it('shows the name of a timer under the cursor, and nothing more without one', () => {
    expect(resolveView({ ...rest, hovered: true, activity: timer, timer: running })).toMatchObject({ name: 'compact' })
    const named = { ...running, name: 40 }
    expect(resolveView({ ...rest, hovered: true, activity: timer, timer: named })).toMatchObject({ name: 'hover' })
    expect(resolveView({ ...rest, activity: timer, timer: named })).toMatchObject({ name: 'compact' })
  })

  it('never peeks a running timer, even when asked', () => {
    expect(resolveView({ ...rest, activity: timer, peeking: 't', timer: running })).toMatchObject({ name: 'compact' })
  })

  it('opens music into its own, larger panel', () => {
    const view = resolveView({ activity: music, hovered: false, expanded: true, peeking: 'm' })
    expect(view).toEqual({ name: 'expanded', activity: music })
    expect(sizeOf(view).width).toBeGreaterThan(sizeOf({ name: 'expanded' }).width)
  })

  it('shows an activity compact, even under the cursor', () => {
    expect(resolveView({ ...rest, activity: music, hovered: true })).toEqual({ name: 'compact', activity: music })
  })

  it('opens the command bar, then its answer, over everything else', () => {
    const all = { activity: music, hovered: true, expanded: true, peeking: 'm' }
    expect(resolveView({ ...all, bar: true, launch: true })).toEqual({ name: 'bar' })
    expect(resolveView({ ...all, launch: true })).toEqual({ name: 'launch' })
    expect(resolveView({ ...all, clock: true })).toEqual({ name: 'hover' })
  })

  it('hangs the clipboard history under the bar, 90 px for one row and 250 for five', () => {
    expect(resolveView({ ...rest, bar: true, rows: 2 })).toEqual({ name: 'bar', rows: 2 })
    expect(resolveView({ ...rest, bar: true, rows: 0 })).toEqual({ name: 'bar' })
    expect(resolveView({ ...rest, rows: 2 })).toEqual({ name: 'idle' })
    expect([1, 2, 3, 4, 5].map((rows) => sizeOf({ name: 'bar', rows }))).toEqual(
      [90, 130, 170, 210, 250].map((height) => ({ width: 480, height })),
    )
  })

  it('shows the screen capture over everything but the bar, as a pill measured from its text, 34 px tall', () => {
    const pick = { name: 'capture', step: 'pick', width: 247 } as const
    const all = { activity: call, hovered: true, expanded: true, welcome: hello, launch: true, weather: true }
    expect(resolveView({ ...all, bar: true, capture: pick })).toEqual({ name: 'bar' })
    expect(resolveView({ ...all, capture: pick })).toEqual(pick)
    expect(sizeOf(pick)).toEqual({ width: 247, height: 34 })
  })

  it('shows the weather asked for over everything but the bar and its fold, as a 300 × 56 peek', () => {
    const power = { kind: 'plugged', percent: 5 } as const
    const all = { activity: call, hovered: true, expanded: true, welcome: hello, power }
    expect(resolveView({ ...all, bar: true, weather: true })).toEqual({ name: 'bar' })
    expect(resolveView({ ...all, launch: true, weather: true })).toEqual({ name: 'launch' })
    expect(resolveView({ ...all, weather: true })).toEqual({ name: 'weather' })
    expect(sizeOf({ name: 'weather' })).toEqual({ width: 300, height: 56 })
  })

  it('shows the welcome under the command bar and over everything else, hover included', () => {
    const all = { activity: music, hovered: true, expanded: true, peeking: 'm', clock: true, welcome: hello }
    expect(resolveView({ ...all, bar: true })).toEqual({ name: 'bar' })
    expect(resolveView(all)).toEqual(hello)
    expect(resolveView({ ...rest, hovered: true, welcome: hello })).toEqual(hello)
    expect(resolveView({ ...rest, activity: timer, timer: running, welcome: hello })).toEqual(hello)
  })

  it('drops the welcome in as the empty island, even with a song playing', () => {
    expect(resolveView({ ...rest, activity: music, blank: true })).toEqual({ name: 'idle' })
    expect(resolveView({ ...rest, activity: music, blank: true, welcome: hello })).toEqual(hello)
  })

  it('peeks only the activity that asked for it', () => {
    expect(resolveView({ ...rest, activity: music, peeking: 'm' })).toEqual({ name: 'peek', activity: music })
    expect(resolveView({ ...rest, activity: music, peeking: 't' })).toEqual({ name: 'compact', activity: music })
  })
})

describe('battery peeks', () => {
  const rest = { hovered: false, expanded: false }
  const plugged = { kind: 'plugged', percent: 47 } as const
  const low = { kind: 'low', percent: 20, minutes: null } as const

  it('show over an activity and the time, and under a click', () => {
    expect(resolveView({ ...rest, activity: music, power: low })).toEqual({ name: 'power', power: low })
    expect(resolveView({ ...rest, hovered: true, power: plugged })).toEqual({ name: 'power', power: plugged })
    expect(resolveView({ ...rest, expanded: true, power: low })).toEqual({ name: 'expanded' })
  })

  it("never cover a call or a timer's end peek", () => {
    expect(resolveView({ ...rest, activity: call, power: low })).toEqual({ name: 'compact', activity: call })
    const ended: TimerFit = { ...running, ended: true }
    expect(resolveView({ ...rest, activity: timer, timer: ended, peeking: 't', power: low }).name).toBe('peek')
    expect(resolveView({ ...rest, activity: timer, timer: ended, power: low }).name).toBe('power')
  })

  it("take the music's compact shape to plug in and as a device connects, and a song's peek when low", () => {
    const device = { name: 'JBL Flip 6', kind: 'speaker', percent: 45 } as const
    expect(sizeOf({ name: 'power', power: plugged })).toEqual({ width: 200, height: 34 })
    expect(sizeOf({ name: 'power', power: { kind: 'device', device } })).toEqual({ width: 200, height: 34 })
    expect(sizeOf({ name: 'power', power: low })).toEqual({ width: 300, height: 56 })
    expect(sizeOf({ name: 'power', power: { kind: 'deviceLow', device } })).toEqual({ width: 300, height: 56 })
  })

  it('open the batteries panel at its own size, over everything a panel covers', () => {
    const batteries = { width: 360, height: 164 }
    expect(resolveView({ ...rest, expanded: true, activity: music, batteries })).toEqual({ name: 'expanded', batteries })
    expect(sizeOf({ name: 'expanded', batteries })).toEqual(batteries)
    expect(resolveView({ ...rest, expanded: false, batteries }).name).toBe('idle')
  })
})

describe('sizeOf', () => {
  it('matches the design', () => {
    expect(sizeOf({ name: 'idle' })).toEqual({ width: 132, height: 34 })
    expect(sizeOf({ name: 'hover' })).toEqual({ width: 152, height: 36 })
    expect(sizeOf({ name: 'compact', activity: music })).toEqual({ width: 200, height: 34 })
    expect(sizeOf({ name: 'bar' })).toEqual({ width: 480, height: 44 })
    expect(sizeOf({ name: 'launch' })).toEqual({ width: 200, height: 34 })
    expect(radius(44)).toBe(22)
  })

  it('sizes the welcome around its text, as tall as a peek', () => {
    expect(welcomeWidth('hello', 95)).toBe(200)
    expect(welcomeWidth('hello', 150)).toBe(230)
    expect(welcomeWidth('keys', 276)).toBe(324)
    // A row not yet in the page measures 0: no 48 px blob, the beat is skipped.
    expect(welcomeWidth('keys', 0)).toBe(0)
    expect(sizeOf({ name: 'welcome', step: 'keys', width: 324 })).toEqual({ width: 324, height: 56 })
  })

  it('keeps the panel within 560 px', () => {
    expect(sizeOf({ name: 'expanded' }).width).toBeLessThanOrEqual(560)
  })

  it('stays compact for a peek the activity has no shape for', () => {
    expect(sizeOf({ name: 'peek', activity: call })).toEqual(sizeOf({ name: 'compact', activity: call }))
  })
})

describe('timerSize', () => {
  it('matches the design', () => {
    expect(timerSize(running, false)).toEqual({ width: 112, height: 34 })
    expect(timerSize({ ...running, long: true }, false)).toEqual({ width: 128, height: 34 })
    expect(sizeOf({ name: 'compact', activity: timer })).toEqual({ width: 112, height: 34 })
    expect(sizeOf({ name: 'peek', activity: timer })).toEqual({ width: 300, height: 56 })
  })

  it('makes room for the name under the cursor, up to its cap', () => {
    const named = { ...running, name: 40 }
    expect(timerSize(named, true)).toEqual({ width: 14 + 14 + 8 + 40 + 8 + 36 + 14, height: 36 })
    expect(timerSize({ ...named, name: 500 }, true).width).toBe(timerSize({ ...named, name: TIMER.name }, true).width)
  })

  it('keeps the done pill 150 px wide at least, and adds its buttons under the cursor', () => {
    const done = { ...running, ended: true, name: 26 }
    expect(timerSize(done, false)).toEqual({ width: 150, height: 34 })
    expect(timerSize(done, true)).toEqual({ width: 14 + 14 + 8 + 26 + 8 + 36 + 14 + 8 + TIMER.buttons, height: 36 })
    const wide = { ...done, name: 100, digits: 60 }
    expect(timerSize(wide, false).width).toBe(14 + 14 + 8 + 100 + 8 + 60 + 14)
  })
})

describe('cardSize', () => {
  it('fits a row per app, four at most, under the buttons', () => {
    expect(cardSize(0)).toEqual({ width: 248, height: 64 })
    expect(cardSize(2)).toEqual({ width: 248, height: 140 })
    expect(cardSize(9)).toEqual(cardSize(4))
  })
})

describe('radius', () => {
  it('keeps pills round and caps panels at 28 px', () => {
    expect(radius(34)).toBe(17)
    expect(radius(56)).toBe(28)
    expect(radius(120)).toBe(28)
  })
})

describe('drip', () => {
  it("is the island's own corners before it tapers", () => {
    expect(drip(280, 120, 0)).toBe('28.0px 28.0px 28.0px 28.0px / 28.0px 28.0px 28.0px 28.0px')
  })

  it('draws a panel out into a dome over its bottom corners', () => {
    expect(drip(280, 120, 1)).toBe('140.0px 140.0px 28.0px 28.0px / 92.0px 92.0px 28.0px 28.0px')
  })

  it('ends as a drop: round below, drawn out above', () => {
    expect(drip(16, 40, 1)).toBe('8.0px 8.0px 8.0px 8.0px / 32.0px 32.0px 8.0px 8.0px')
  })
})

describe('layout', () => {
  it('centers the island 8 px below the top', () => {
    expect(layout(600, { width: 132, height: 34 }, 0)).toEqual([{ x: 234, y: 8, width: 132, height: 34 }])
  })

  it('puts the bubble 8 px to the right of the island', () => {
    expect(layout(600, { width: 200, height: 34 }, 34)[1]).toEqual({ x: 408, y: 8, width: 34, height: 34 })
  })

  it('grows the bubble from its center', () => {
    expect(layout(600, { width: 200, height: 34 }, 10)[1]).toEqual({ x: 420, y: 20, width: 10, height: 10 })
  })
  it('slides the bubble and drops both', () => {
    expect(layout(600, { width: 200, height: 34 }, 20, { travel: -42, drop: -50 })).toEqual([
      { x: 200, y: -42, width: 200, height: 34 },
      { x: 373, y: -35, width: 20, height: 20 },
    ])
  })
})
