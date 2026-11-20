import { describe, expect, it } from 'vitest'
import type { Activity } from './activities'
import type { Player } from './music'
import { quiet, type PrivacyApp } from './privacy'
import { badge, TIP, tip, TRAY } from './tray'

const app = (name: string, mic: boolean, camera: boolean): PrivacyApp => ({ name, mic, camera, sinceMs: 0 })
const song = (title: string, artist: string, playing: boolean): Activity => ({
  id: 'spotify',
  kind: 'music',
  title,
  artist,
  color: '#fff',
  player: { playing } as Player,
})
const keys = ['Win', 'Alt', 'S']

describe('badge', () => {
  it('shows a device in use first, then music that plays, else nothing', () => {
    const intro = song('Intro', 'The xx', true)
    expect(badge({ ...quiet(), apps: [app('Discord', true, false)] }, [intro])).toBe('mic')
    expect(badge({ ...quiet(), apps: [app('Discord', true, false), app('Zoom', false, true)] }, [])).toBe('camera')
    expect(badge(quiet(), [intro])).toBe('music')
    expect(badge(quiet(), [song('Intro', 'The xx', false)])).toBe('plain')
    expect(badge({ apps: [], muted: true, canMute: true }, [])).toBe('plain')
  })

  it('leaves a demo song without a player out', () => {
    expect(badge(quiet(), [{ id: 'demo', kind: 'music', title: 'Intro', artist: 'The xx', color: '#fff' }])).toBe('plain')
  })
})

describe('tip', () => {
  it('gives the shortcut at rest, or only the name without one', () => {
    expect(tip(quiet(), [], keys, 'en')).toBe('Sumi · Win+Alt+S')
    expect(tip(quiet(), [], ['Win', 'Alt', 'Maj', 'S'], 'fr')).toBe('Sumi · Win+Alt+Maj+S')
    expect(tip(quiet(), [], undefined, 'fr')).toBe('Sumi')
  })

  it('names the apps using the device the icon shows, in the island language', () => {
    const discord = app('Discord', true, false)
    expect(tip({ ...quiet(), apps: [discord] }, [], keys, 'fr')).toBe('Sumi · micro : Discord')
    expect(tip({ ...quiet(), apps: [discord, app('Zoom', true, false)] }, [], keys, 'en')).toBe(
      'Sumi · microphone: Discord +1',
    )
    expect(tip({ ...quiet(), apps: [discord, app('Zoom', true, true)] }, [], keys, 'fr')).toBe('Sumi · caméra : Zoom')
  })

  it('gives the song that plays', () => {
    expect(tip(quiet(), [song('Intro', 'The xx', true)], keys, 'en')).toBe('Sumi · Intro – The xx')
    expect(tip(quiet(), [song('Intro', '', true)], keys, 'en')).toBe('Sumi · Intro')
    expect(tip(quiet(), [song('', '', true)], keys, 'en')).toBe('Sumi · Win+Alt+S')
    expect(tip(quiet(), [song('Intro', 'The xx', false)], keys, 'en')).toBe('Sumi · Win+Alt+S')
  })

  it('cuts a long one to what Windows keeps, never through an emoji', () => {
    const long = tip(quiet(), [song('a'.repeat(200), '', true)], keys, 'en')
    expect(long).toHaveLength(TIP)
    expect(long.endsWith('a…')).toBe(true)
    // 'Sumi · ' is 7 long: the 119th unit of the title starts an emoji's pair, which the cut would split.
    const pair = tip(quiet(), [song(`${'a'.repeat(118)}😀${'a'.repeat(20)}`, '', true)], keys, 'en')
    expect(pair).toBe(`Sumi · ${'a'.repeat(118)}…`)
  })
})

describe('TRAY', () => {
  it('has every word in both languages', () => {
    expect(Object.keys(TRAY.fr)).toEqual(Object.keys(TRAY.en))
    expect(TRAY.fr.quit).toBe('Quitter Sumi')
  })
})
