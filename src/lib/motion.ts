import { sizeOf, type View } from './shapes'

/** A spring as SwiftUI sets one: duration in seconds and bounce. */
export type Axis = readonly [duration: number, bounce: number]

export interface Motion {
  width: Axis
  height: Axis
  /** Milliseconds the shape waits, so a shrink starts after the content has begun to leave. */
  delay: number
  /** A new activity nudges the height as it arrives. */
  pulse: boolean
}

/**
 * How the shape springs from one view to the next. Growing bounces, shrinking never overshoots.
 * Opening leads with the width, closing with the height.
 */
export function motion(from: View, to: View): Motion {
  const [a, b] = [sizeOf(from), sizeOf(to)]
  const grows = b.width * b.height >= a.width * a.height
  // Back from the panel or the command bar, what was there before comes back without a swell.
  const back = from.name === 'expanded' || from.name === 'bar' || from.name === 'launch'
  const pulse = to.name === 'compact' && !back && !('activity' in from && from.activity?.id === to.activity.id)
  const [width, height]: Axis[] =
    to.name === 'expanded' || to.name === 'bar'
      ? [OPEN.width, OPEN.height]
      : from.name === 'expanded' || from.name === 'bar'
        ? [CLOSE.width, CLOSE.height]
        : to.name === 'hover'
          ? [[0.4, 0.25], [0.34, 0.15]]
          : from.name === 'hover' && to.name === 'idle'
            ? [[0.34, 0], [0.3, 0]]
            : to.name === 'peek' || to.name === 'launch'
              ? [[0.44, 0.28], [0.48, 0.2]]
              : from.name === 'peek' || from.name === 'launch'
                ? [[0.38, 0], [0.32, 0]]
                : [grows ? [0.44, 0.28] : [0.36, 0], [0.3, 0]]
  // An axis that shrinks never bounces, even when the shape as a whole grows.
  const settle = ([duration, bounce]: Axis, from: number, to: number): Axis => [duration, to < from ? 0 : bounce]
  return {
    width: settle(width, a.width, b.width),
    height: settle(height, a.height, b.height),
    delay: grows ? 0 : 60,
    pulse,
  }
}

/** The panel and the privacy card open leading with the width, with a little bounce. */
export const OPEN: { width: Axis; height: Axis } = { width: [0.46, 0.26], height: [0.52, 0.18] }

/** They close leading with the height, without a bounce. */
export const CLOSE: { width: Axis; height: Axis } = { width: [0.4, 0], height: [0.34, 0] }

/** Content comes in from a blur, a beat after the shape starts, one piece after another. Times in ms. */
export const ENTER = { delay: 50, stagger: 35, duration: 280, easing: [0.2, 0, 0, 1], blur: 6, scale: 0.9 } as const

/** Content leaves faster than it came, shrinking with the shape or growing with it, by `scale`. */
export const EXIT = { duration: 100, easing: [0.4, 0, 1, 1], scale: 0.06 } as const

/** A press gives at once, and the release springs back with a little bounce. */
export const PRESS: { scale: number; down: Axis; up: Axis } = { scale: 0.96, down: [0.15, 0], up: [0.3, 0.3] }

/** In fullscreen the island slides up off the screen a beat after its content leaves, and drops back with a bounce. */
export const FULLSCREEN: { delay: number; hide: Axis; show: Axis } = { delay: 100, hide: [0.3, 0], show: [0.5, 0.2] }

/** A CSS `cubic-bezier()` as an easing function, for Svelte transitions. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (p1: number, p2: number, t: number) => 3 * p1 * t * (1 - t) ** 2 + 3 * p2 * (1 - t) * t * t + t ** 3
  return (x) => {
    // x(t) only grows for control points within [0, 1], so halving the range finds t.
    let [lo, hi] = [0, 1]
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2
      if (at(x1, x2, t) < x) lo = t
      else hi = t
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

/** Stretch along the width while it moves, as a share of the size: 0 at rest, 4 % at most. */
export function squash(velocity: number): number {
  return Math.max(-0.04, Math.min(0.04, velocity * 4e-5))
}
