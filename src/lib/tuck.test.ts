import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import { kinds, marks, scroll, swipe, tucksItself, wakes, type Notch } from './tuck'

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
    moves.reduce<Notch[]>((notches, [at, dy]) => scroll(notches, at, dy, lines), [])

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

  it('counts a line as 33 px', () => {
    expect(swipe(run([[0, -1]], true))).toBeUndefined()
    expect(swipe(run([[0, -2]], true))).toBe('up')
  })
})
