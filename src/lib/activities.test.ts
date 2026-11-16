import { describe, expect, it } from 'vitest'
import { arrange, type Activity } from './activities'

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

  it('hands the island back when the higher priority ends', () => {
    const shown = arrange([timer, a])
    expect(arrange([a], shown)).toEqual({ island: a, bubble: undefined, waiting: [] })
  })
})
