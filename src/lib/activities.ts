import type { Player } from './music'

/** Something running that wants the island. The clock needs no entry: it shows when nothing runs. */
export type Activity =
  | { id: string; kind: 'call'; mic: boolean; camera: boolean }
  | { id: string; kind: 'timer'; endsAt: number }
  // `art` is a data: URL and `player` the live state behind it; the demo's songs have neither.
  | { id: string; kind: 'music'; title: string; artist: string; color: string; art?: string; player?: Player }

/** How much of the island shows: quiet while Windows says you're busy, hidden while something is fullscreen. */
export type Presence = 'shown' | 'quiet' | 'hidden'

export interface Arrangement {
  island?: Activity
  bubble?: Activity
  waiting: Activity[]
}

const RANK: Record<Activity['kind'], number> = { call: 0, timer: 1, music: 2 }

/**
 * Who gets the island, who gets the bubble and who waits. Between equals, what is already
 * shown keeps its place, so two songs don't swap every time the list changes. The activity
 * picked by a click on the bubble, `prefer`, comes first after a call.
 */
export function arrange(activities: readonly Activity[], shown?: Arrangement, prefer?: string): Arrangement {
  const place = (a: Activity) => (a.id === shown?.island?.id ? 0 : a.id === shown?.bubble?.id ? 1 : 2)
  const rank = (a: Activity) => (a.id === prefer && a.kind !== 'call' ? 0.5 : RANK[a.kind])
  const [island, bubble, ...waiting] = activities.toSorted((a, b) => rank(a) - rank(b) || place(a) - place(b))
  return { island, bubble, waiting }
}

/** Whether news about an activity may peek. Nothing shows while hidden, and only a call interrupts you when busy. */
export function peeks(activity: Activity | undefined, presence: Presence): boolean {
  return presence === 'shown' || (presence === 'quiet' && activity?.kind === 'call')
}
