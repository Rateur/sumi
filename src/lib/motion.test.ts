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

  it("swells into a battery peek and folds out of it as a song's peek, without a pulse after", () => {
    const low = { name: 'power', power: { kind: 'low', percent: 20, minutes: null } } as const
    expect(motion({ name: 'compact', activity: music }, low)).toEqual(
      motion({ name: 'compact', activity: music }, { name: 'peek', activity: music }),
    )
    expect(motion(low, { name: 'compact', activity: music })).toMatchObject({ width: [0.38, 0], pulse: false })
  })

  it('opens and closes the command bar as the panel', () => {
    expect(motion({ name: 'idle' }, { name: 'bar' })).toMatchObject({ width: OPEN.width, height: OPEN.height })
    expect(motion({ name: 'bar' }, { name: 'idle' })).toMatchObject({ width: CLOSE.width, height: CLOSE.height })
  })

  it('opens the clipboard history under the bar as the panel, and follows the filter without a bounce', () => {
    const [five, two] = [{ name: 'bar', rows: 5 }, { name: 'bar', rows: 2 }] as const
    expect(motion({ name: 'idle' }, five)).toMatchObject({ width: OPEN.width, height: OPEN.height })
    expect(motion({ name: 'bar' }, two)).toMatchObject({ height: OPEN.height, delay: 0 })
    expect(motion(five, two)).toMatchObject({ height: [0.3, 0], delay: 60 })
    expect(motion(two, five)).toMatchObject({ height: [0.3, 0], delay: 0 })
    expect(motion(five, { name: 'launch' })).toMatchObject({ width: CLOSE.width, height: CLOSE.height, delay: 60 })
  })

  it('opens the capture as a peek or folds the bar into it, changes it as anything else, and folds it as a peek', () => {
    const [pick, box, done] = [
      { name: 'capture', step: 'pick', width: 247 },
      { name: 'capture', step: 'box', width: 231 },
      { name: 'capture', step: 'done', width: 215 },
    ] as const
    expect(motion({ name: 'idle' }, pick)).toMatchObject({ width: [0.44, 0.28], height: [0.48, 0.2], delay: 0 })
    expect(motion({ name: 'bar' }, pick)).toMatchObject({ width: CLOSE.width, height: CLOSE.height, delay: 60 })
    expect(motion(pick, box)).toMatchObject({ width: [0.36, 0], height: [0.3, 0], delay: 60 })
    expect(motion(done, { name: 'idle' })).toMatchObject({ width: [0.38, 0], height: [0.32, 0], delay: 60 })
    expect(motion(done, { name: 'compact', activity: music }).pulse).toBe(false)
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
