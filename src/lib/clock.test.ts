import { describe, expect, it } from 'vitest'
import { formatTime, msUntilNextMinute } from './clock'

describe('formatTime', () => {
  const evening = new Date(2026, 10, 12, 21, 5, 42)

  it('uses 24-hour time where the locale does', () => {
    expect(formatTime(evening, 'fr-FR')).toBe('21:05')
  })

  it('uses 12-hour time where the locale does', () => {
    expect(formatTime(evening, 'en-US')).toMatch(/^9:05\sPM$/)
  })
})

describe('msUntilNextMinute', () => {
  it('waits for the rest of the minute', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 0, 59, 500))).toBe(500)
  })

  it('waits a full minute on the dot', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 0, 0, 0))).toBe(60_000)
  })
})
