import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import { MERGE, TUCK, TUCK_AFTER, TUCK_AFTER_CLICK } from './motion'
import { TOP } from './shapes'
import { Spring } from './spring'
import {
  DRAINS,
  drag,
  kinds,
  marks,
  resist,
  scroll,
  swipe,
  tucksAfter,
  tucksItself,
  wakes,
  type Notch,
  type Part,
} from './tuck'

const call: Activity = { id: 'call', kind: 'call', mic: true, camera: false }
const song: Activity = { id: 'spotify', kind: 'music', title: 'Intro', artist: 'The xx', color: '#fff' }
// Ends at 60 s.
const timer: Activity = { id: 't', kind: 'timer', endsAt: 60_000, total: 60_000 }
const none = { tagged: false, bar: false, welcome: false }

describe('kinds', () => {
  it('is the time alone when nothing runs', () => {
    expect(kinds(none, 0)).toEqual(['time'])
  })

  it('names the island, its bubble and what holds them', () => {
    const shown = kinds({ island: timer, bubble: { id: 'clock', kind: 'clock' }, ...none, tagged: true, bar: true }, 0)
    expect(shown).toEqual(['timer', 'time', 'privacy', 'bar'])
  })

  it('tells an end peek from a done pill', () => {
    expect(kinds({ island: timer, ...none, peeking: 't' }, 61_000)).toEqual(['peek'])
    expect(kinds({ island: timer, ...none }, 61_000)).toEqual(['done'])
  })
})

describe('tucksItself', () => {
  it('tucks for the time and a running timer', () => {
    expect(tucksItself(['time'])).toBe(true)
    expect(tucksItself(['timer', 'time'])).toBe(true)
  })

  it('stays as long as one thing shown stays', () => {
    for (const kind of ['music', 'call', 'privacy', 'bar', 'welcome', 'peek', 'done'] as const) {
      expect(tucksItself(['time', kind])).toBe(false)
    }
  })
})

describe('tucksAfter', () => {
  it('waits 10 s at rest, and 1 s after a click elsewhere', () => {
    expect(tucksAfter(['time'], false)).toBe(TUCK_AFTER)
    expect(tucksAfter(['timer'], true)).toBe(TUCK_AFTER_CLICK)
  })

  it('never tucks what stays, click or not', () => {
    expect(tucksAfter(['music'], true)).toBeUndefined()
    expect(tucksAfter(['done'], true)).toBeUndefined()
  })
})

describe('wakes', () => {
  it('brings the island back for a call or a song that starts', () => {
    expect(wakes([], [call], 'shown', 0)).toBe(true)
    expect(wakes([], [song], 'shown', 0)).toBe(true)
  })

  it('leaves it tucked for what was already there', () => {
    const seen = marks([song, timer], 0)
    expect(wakes(seen, [song, timer], 'shown', 1000)).toBe(false)
  })

  it('leaves it tucked for a new running timer, a kind that tucks', () => {
    expect(wakes([], [timer], 'shown', 0)).toBe(false)
  })

  it('brings it back as a timer ends, but not for a done pill it tucked with', () => {
    expect(wakes(marks([timer], 59_000), [timer], 'shown', 60_000)).toBe(true)
    expect(wakes(marks([timer], 61_000), [timer], 'shown', 70_000)).toBe(false)
  })

  it('counts a song that left and came back as new', () => {
    // The island looks again at each change: once with the song, once after it left.
    expect(wakes(marks([song], 0), [song], 'shown', 0)).toBe(false)
    expect(wakes(marks([], 60_000), [song], 'shown', 61_000)).toBe(true)
  })

  it('lets only a call and a timer that ends through while you are busy', () => {
    expect(wakes([], [song], 'quiet', 0)).toBe(false)
    expect(wakes([], [call], 'quiet', 0)).toBe(true)
    expect(wakes(marks([timer], 59_000), [timer], 'quiet', 60_000)).toBe(true)
  })
})

describe('scroll and swipe', () => {
  const run = (moves: [number, number][], lines = false) =>
    moves.reduce<Notch[]>((notches, [at, dy]) => scroll(notches, at, 0, dy, lines), [])
  const sideways = (moves: [number, number][]) =>
    moves.reduce<Notch[]>((notches, [at, dx]) => scroll(notches, at, dx, 0), [])

  it('tucks on one wheel notch up', () => {
    expect(swipe(run([[0, -100]]))).toBe('up')
  })

  it('sums small moves within 200 ms', () => {
    expect(swipe(run([[0, -20], [150, -20]]))).toBe('up')
    expect(swipe(run([[0, -30]]))).toBeUndefined()
  })

  it('forgets moves older than 200 ms', () => {
    expect(swipe(run([[0, -30], [250, -30]]))).toBeUndefined()
  })

  it('brings it back on a scroll down', () => {
    expect(swipe(run([[0, 40]]))).toBe('down')
  })

  it('swipes sideways on the touchpad, along the longer axis', () => {
    expect(swipe(sideways([[0, -25], [100, -25]]))).toBe('left')
    expect(swipe(sideways([[0, 60]]))).toBe('right')
    expect(swipe(scroll(scroll([], 0, 30, -50), 50, 0, 0))).toBe('up')
  })

  it('counts a line as 33 px', () => {
    expect(swipe(run([[0, -1]], true))).toBeUndefined()
    expect(swipe(run([[0, -2]], true))).toBe('up')
  })
})

describe('drag', () => {
  it('is no swipe inside its 8 px square, as a click', () => {
    expect(drag(5, -8)).toBeUndefined()
  })

  it('goes the way of its longer axis once out of it', () => {
    expect(drag(0, -9)).toBe('up')
    expect(drag(3, 12)).toBe('down')
    expect(drag(-20, 10)).toBe('left')
    expect(drag(20, -10)).toBe('right')
  })
})

describe('resist', () => {
  it('follows a short drag at about half, and never past 24 px', () => {
    expect(resist(0)).toBe(0)
    expect(resist(8)).toBeCloseTo(3.7, 1)
    expect(resist(-8)).toBeCloseTo(-3.7, 1)
    expect(resist(1e4)).toBeLessThan(24)
    expect(resist(40)).toBeLessThan(resist(60))
  })
})

describe('DRAINS', () => {
  // The clock panel drained at 60 Hz, as Island.svelte runs it: the edge's ink comes down at 0, then the beats.
  function drain() {
    const springs: Record<Part | 'lineB', Spring> = {
      width: new Spring(280),
      height: new Spring(120),
      lift: new Spring(0),
      taper: new Spring(0),
      lineW: new Spring(24),
      lineX: new Spring(0),
      lineB: new Spring(-12),
    }
    springs.lineB.to(TUCK.height, ...MERGE, 0)
    const frames: { t: number; at: Record<string, number> }[] = []
    for (let t = 0; t <= 1200; t += 1000 / 60) {
      for (const beat of DRAINS.filter((b) => b.at <= t && b.at > t - 1000 / 60)) {
        springs[beat.part].to(beat.to, ...beat.axis, beat.at)
      }
      Object.values(springs).forEach((s) => s.update(t))
      frames.push({ t, at: Object.fromEntries(Object.entries(springs).map(([k, s]) => [k, s.value])) })
    }
    return frames
  }
  const frames = drain()
  const first = (when: (at: Record<string, number>) => boolean) => frames.find((f) => when(f.at))?.t ?? Infinity

  it('drains the body into the line, then draws the line sooner than the closed tuck (about 630 ms)', () => {
    const inside = first((at) => TOP + at.lift + at.height < TUCK.height - 2)
    const drawn = first((at) => at.lineW > TUCK.width - 4)
    expect(inside).toBeLessThan(400)
    expect(drawn).toBeGreaterThan(inside)
    expect(drawn).toBeLessThan(500)
  })

  it('pulls the sides in faster than the bottom rises', () => {
    const sides = first((at) => at.width < 280 - (280 - 16) / 2)
    const bottom = first((at) => at.height < 120 - (120 - 40) / 2)
    expect(sides).toBeLessThan(bottom)
  })

  it('never overshoots: calm, without a bounce', () => {
    for (const { part, to } of DRAINS) {
      const start = frames[0].at[part]
      for (const { at } of frames) expect((at[part] - to) * Math.sign(start - to)).toBeGreaterThanOrEqual(-1e-6)
    }
  })
})
