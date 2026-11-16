import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import { bezier, motion, squash } from './motion'

const music: Activity = { id: 'm', kind: 'music', title: '', artist: '', color: '#fff' }
const timer: Activity = { id: 't', kind: 'timer', endsAt: 0 }

describe('motion', () => {
  it('opens width first and closes height first', () => {
    const open = motion({ name: 'idle' }, { name: 'expanded' })
    expect(open.width[0]).toBeLessThan(open.height[0])
    const close = motion({ name: 'expanded' }, { name: 'idle' })
    expect(close.height[0]).toBeLessThan(close.width[0])
  })

  it('bounces only on a growing axis and delays only a shrink', () => {
    expect(motion({ name: 'idle' }, { name: 'hover' })).toMatchObject({ delay: 0, width: [0.4, 0.25] })
    expect(motion({ name: 'hover' }, { name: 'idle' })).toMatchObject({ delay: 60, width: [0.34, 0], height: [0.3, 0] })
    // The peek is wider than the panel: that axis shrinks while the shape grows.
    expect(motion({ name: 'peek', activity: music }, { name: 'expanded' }).width[1]).toBe(0)
  })

  it('pulses when an activity arrives, not when the panel closes onto it', () => {
    expect(motion({ name: 'idle' }, { name: 'compact', activity: timer }).pulse).toBe(true)
    expect(motion({ name: 'expanded' }, { name: 'compact', activity: timer }).pulse).toBe(false)
    expect(motion({ name: 'peek', activity: music }, { name: 'compact', activity: music }).pulse).toBe(false)
  })
})

describe('bezier', () => {
  it('matches CSS ease', () => {
    const ease = bezier(0.25, 0.1, 0.25, 1)
    expect(ease(0)).toBeCloseTo(0, 5)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(ease(1)).toBeCloseTo(1, 5)
  })
})

describe('squash', () => {
  it('is nothing at rest and at most 4 %', () => {
    expect(squash(0)).toBe(0)
    expect(squash(500)).toBeCloseTo(0.02)
    expect(squash(1e5)).toBe(0.04)
    expect(squash(-1e5)).toBe(-0.04)
  })
})
