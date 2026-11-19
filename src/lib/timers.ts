import type { Activity } from './activities'
import { formatCountdown, msUntilNextSecond } from './clock'
import { CHIME } from './motion'

/**
 * A timer counts down to `endsAt`, a time on the wall clock, and every view works it out again from `Date.now()`:
 * nothing adds up ticks, so a sleep, a throttled page or a change of daylight saving time can't make it drift.
 * Paused, it keeps its time left in `left` instead, and `endsAt` means nothing until it resumes. `total` is what
 * the ring empties from: the length it was started with, plus what was added since.
 */
export type Timer = Extract<Activity, { kind: 'timer' }>

export type Lang = 'fr' | 'en'

export const isTimer = (a?: Activity): a is Timer => a?.kind === 'timer'

/** Whether it ran out. A paused timer never has: its time left is frozen above 0 until it resumes. */
export const ended = (t: Timer, now: number) => t.left === undefined && now >= t.endsAt

/** When it ends, or would if it ran on from now. */
export const endOf = (t: Timer, now: number) => (t.left === undefined ? t.endsAt : now + t.left)

/** Time left, frozen while paused, and 0 once it ended. */
export const remaining = (t: Timer, now: number) => Math.max(0, t.left ?? t.endsAt - now)

/** How full the ring is: 1 when it starts, 0 at the end. */
export const fraction = (t: Timer, now: number) => (t.total > 0 ? Math.min(1, remaining(t, now) / t.total) : 0)

/** Whether the digits need the hours: h:mm:ss from an hour on, as the countdown rounds up. */
export const long = (t: Timer, now: number) => Math.ceil(remaining(t, now) / 1000) >= 3600

/** Time since it ended. */
export const overtime = (t: Timer, now: number) => (ended(t, now) ? now - t.endsAt : 0)

let made = 0

export function start(ms: number, now: number, label?: string): Timer {
  return { id: `timer:${now}:${made++}`, kind: 'timer', endsAt: now + ms, total: ms, ...(label ? { label } : {}) }
}

/** Freezes the time left. One that already ended has nothing left to freeze. */
export function pause(t: Timer, now: number): Timer {
  return t.left !== undefined || ended(t, now) ? t : { ...t, left: t.endsAt - now }
}

export function resume(t: Timer, now: number): Timer {
  if (t.left === undefined) return t
  const { left, ...rest } = t
  return { ...rest, endsAt: now + left }
}

/** Adds time, running or paused. A timer that already ended starts again for that long, under its name. */
export function add(t: Timer, ms: number, now: number): Timer {
  if (ended(t, now)) return start(ms, now, t.label)
  return t.left === undefined
    ? { ...t, endsAt: t.endsAt + ms, total: t.total + ms }
    : { ...t, left: t.left + ms, total: t.total + ms }
}

/** Soonest end first, so the island shows the next one to ring. */
export function order(timers: readonly Timer[], now: number): Timer[] {
  return timers.toSorted((a, b) => endOf(a, now) - endOf(b, now))
}

/** The running timer that ends first: the only one ranked as a timer. The others wait below the music. */
export function lead(timers: readonly Timer[], now: number): Timer | undefined {
  return order(
    timers.filter((t) => t.left === undefined && !ended(t, now)),
    now,
  )[0]
}

/** Which chime of the end is due: 0 at the end, then one every 10 s, and none after the last. */
export function chimeSlot(t: Timer, now: number): number | undefined {
  if (!ended(t, now)) return
  const slot = Math.floor((now - t.endsAt) / CHIME.every)
  return slot < CHIME.times ? slot : undefined
}

/**
 * How long until something changes: a timer ends, a chime is due, or, for the timers on screen, the next second.
 * Nothing to wait for gives undefined, so nothing runs at rest; a paused timer waits for nothing.
 */
export function nextTick(timers: readonly Timer[], onScreen: readonly Timer[], now: number): number | undefined {
  const at = timers.flatMap((t) => {
    if (t.left !== undefined) return []
    if (now < t.endsAt) return [t.endsAt]
    const slot = chimeSlot(t, now)
    return slot !== undefined && slot + 1 < CHIME.times ? [t.endsAt + (slot + 1) * CHIME.every] : []
  })
  const seconds = onScreen.flatMap((t) => (t.left === undefined ? [now + msUntilNextSecond(t.endsAt, now)] : []))
  const next = Math.min(...at, ...seconds)
  return next === Infinity ? undefined : next - now
}

/** The countdown, m:ss under an hour and h:mm:ss above. */
export const formatLeft = (t: Timer, now: number) => formatCountdown(remaining(t, now))

/** Time since the end, counting up from "+0:00". */
export function formatOvertime(ms: number): string {
  return `+${formatCountdown(Math.floor(Math.max(0, ms) / 1000) * 1000)}`
}

const WORDS = {
  fr: {
    timer: 'Minuteur',
    the: 'le minuteur',
    done: 'Fini',
    ends: (time: string) => `fin à ${time}`,
    paused: 'En pause',
    pause: (name: string) => `Mettre en pause ${name}`,
    resume: (name: string) => `Reprendre ${name}`,
    cancel: (name: string) => `Annuler ${name}`,
    dismiss: (name: string) => `Arrêter ${name}`,
    more: '+1 min',
  },
  en: {
    timer: 'Timer',
    the: 'the timer',
    done: "Time's up",
    ends: (time: string) => `ends ${time}`,
    paused: 'Paused',
    pause: (name: string) => `Pause ${name}`,
    resume: (name: string) => `Resume ${name}`,
    cancel: (name: string) => `Cancel ${name}`,
    dismiss: (name: string) => `Dismiss ${name}`,
    more: '+1 min',
  },
} as const

export const words = (lang: Lang) => WORDS[lang]

/**
 * What each timer is called: its label, or, among several without one, "Minuteur 2" by order of creation. A lone
 * timer without a label has no name.
 */
export function names(timers: readonly Timer[], lang: Lang): Map<string, string> {
  const unnamed = timers.filter((t) => !t.label)
  return new Map(
    timers.flatMap((t): [string, string][] => {
      if (t.label) return [[t.id, t.label]]
      return unnamed.length > 1 ? [[t.id, `${WORDS[lang].timer} ${unnamed.indexOf(t) + 1}`]] : []
    }),
  )
}
