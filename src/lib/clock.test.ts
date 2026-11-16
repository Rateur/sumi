import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatLongDate,
  formatShortDate,
  formatTime,
  msUntilNextMinute,
  msUntilNextSecond,
} from './clock'

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

describe('formatShortDate', () => {
  const thursday = new Date(2026, 10, 12, 21, 5)

  it('follows the locale', () => {
    expect(formatShortDate(thursday, 'en-GB')).toBe('Thu 12 Nov')
    expect(formatShortDate(thursday, 'fr-FR')).toBe('jeu. 12 nov.')
  })
})

describe('formatLongDate', () => {
  const thursday = new Date(2026, 10, 12, 21, 5)

  it('follows the locale', () => {
    expect(formatLongDate(thursday, 'en-GB')).toBe('Thursday 12 November')
    expect(formatLongDate(thursday, 'fr-FR')).toBe('jeudi 12 novembre')
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown(25 * 60_000)).toBe('25:00')
    expect(formatCountdown(4 * 60_000 + 5_000)).toBe('4:05')
  })

  it('adds hours from an hour on', () => {
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
  })

  it('rounds up and stops at zero', () => {
    expect(formatCountdown(59_001)).toBe('1:00')
    expect(formatCountdown(-5_000)).toBe('0:00')
  })

  it('drops the seconds from an hour on when short', () => {
    expect(formatCountdown(90 * 60_000, true)).toBe('1h30')
    expect(formatCountdown(90 * 60_000 - 1_000, true)).toBe('1h30')
    expect(formatCountdown(10 * 3_600_000, true)).toBe('10h00')
    expect(formatCountdown(59 * 60_000, true)).toBe('59:00')
  })
})

describe('msUntilNextSecond', () => {
  it('waits for the countdown to cross a second', () => {
    expect(msUntilNextSecond(10_300, 0)).toBe(300)
    expect(msUntilNextSecond(0, 300)).toBe(700)
  })

  it('waits a full second on the dot', () => {
    expect(msUntilNextSecond(10_000, 0)).toBe(1000)
  })
})
