/** Something running that wants the island. The clock needs no entry: it shows when nothing runs. */
export type Activity =
  | { id: string; kind: 'call'; mic: boolean; camera: boolean }
  | { id: string; kind: 'timer'; endsAt: number }
  | { id: string; kind: 'music'; title: string; artist: string; color: string }

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
 * shown keeps its place, so two songs don't swap every time the list changes.
 */
export function arrange(activities: readonly Activity[], shown?: Arrangement): Arrangement {
  const place = (a: Activity) => (a.id === shown?.island?.id ? 0 : a.id === shown?.bubble?.id ? 1 : 2)
  const [island, bubble, ...waiting] = activities.toSorted(
    (a, b) => RANK[a.kind] - RANK[b.kind] || place(a) - place(b),
  )
  return { island, bubble, waiting }
}

/** Whether news about an activity may peek. Nothing shows while hidden, and only a call interrupts you when busy. */
export function peeks(activity: Activity | undefined, presence: Presence): boolean {
  return presence === 'shown' || (presence === 'quiet' && activity?.kind === 'call')
}
