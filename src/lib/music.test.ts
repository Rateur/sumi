import { describe, expect, it } from 'vitest'
import {
  HOLD,
  NEUTRAL,
  PAUSED,
  clockTime,
  nextChange,
  nobody,
  position,
  shown,
  songs,
  update,
  type Player,
} from './music'

const T = 1_800_000_000_000
const player = (id: string, playing: boolean, more: Partial<Player> = {}): Player => ({
  id,
  title: id,
  artist: '',
  playing,
  canPlayPause: true,
  canNext: true,
  canPrevious: true,
  canSeek: true,
  endMs: 200_000,
  positionMs: 0,
  updatedMs: T,
  rate: 1,
  ...more,
})

describe('which players show', () => {
  it('shows a player that plays, and not one first seen paused', () => {
    const known = update(nobody(), [player('spotify', true), player('tab', false)], T)
    expect(shown(known, T).map((p) => p.id)).toEqual(['spotify'])
  })

  it('keeps a paused player for a minute from the pause, then lets the clock back', () => {
    let known = update(nobody(), [player('spotify', true)], T)
    // A long song sends nothing while it plays: the pause, ten minutes later, starts the minute.
    known = update(known, [player('spotify', false)], T + 600_000)
    expect(shown(known, T + 600_000 + PAUSED - 1)).toHaveLength(1)
    expect(shown(known, T + 600_000 + PAUSED)).toHaveLength(0)
    expect(nextChange(known, T + 600_000)).toBe(T + 600_000 + PAUSED)
  })

  it('brings a paused player back when it plays again', () => {
    let known = update(nobody(), [player('spotify', true)], T)
    known = update(known, [player('spotify', false)], T)
    known = update(known, [player('spotify', true)], T + PAUSED * 2)
    expect(shown(known, T + PAUSED * 2)).toHaveLength(1)
  })

  it('holds a player that vanishes for a moment, so a new session between songs doesn\'t blink', () => {
    let known = update(nobody(), [player('spotify', true)], T)
    known = update(known, [], T + 1000)
    expect(shown(known, T + 1000)).toHaveLength(1)
    expect(nextChange(known, T + 1000)).toBe(T + 1000 + HOLD)
    known = update(known, [], T + 1000 + HOLD)
    expect(shown(known, T + 1000 + HOLD)).toHaveLength(0)
  })

  it('shows two players playing at once', () => {
    const known = update(nobody(), [player('spotify', true), player('chrome', true)], T)
    expect(shown(known, T).map((p) => p.id)).toEqual(['spotify', 'chrome'])
  })
})

describe('position', () => {
  it('moves on by itself while playing, at the playback rate', () => {
    expect(position(player('a', true, { positionMs: 10_000 }), T + 5_000)).toBe(15_000)
    expect(position(player('a', true, { positionMs: 10_000, rate: 2 }), T + 5_000)).toBe(20_000)
  })

  it('stays put while paused, and never passes the end', () => {
    expect(position(player('a', false, { positionMs: 10_000 }), T + 5_000)).toBe(10_000)
    expect(position(player('a', true, { positionMs: 199_000 }), T + 60_000)).toBe(200_000)
  })

  it('takes a position without a timestamp as current', () => {
    expect(position(player('a', true, { positionMs: 10_000, updatedMs: 0 }), T)).toBe(10_000)
  })
})

describe('clockTime', () => {
  it('writes minutes and seconds, and hours past an hour', () => {
    expect(clockTime(187_000)).toBe('3:07')
    expect(clockTime(3_727_000)).toBe('1:02:07')
    expect(clockTime(-5)).toBe('0:00')
  })
})

describe('songs', () => {
  it('uses the neutral tint until the artwork gives a colour', () => {
    const p = player('spotify', true)
    expect(songs([p], new Map())[0]).toMatchObject({ kind: 'music', color: NEUTRAL, art: undefined, player: p })
    const art = new Map([['spotify', { url: 'data:image/png;base64,', color: '#ff0000' }]])
    expect(songs([p], art)[0]).toMatchObject({ color: '#ff0000', art: 'data:image/png;base64,' })
  })
})
