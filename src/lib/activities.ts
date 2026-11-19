import type { Player } from './music'
import { ended, endOf, lead, type Timer } from './timers'

/** Something that wants the island. The time is one too, last in line: it has the island when nothing runs, and
 * the bubble when one thing does. */
export type Activity =
  | { id: 'clock'; kind: 'clock' }
  | { id: string; kind: 'call'; mic: boolean; camera: boolean }
  // `total` is what the ring empties from, `left` the time left while paused, and `label` the name typed with it
  // in the command bar. Its logic is in timers.ts.
  | { id: string; kind: 'timer'; endsAt: number; total: number; label?: string; left?: number }
  // `art` is a data: URL and `player` the live state behind it; the demo's songs have neither.
  | { id: string; kind: 'music'; title: string; artist: string; color: string; art?: string; player?: Player }

/**
 * How much of the island shows (src-tauri/src/fullscreen.rs): quiet while Windows says you're busy, hidden while
 * something is fullscreen.
 */
export type Presence = 'shown' | 'quiet' | 'hidden'

export interface Arrangement {
  island?: Activity
  bubble?: Activity
  waiting: Activity[]
}

const RANK: Record<Activity['kind'], number> = { call: 0, timer: 1, music: 2, clock: 3 }

export const CLOCK: Activity = { id: 'clock', kind: 'clock' }

/**
 * Who gets the island, who gets the bubble and who waits. Between equals, what is already
 * shown keeps its place, so two songs don't swap every time the list changes. The activity
 * picked by a click on the bubble, `prefer`, comes first after a call. The time on the island
 * is no activity at all: `island` is then undefined.
 *
 * Timers go by their end instead, soonest first. Only the running one that ends first ranks as a timer: the others,
 * and a paused one, wait below the music, so a forgotten pause never takes the island back. A timer that ended
 * takes the island at once, even from the one picked or an older end, and only a call keeps it. `pin` is the timer
 * whose panel is open: it keeps the island like the one picked, so Pause turns into Resume under the cursor.
 */
export function arrange(
  activities: readonly Activity[],
  shown?: Arrangement,
  prefer?: string,
  now = Date.now(),
  pin?: string,
): Arrangement {
  const timers = activities.filter((a): a is Timer => a.kind === 'timer')
  const first = lead(timers, now)?.id
  const place = (a: Activity) => (a.id === shown?.island?.id ? 0 : a.id === shown?.bubble?.id ? 1 : 2)
  const rank = (a: Activity) => {
    if (a.kind === 'call') return RANK.call
    if (a.kind === 'timer' && ended(a, now)) return 0.25
    if (a.id === prefer || a.id === pin) return 0.5
    if (a.kind === 'timer') return a.id === first ? RANK.timer : 2.5
    return RANK[a.kind]
  }
  // Running timers soonest end first; ended ones latest end first, so the fresh end gets the island.
  const end = (a: Activity) => (a.kind !== 'timer' ? 0 : ended(a, now) ? -a.endsAt : endOf(a, now))
  const [island, bubble, ...waiting] = [...activities, CLOCK].toSorted(
    (a, b) => rank(a) - rank(b) || end(a) - end(b) || place(a) - place(b),
  )
  return {
    island: island.kind === 'clock' ? undefined : island,
    bubble,
    waiting: waiting.filter((a) => a.kind !== 'clock'),
  }
}

/** The one picked from the bubble, while it is still there to pick: the time stays picked while anything runs. */
export function stillPicked(prefer: string | undefined, activities: readonly Activity[]): string | undefined {
  if (prefer === CLOCK.id) return activities.length ? prefer : undefined
  return activities.some((a) => a.id === prefer) ? prefer : undefined
}

/**
 * Whether news about an activity may peek. Nothing shows while hidden. While you're busy, only a call and a timer
 * that just ended get through: that one is an alarm you set.
 */
export function peeks(activity: Activity | undefined, presence: Presence, now = Date.now()): boolean {
  if (presence === 'shown') return true
  if (presence === 'hidden' || !activity) return false
  return activity.kind === 'call' || (activity.kind === 'timer' && ended(activity, now))
}
