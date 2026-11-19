import type { Activity } from './activities'

export type View =
  | { name: 'idle' }
  | { name: 'hover' }
  // Music opens into its own panel; anything else opens the clock's.
  | { name: 'expanded'; activity?: Activity }
  | { name: 'compact' | 'peek'; activity: Activity }

export interface Size {
  width: number
  height: number
}

/** Bounds in CSS pixels, relative to the window. */
export interface Rect extends Size {
  x: number
  y: number
}

/** Distance from the top of the screen. */
export const TOP = 8
export const BUBBLE = 34
export const GAP = 8
/** The privacy tag: a small disc beside everything else, as on the iPhone, holding the microphone or camera dot. */
export const TAG = 20
export const TAG_GAP = 6

const SIZES = {
  idle: { width: 132, height: 34 },
  hover: { width: 152, height: 36 },
  expanded: { width: 280, height: 120 },
} satisfies Record<string, Size>

const PLAYER: Size = { width: 360, height: 164 }

/** The privacy tag's card: a row per app, up to `rows` (the last one then counts the rest), then its buttons. */
export const CARD = { width: 248, row: 38, frame: 64, rows: 4 }

/** The card's size for so many apps. With none, only the buttons show, for a muted microphone. */
export const cardSize = (apps: number): Size => ({
  width: CARD.width,
  height: CARD.frame + Math.min(apps, CARD.rows) * CARD.row,
})

const COMPACT: Record<Activity['kind'], Size> = {
  call: { width: 144, height: 34 },
  timer: { width: 96, height: 34 },
  music: { width: 200, height: 34 },
  // Never used: the time on the island is the idle view.
  clock: SIZES.idle,
}

// The kinds without a peek of their own stay compact.
const PEEK: Partial<Record<Activity['kind'], Size>> = {
  music: { width: 300, height: 56 },
}

/** What the island shows. A click beats a peek, a peek beats an activity, an activity beats the clock. */
export function resolveView(state: {
  activity?: Activity
  hovered: boolean
  expanded: boolean
  peeking?: string
}): View {
  const { activity, hovered, expanded, peeking } = state
  if (expanded) return activity?.kind === 'music' ? { name: 'expanded', activity } : { name: 'expanded' }
  if (activity) return { name: activity.id === peeking ? 'peek' : 'compact', activity }
  return { name: hovered ? 'hover' : 'idle' }
}

export function sizeOf(view: View): Size {
  if (view.name === 'expanded' && view.activity) return PLAYER
  if (view.name === 'compact') return COMPACT[view.activity.kind]
  if (view.name === 'peek') return PEEK[view.activity.kind] ?? COMPACT[view.activity.kind]
  return SIZES[view.name]
}

/** Pills stay fully round; taller shapes become panels with 28 px corners. */
export function radius(height: number): number {
  return Math.min(height / 2, 28)
}

/**
 * Where the island and the bubble are drawn, and where clicks are caught: the island
 * centered under the top edge, the bubble beside it, both growing from their centers.
 * `travel` slides the bubble sideways from its place and `drop` moves both down.
 */
export function layout(viewport: number, island: Size, bubble: number, { travel = 0, drop = 0 } = {}): Rect[] {
  const x = (viewport - island.width) / 2
  const rects = [{ x, y: TOP + drop, ...island }]
  if (bubble > 0) {
    const inset = (BUBBLE - bubble) / 2
    rects.push({ x: x + island.width + GAP + inset + travel, y: TOP + drop + inset, width: bubble, height: bubble })
  }
  return rects
}
