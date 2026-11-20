import type { Activity } from './activities'
import type { Power } from './power'

export type View =
  | { name: 'idle' }
  // A timer under the cursor shows its name, and a finished one its buttons. `size` is then worked out by timerSize.
  | { name: 'hover'; activity?: Activity; size?: Size }
  // The command bar, and the peek it folds into after Enter: an app launching or a question handed off.
  | { name: 'bar' }
  | { name: 'launch' }
  // The weather the bar asked for, for a few seconds.
  | { name: 'weather' }
  // Music and a running timer open into their own panels; anything else opens the clock's.
  | { name: 'expanded'; activity?: Activity }
  // The batteries panel, from the bar or a battery peek, sized by its rings (panelSize in power.ts).
  | { name: 'expanded'; batteries: Size }
  | { name: 'compact' | 'peek'; activity: Activity; size?: Size }
  // A battery peek, over whatever has the island for a few seconds: plugging in, a low battery, a device.
  | { name: 'power'; power: Power }
  // The first-launch welcome: the greeting, then the command bar's shortcut. Its width is measured from its text.
  | Welcome

export type Welcome = { name: 'welcome'; step: 'hello' | 'keys'; width: number }

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
  bar: { width: 480, height: 44 },
  launch: { width: 200, height: 34 },
} satisfies Record<string, Size>

/** The welcome is as tall as a peek. The greeting is at least 200 px wide with 40 px each side, the shortcut row 24. */
export const WELCOME_H = 56

/** The welcome's width around text this wide. A shortcut row that measured nothing gets 0: no shortcut beat. */
export function welcomeWidth(step: Welcome['step'], text: number): number {
  if (step === 'hello') return Math.max(200, text + 2 * 40)
  return text && text + 2 * 24
}

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
  timer: { width: 112, height: 34 },
  music: { width: 200, height: 34 },
  // Never used: the time on the island is the idle view.
  clock: SIZES.idle,
}

// The kinds without a peek of their own stay compact. A timer peeks only as it ends. A battery peek is a song's.
const PEEKED: Size = { width: 300, height: 56 }
const PEEK: Partial<Record<Activity['kind'], Size>> = { music: PEEKED, timer: PEEKED }

/**
 * The timer's row: a ring at the left end, its name, its digits at the right end. Running it is 112 px wide, 128 at
 * an hour or more; finished, it folds into a done pill of 150 px at least, whose OK and +1 min show under the cursor.
 */
export const TIMER = {
  ring: 14,
  pad: 14,
  gap: 8,
  long: 128,
  done: 150,
  // Past this many pixels, the name ends in an ellipsis.
  name: 120,
  // OK and +1 min, on the done pill's hover.
  buttons: 98,
  hover: 36,
} as const

/** What the island's timer needs for its size: whether it ended, whether an hour is left, and its name's and
 * digits' widths as laid out (0 without a name). */
export interface TimerFit {
  ended: boolean
  long: boolean
  name: number
  digits: number
}

/** The timer's shape for the island's compact row, under the cursor or not. */
export function timerSize(fit: TimerFit, hovered: boolean): Size {
  const { ring, pad, gap } = TIMER
  const name = Math.min(fit.name, TIMER.name)
  const row = (least: number) => Math.max(least, Math.ceil(pad * 2 + ring + gap + (name ? name + gap : 0) + fit.digits))
  // Under the cursor the buttons take the room the pill kept spare, so the time since the end stays by the name.
  if (fit.ended) {
    return hovered
      ? { width: Math.max(TIMER.done, row(0) + gap + TIMER.buttons), height: TIMER.hover }
      : { width: row(TIMER.done), height: 34 }
  }
  const compact = fit.long ? TIMER.long : COMPACT.timer.width
  return hovered && name ? { width: row(compact), height: TIMER.hover } : { width: compact, height: 34 }
}

/**
 * What the island shows. The command bar and its answer beat everything, then the welcome. A click beats a peek,
 * a peek beats an activity, an activity beats the clock. A battery peek never covers a call or a timer's end peek. `timer` says how the island's timer fits, when it has one:
 * under the cursor it shows its name, and once it ended it peeks, then stays as a done pill and never opens.
 */
export function resolveView(state: {
  activity?: Activity
  hovered: boolean
  expanded: boolean
  peeking?: string
  bar?: boolean
  launch?: boolean
  /** The weather the bar asked for, which always shows. */
  weather?: boolean
  /** The bar's answer to 'quelle heure est-il': the hover view, over whatever runs. */
  clock?: boolean
  timer?: TimerFit
  welcome?: Welcome
  /** The welcome's drop and bead: the empty idle island, even with a song already playing. */
  blank?: boolean
  power?: Power
  /** The batteries panel's size, while it is open. */
  batteries?: Size
}): View {
  const { activity, hovered, expanded, peeking, bar, launch, weather, clock, timer, welcome, blank, power, batteries } =
    state
  if (bar) return { name: 'bar' }
  if (launch) return { name: 'launch' }
  if (weather) return { name: 'weather' }
  if (welcome) return welcome
  if (blank) return { name: 'idle' }
  if (clock) return { name: 'hover' }
  const done = activity?.kind === 'timer' && !!timer?.ended
  if (expanded && batteries) return { name: 'expanded', batteries }
  if (expanded && !done) {
    const own = activity?.kind === 'music' || activity?.kind === 'timer'
    return own ? { name: 'expanded', activity } : { name: 'expanded' }
  }
  if (power && activity?.kind !== 'call' && !(done && activity?.id === peeking)) return { name: 'power', power }
  if (activity?.kind === 'timer' && timer) {
    if (done && activity.id === peeking) return { name: 'peek', activity }
    // Without a name, a running timer has nothing to add under the cursor.
    const more = hovered && (timer.ended || timer.name > 0)
    return { name: more ? 'hover' : 'compact', activity, size: timerSize(timer, more) }
  }
  if (activity) return { name: activity.id === peeking ? 'peek' : 'compact', activity }
  return { name: hovered ? 'hover' : 'idle' }
}

export function sizeOf(view: View): Size {
  if (view.name === 'welcome') return { width: view.width, height: WELCOME_H }
  if ('batteries' in view) return view.batteries
  if ('size' in view && view.size) return view.size
  if (view.name === 'expanded' && view.activity?.kind === 'music') return PLAYER
  if (view.name === 'expanded') return SIZES.expanded
  if (view.name === 'compact') return COMPACT[view.activity.kind]
  if (view.name === 'peek') return PEEK[view.activity.kind] ?? COMPACT[view.activity.kind]
  if (view.name === 'weather') return PEEKED
  // Plugging in and a device connecting take the music's compact shape; a low battery, a song's peek.
  if (view.name === 'power') return ['plugged', 'device'].includes(view.power.kind) ? COMPACT.music : PEEKED
  return SIZES[view.name]
}

/** Pills stay fully round; taller shapes become panels with 28 px corners. */
export function radius(height: number): number {
  return Math.min(height / 2, 28)
}

/**
 * The corners of a shape drawn up into a drop, as a CSS `border-radius`: at `taper` 0 the island's own; at 1 round
 * below, and drawn out above into a dome that hangs from the middle of its top.
 */
export function drip(width: number, height: number, taper: number): string {
  const [r, round] = [radius(height), Math.min(width / 2, radius(height))]
  const mix = (to: number) => (r + (to - r) * taper).toFixed(1)
  const [x, y, b] = [mix(width / 2), mix(height - round), mix(round)]
  return `${x}px ${x}px ${b}px ${b}px / ${y}px ${y}px ${b}px ${b}px`
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
