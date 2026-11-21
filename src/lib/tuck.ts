import { peeks, type Activity, type Presence } from './activities'
import {
  CLOSE,
  DRAIN,
  FULLSCREEN,
  GOUTTE,
  MERGE,
  SWIPE,
  TUCK,
  TUCK_AFTER,
  TUCK_AFTER_CLICK,
  type Axis,
} from './motion'
import { TOP } from './shapes'
import { ended } from './timers'

/** Who tucked the island: you, the island itself at rest, or a window being moved, which gives the top back. */
export type Tucker = 'you' | 'auto' | 'move'

/** The way a swipe went, and so the way the island is drawn into the edge. */
export type Direction = 'up' | 'down' | 'left' | 'right'

/** What the island can show, as far as tucking goes. */
export type Kind = 'privacy' | 'call' | 'bar' | 'capture' | 'welcome' | 'peek' | 'done' | 'music' | 'timer' | 'time'

/**
 * For each kind, whether the island stays or tucks itself after `TUCK_AFTER` at rest. A kind that stays also brings
 * the island back when it arrives.
 */
export const AUTO: Record<Kind, 'stays' | 'tucks'> = {
  privacy: 'stays',
  call: 'stays',
  bar: 'stays',
  capture: 'stays',
  welcome: 'stays',
  peek: 'stays',
  done: 'stays',
  music: 'stays',
  timer: 'tucks',
  time: 'tucks',
}

/** An activity's kind. A timer that ended is its end peek while it peeks, then the done pill. */
export function kindOf(activity: Activity, at: number, peeking?: string): Kind {
  if (activity.kind === 'clock') return 'time'
  if (activity.kind !== 'timer') return activity.kind
  if (!ended(activity, at)) return 'timer'
  return activity.id === peeking ? 'peek' : 'done'
}

/**
 * Everything the island shows: the island, its bubble, the privacy tag, and the bar, the screen capture, the welcome or
 * a battery or weather peek over them.
 */
export function kinds(
  state: {
    island?: Activity
    bubble?: Activity
    tagged: boolean
    bar: boolean
    capture?: boolean
    welcome: boolean
    peeking?: string
    peek?: boolean
  },
  at: number,
): Kind[] {
  const { island, bubble, tagged, bar, capture, welcome, peeking, peek } = state
  const shown: Kind[] = [island ? kindOf(island, at, peeking) : 'time']
  if (bubble) shown.push(kindOf(bubble, at, peeking))
  if (tagged) shown.push('privacy')
  if (bar) shown.push('bar')
  if (capture) shown.push('capture')
  if (welcome) shown.push('welcome')
  if (peek) shown.push('peek')
  return shown
}

/** The island tucks itself only when everything it shows tucks. */
export const tucksItself = (shown: readonly Kind[]): boolean => shown.every((kind) => AUTO[kind] === 'tucks')

/** How long the island waits at rest before it tucks itself, sooner after a click elsewhere. Never for a kind that
 * stays. */
export function tucksAfter(shown: readonly Kind[], clicked: boolean): number | undefined {
  if (!tucksItself(shown)) return
  return clicked ? TUCK_AFTER_CLICK : TUCK_AFTER
}

/** What the island knew of each activity as it looked: its id, and whether a timer had ended. */
export function marks(activities: readonly Activity[], at: number): string[] {
  return activities.map((a) => (a.kind === 'timer' && ended(a, at) ? `${a.id}:ended` : a.id))
}

/**
 * Whether something new since `seen`, the marks from the last look, brings the tucked island back: a call, a song or
 * a timer's end, any kind that stays. A song that left and came back is new again. While you're busy, only what may
 * peek does.
 */
export function wakes(
  seen: readonly string[],
  activities: readonly Activity[],
  presence: Presence,
  at: number,
): boolean {
  const now = marks(activities, at)
  return activities.some(
    (a, i) => !seen.includes(now[i]) && AUTO[kindOf(a, at)] === 'stays' && peeks(a, presence, at),
  )
}

/** A wheel or touchpad event's deltas, in px, and its time in ms. */
export interface Notch {
  at: number
  dx: number
  dy: number
}

/** The notches of the last `TUCK.within` ms, this one included. A line counts as 33 px, as Chromium scrolls. */
export function scroll(notches: readonly Notch[], at: number, dx: number, dy: number, lines = false): Notch[] {
  const k = lines ? 33 : 1
  return [...notches.filter((n) => at - n.at <= TUCK.within), { at, dx: dx * k, dy: dy * k }]
}

/** The way a move went, along its longer axis. */
export function direction(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

/** Which way the scroll has gone once summed past `TUCK.wheel` on either axis, if it has. */
export function swipe(notches: readonly Notch[]): Direction | undefined {
  const [dx, dy] = notches.reduce(([x, y], n) => [x + n.dx, y + n.dy], [0, 0])
  return Math.max(Math.abs(dx), Math.abs(dy)) >= TUCK.wheel ? direction(dx, dy) : undefined
}

/** Which way a press has been dragged, once it has left the `SWIPE.drag` px square around where it began. */
export function drag(dx: number, dy: number): Direction | undefined {
  return Math.max(Math.abs(dx), Math.abs(dy)) > SWIPE.drag ? direction(dx, dy) : undefined
}

/** How far the island follows a drag: all of a short one, less and less after, never past `SWIPE.give`. */
export function resist(distance: number): number {
  const give = SWIPE.give
  return Math.sign(distance) * give * (1 - 1 / (1 + (0.55 * Math.abs(distance)) / give))
}

/** A spring the tuck drives: the island's size, lift and taper (drip in shapes.ts), and the line's width and centre. */
export type Part = 'width' | 'height' | 'lift' | 'taper' | 'lineW' | 'lineX'

/** A beat of a tuck: `at` ms from its start, `part` heads for `to` on `axis`, without overshoot. */
export interface Beat {
  at: number
  part: Part
  to: number
  axis: Axis
}

/**
 * The drain (DRAIN), the tuck from an open panel: its sides pull in faster than its bottom rises, so it thins under
 * the neck instead of closing into Goutte's round drop, and it drains up while it still pulls in. The ink spreads along
 * the edge as the body comes in.
 */
export const DRAINS: readonly Beat[] = [
  { at: DRAIN.pull, part: 'taper', to: 1, axis: FULLSCREEN.hide },
  { at: DRAIN.pull, part: 'width', to: GOUTTE.thin, axis: FULLSCREEN.hide },
  { at: DRAIN.pull, part: 'height', to: GOUTTE.long, axis: CLOSE.height },
  { at: DRAIN.rise, part: 'lift', to: -(TOP + GOUTTE.rise), axis: MERGE },
  { at: DRAIN.rise, part: 'lineW', to: TUCK.width, axis: CLOSE.width },
  { at: DRAIN.rise, part: 'lineX', to: 0, axis: CLOSE.width },
]
