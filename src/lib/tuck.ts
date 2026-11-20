import { peeks, type Activity, type Presence } from './activities'
import type { Lang } from './intent'
import { TUCK } from './motion'
import { ended } from './timers'

/** Who tucked the island: you, the island itself at rest, or a window being moved, which gives the top back. */
export type Tucker = 'you' | 'auto' | 'move'

/** What the island can show, as far as tucking goes. */
export type Kind = 'privacy' | 'call' | 'bar' | 'welcome' | 'peek' | 'done' | 'music' | 'timer' | 'time'

/**
 * For each kind, whether the island stays or tucks itself after `TUCK_AFTER` at rest. A kind that stays also brings
 * the island back when it arrives.
 */
export const AUTO: Record<Kind, 'stays' | 'tucks'> = {
  privacy: 'stays',
  call: 'stays',
  bar: 'stays',
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

/** Everything the island shows: the island, its bubble, the privacy tag, and the bar or the welcome over them. */
export function kinds(
  state: { island?: Activity; bubble?: Activity; tagged: boolean; bar: boolean; welcome: boolean; peeking?: string },
  at: number,
): Kind[] {
  const { island, bubble, tagged, bar, welcome, peeking } = state
  const shown: Kind[] = [island ? kindOf(island, at, peeking) : 'time']
  if (bubble) shown.push(kindOf(bubble, at, peeking))
  if (tagged) shown.push('privacy')
  if (bar) shown.push('bar')
  if (welcome) shown.push('welcome')
  return shown
}

/** The island tucks itself only when everything it shows tucks. */
export const tucksItself = (shown: readonly Kind[]): boolean => shown.every((kind) => AUTO[kind] === 'tucks')

/** What the island knew of each activity as it looked: its id, and whether a timer had ended. */
export function marks(activities: readonly Activity[], at: number): string[] {
  return activities.map((a) => (a.kind === 'timer' && ended(a, at) ? `${a.id}:ended` : a.id))
}

/**
 * Whether something new since `seen`, the marks from the last look, brings the tucked island back: a call, a song or
 * a timer's end, any kind that stays. A song that left and came back is new again. While you're busy, only what may
 * peek does.
 */
export function wakes(seen: readonly string[], activities: readonly Activity[], presence: Presence, at: number): boolean {
  const now = marks(activities, at)
  return activities.some(
    (a, i) => !seen.includes(now[i]) && AUTO[kindOf(a, at)] === 'stays' && peeks(a, presence, at),
  )
}

/** A wheel event's deltaY, in px, and its time in ms. */
export interface Notch {
  at: number
  dy: number
}

/** The notches of the last `TUCK.within` ms, this one included. A line counts as 33 px, as Chromium scrolls. */
export function scroll(notches: readonly Notch[], at: number, dy: number, lines = false): Notch[] {
  return [...notches.filter((n) => at - n.at <= TUCK.within), { at, dy: lines ? dy * 33 : dy }]
}

/** Which way the scroll has gone once summed: up tucks the island, down brings it back. */
export function swipe(notches: readonly Notch[]): 'up' | 'down' | undefined {
  const dy = notches.reduce((sum, n) => sum + n.dy, 0)
  return dy <= -TUCK.wheel ? 'up' : dy >= TUCK.wheel ? 'down' : undefined
}

/** The tray menu's item, as the island is or is about to be. */
export const TRAY = {
  fr: { tuck: "Ranger l'île", back: "Faire revenir l'île" },
  en: { tuck: 'Tuck the island', back: 'Bring the island back' },
} satisfies Record<Lang, Record<string, string>>
