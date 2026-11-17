/** Hours and minutes in the user's locale, e.g. "21:05" or "9:05 PM". */
export function formatTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** The time without AM or PM, small enough for the bubble: "9:05" or "21:05". */
export function formatBubbleTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
    .formatToParts(date)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim()
}

/** Time left before the minute changes, so the clock wakes up once a minute and not every second. */
export function msUntilNextMinute(date: Date): number {
  return 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
}

/** Day and month, short, e.g. "12 Nov" or "Nov 12". No weekday: beside a 12-hour time it overflows the hover. */
export function formatShortDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
}

/** Weekday, day and month in full, e.g. "Thursday 12 November" or "jeudi 12 novembre". */
export function formatLongDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

/** Time left before a countdown to `endsAt` shows the next second. */
export function msUntilNextSecond(endsAt: number, now: number): number {
  return (((endsAt - now) % 1000) + 1000) % 1000 || 1000
}

/**
 * Time left on a countdown, e.g. "4:05" or "1:02:03", or "1h03" when `short`. Rounds up,
 * so a fresh 25-minute timer reads "25:00".
 */
export function formatCountdown(ms: number, short = false): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
  const pad = (n: number) => String(n).padStart(2, '0')
  if (short && h) {
    const minutes = Math.ceil(total / 60)
    return `${Math.floor(minutes / 60)}h${pad(minutes % 60)}`
  }
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
