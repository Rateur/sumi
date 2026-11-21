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
  // Back from the panel, the command bar, the welcome or a battery peek, what was there before comes back without a
  // swell.
  const back = ['expanded', 'bar', 'launch', 'welcome', 'power'].includes(from.name)
  const pulse = to.name === 'compact' && !back && !('activity' in from && from.activity?.id === to.activity.id)
  // The welcome opens and folds as the panel; from its greeting to its shortcut, it only widens.
  const opens = to.name === 'welcome' && from.name !== 'welcome'
  const closes = from.name === 'welcome' && to.name !== 'welcome'
  // The clipboard history's list opens under the bar on the panel's height, then follows the filter without a bounce,
  // which would fire at every key.
  const [width, height]: Axis[] =
    to.name === 'bar' && from.name === 'bar' && from.rows
      ? [OPEN.width, [0.3, 0]]
      : to.name === 'expanded' || to.name === 'bar' || opens
        ? [OPEN.width, OPEN.height]
        : from.name === 'expanded' || from.name === 'bar' || closes
          ? [CLOSE.width, CLOSE.height]
          : to.name === 'hover'
            ? [[0.4, 0.25], [0.34, 0.15]]
            : from.name === 'hover' && to.name === 'idle'
              ? [[0.34, 0], [0.3, 0]]
              : to.name === 'peek' || to.name === 'launch' || to.name === 'power'
                ? [[0.44, 0.28], [0.48, 0.2]]
                : from.name === 'peek' || from.name === 'launch' || from.name === 'power'
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

/**
 * The clipboard history's highlight: the edge in the direction of travel leads and the other trails, so it stretches
 * and gathers like ink, never bouncing. `r` is its corner radius, concentric with the panel's 28 at 6 px in.
 */
export const HL = { lead: [0.22, 0] as Axis, trail: [0.34, 0] as Axis, r: 20 } as const

/** A row the filter brings into sight comes in from this scale, not ENTER's: 0.9 on a 468 px row reads as a zoom. */
export const FILTER_IN = 0.97

/** A press gives at once, and the release springs back with a little bounce. */
export const PRESS: { scale: number; down: Axis; up: Axis } = { scale: 0.96, down: [0.15, 0], up: [0.3, 0.3] }

/** In fullscreen the island slides up off the screen a beat after its content leaves, and drops back with a bounce. */
export const FULLSCREEN: { delay: number; hide: Axis; show: Axis } = { delay: 100, hide: [0.3, 0], show: [0.5, 0.2] }

/** A finished timer peeks this long, in ms, then folds into the done pill. */
export const END_PEEK = 6000

/** A finished timer chimes every `every` ms, `times` times, then stays silent. */
export const CHIME = { every: 10_000, times: 6 } as const

/** The first-launch welcome, in ms from the start of the drop. Without a shortcut it folds at `bare`. */
export const WELCOME = { ink: 140, hello: 700, keys: 1700, fold: 4900, bare: 2300 } as const

/** The bead that hangs under the island like the logo's drop: drawn radius, centre under the pill, goo. */
export const INK = { r: 15.5, d: 21, goo: 7 } as const

/** The bubble's drop springs, in split and merge, which the tuck's drop shares. */
export const MERGE: Axis = [0.36, 0]
export const SPLIT: { d: Axis; r: Axis } = { d: [0.5, 0.3], r: [0.4, 0.25] }

/**
 * The tuck: the line under the top edge, its hit height, and the gesture: deltas summed within `within` ms past
 * `wheel`, or a pull.
 */
export const TUCK = { width: 132, height: 4, hit: 12, wheel: 40, within: 200, pull: 12 } as const

/**
 * Goutte, the tuck's motion, in ms from its start. In: the edge's ink, `ink` wide, comes down from `away` (its bottom
 * edge, above the screen) while the island closes into a drop (`close`), is drawn up `rise` px above its place as a
 * `thin` × `long` drop (`draw`), and the ink spreads along the edge (`spread`). The ink runs `above` px over the edge,
 * so the goo keeps a full meniscus there. Out: a bead of radius `bead` hangs from the line, which gathers to `gather`,
 * the edge lets it go (`release`), and the drop opens into the island (`open`).
 */
export const GOUTTE = {
  ink: 24,
  away: -12,
  above: 40,
  close: 60,
  draw: 180,
  thin: 16,
  long: 40,
  rise: 50,
  spread: 300,
  bead: 8,
  gather: 40,
  release: 120,
  open: 260,
} as const

/**
 * Drain, the tuck from an open panel, in ms from its start: the panel's ink is drawn back into the edge as into a nib.
 * The content leaves and the edge's ink comes down as in Goutte. At `pull` the panel's sides and bottom pull in toward
 * the top centre, its corners first, into a bell and then Goutte's `thin` × `long` drop under the neck. From `rise`
 * the body drains up through the neck while the ink spreads along the edge.
 */
export const DRAIN = { pull: 60, rise: 140 } as const

/** What the island shows tucks itself after this long at rest, in ms, when it is a kind that tucks (tuck.ts). */
export const TUCK_AFTER = 10_000

/** After a click elsewhere, it tucks itself this soon instead, in ms. */
export const TUCK_AFTER_CLICK = 1000

/**
 * Swipes that tuck the island, in any direction. A press that moves past `drag` px is a swipe; while held, the island
 * follows the pointer with resistance, up to `give` px. A wheel swipe pushes it at `push` px/s. Sideways, the island
 * slides `side` px that way before it is drawn up; down, it first stretches `stretch` px longer and thinner, for
 * `snap` ms.
 */
export const SWIPE = { drag: 8, give: 24, push: 240, side: 40, stretch: 14, snap: 100 } as const

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

/** Lean while it slides sideways, its top ahead, in degrees: 0 at rest, 10 at most. */
export function lean(velocity: number): number {
  return Math.max(-10, Math.min(10, velocity * 0.04))
}
