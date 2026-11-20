import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import { CLOSE, OPEN, bezier, lean, motion, squash } from './motion'

const music: Activity = { id: 'm', kind: 'music', title: '', artist: '', color: '#fff' }
const timer: Activity = { id: 't', kind: 'timer', endsAt: 0, total: 60_000 }

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
    expect(motion({ name: 'bar' }, { name: 'compact', activity: music }).pulse).toBe(false)
    expect(motion({ name: 'launch' }, { name: 'compact', activity: music }).pulse).toBe(false)
  })

  it('opens and folds the welcome as the panel, and only widens it in between', () => {
    const hello = { name: 'welcome', step: 'hello', width: 200 } as const
    const keys = { name: 'welcome', step: 'keys', width: 324 } as const
    expect(motion({ name: 'idle' }, hello)).toMatchObject({ width: OPEN.width, height: OPEN.height })
    expect(motion(hello, keys)).toMatchObject({ delay: 0, width: [0.44, 0.28], height: [0.3, 0] })
    expect(motion(keys, { name: 'idle' })).toMatchObject({ delay: 60, width: CLOSE.width, height: CLOSE.height })
    expect(motion(keys, { name: 'compact', activity: music })).toMatchObject({ width: CLOSE.width, pulse: false })
  })

  it('opens and closes the command bar as the panel', () => {
    expect(motion({ name: 'idle' }, { name: 'bar' })).toMatchObject({ width: OPEN.width, height: OPEN.height })
    expect(motion({ name: 'bar' }, { name: 'idle' })).toMatchObject({ width: CLOSE.width, height: CLOSE.height })
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

describe('lean', () => {
  it('is nothing at rest, follows the speed and stops at 10 degrees', () => {
    expect(lean(0)).toBe(0)
    expect(lean(200)).toBeCloseTo(8)
    expect(lean(-1e4)).toBe(-10)
  })
})
