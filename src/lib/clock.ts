/** Hours and minutes in the user's locale, e.g. "21:05" or "9:05 PM". */
export function formatTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** Time left before the minute changes, so the clock wakes up once a minute and not every second. */
export function msUntilNextMinute(date: Date): number {
  return 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
}

/** Weekday, day and month, short, e.g. "Thu 12 Nov" or "jeu. 12 nov.". */
export function formatShortDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
}

/** Weekday, day and month in full, e.g. "Thursday 12 November" or "jeudi 12 novembre". */
export function formatLongDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

/** Time left on a countdown, e.g. "4:05" or "1:02:03". Rounds up, so a fresh 25-minute timer reads "25:00". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
