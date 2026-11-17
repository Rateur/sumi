import { describe, expect, it } from 'vitest'
import { CLOCK, arrange, peeks, type Activity } from './activities'

const call: Activity = { id: 'call', kind: 'call', mic: true, camera: false }
const timer: Activity = { id: 'timer', kind: 'timer', endsAt: 0 }
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

describe('peeks', () => {
  it('peeks anything while you are free', () => {
    expect(peeks(a, 'shown')).toBe(true)
  })

  it('lets only a call through while you are busy', () => {
    expect(peeks(call, 'quiet')).toBe(true)
    expect(peeks(a, 'quiet')).toBe(false)
    expect(peeks(timer, 'quiet')).toBe(false)
  })

  it('shows nothing while hidden', () => {
    expect(peeks(call, 'hidden')).toBe(false)
  })
})
