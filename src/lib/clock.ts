/** Hours and minutes in the user's locale, e.g. "21:05" or "9:05 PM". */
export function formatTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** Time left before the minute changes, so the clock wakes up once a minute and not every second. */
export function msUntilNextMinute(date: Date): number {
  return 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
}
