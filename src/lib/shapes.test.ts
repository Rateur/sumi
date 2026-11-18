import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import { layout, radius, resolveView, sizeOf } from './shapes'

const music: Activity = { id: 'm', kind: 'music', title: '', artist: '', color: '#fff' }
const timer: Activity = { id: 't', kind: 'timer', endsAt: 0 }

describe('resolveView', () => {
  const rest = { hovered: false, expanded: false }

  it('shows the clock at rest and adds the date on hover', () => {
    expect(resolveView(rest)).toEqual({ name: 'idle' })
    expect(resolveView({ ...rest, hovered: true })).toEqual({ name: 'hover' })
  })

  it('opens the panel on click, over everything else', () => {
    expect(resolveView({ activity: timer, hovered: true, expanded: true, peeking: 't' })).toEqual({ name: 'expanded' })
  })

  it('opens music into its own, larger panel', () => {
    const view = resolveView({ activity: music, hovered: false, expanded: true, peeking: 'm' })
    expect(view).toEqual({ name: 'expanded', activity: music })
    expect(sizeOf(view).width).toBeGreaterThan(sizeOf({ name: 'expanded' }).width)
  })

  it('opens the privacy tag into a panel with a row per app, over any activity', () => {
    const view = resolveView({ activity: music, hovered: false, expanded: true, privacy: 2 })
    expect(view).toEqual({ name: 'expanded', privacy: 2 })
    expect(sizeOf(view)).toEqual({ width: 300, height: 140 })
    expect(sizeOf({ name: 'expanded', privacy: 0 })).toEqual({ width: 300, height: 72 })
    expect(sizeOf({ name: 'expanded', privacy: 9 })).toEqual(sizeOf({ name: 'expanded', privacy: 4 }))
  })

  it('shows an activity compact, even under the cursor', () => {
    expect(resolveView({ ...rest, activity: music, hovered: true })).toEqual({ name: 'compact', activity: music })
  })

  it('peeks only the activity that asked for it', () => {
    expect(resolveView({ ...rest, activity: music, peeking: 'm' })).toEqual({ name: 'peek', activity: music })
    expect(resolveView({ ...rest, activity: music, peeking: 't' })).toEqual({ name: 'compact', activity: music })
  })
})

describe('sizeOf', () => {
  it('matches the design', () => {
    expect(sizeOf({ name: 'idle' })).toEqual({ width: 132, height: 34 })
    expect(sizeOf({ name: 'hover' })).toEqual({ width: 152, height: 36 })
    expect(sizeOf({ name: 'compact', activity: music })).toEqual({ width: 200, height: 34 })
  })

  it('keeps the panel within 560 px', () => {
    expect(sizeOf({ name: 'expanded' }).width).toBeLessThanOrEqual(560)
  })

  it('stays compact for a peek the activity has no shape for', () => {
    expect(sizeOf({ name: 'peek', activity: timer })).toEqual(sizeOf({ name: 'compact', activity: timer }))
  })
})

describe('radius', () => {
  it('keeps pills round and caps panels at 28 px', () => {
    expect(radius(34)).toBe(17)
    expect(radius(56)).toBe(28)
    expect(radius(120)).toBe(28)
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
