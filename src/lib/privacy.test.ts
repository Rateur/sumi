import { describe, expect, it } from 'vitest'
import { label, lasted, light, quiet, tagged, type PrivacyApp } from './privacy'

const app = (name: string, mic: boolean, camera: boolean): PrivacyApp => ({ name, mic, camera, sinceMs: 0 })

describe('light', () => {
  it('is green for a camera, with or without the microphone, and orange for the microphone alone', () => {
    expect(light({ ...quiet(), apps: [app('Discord', true, false)] })).toBe('mic')
    expect(light({ ...quiet(), apps: [app('Discord', true, false), app('Teams', true, true)] })).toBe('camera')
    expect(light({ ...quiet(), apps: [app('Camera', false, true)] })).toBe('camera')
    expect(light(quiet())).toBeUndefined()
  })
})

describe('tagged', () => {
  it('shows for a device in use, or for a muted microphone, never for a muted one Windows can no longer reach', () => {
    expect(tagged(quiet())).toBe(false)
    expect(tagged({ ...quiet(), apps: [app('Discord', true, false)] })).toBe(true)
    expect(tagged({ apps: [], muted: true, canMute: true })).toBe(true)
    expect(tagged({ apps: [], muted: true, canMute: false })).toBe(false)
  })
})

describe('label', () => {
  it('names the first app and counts the others', () => {
    expect(label({ ...quiet(), apps: [app('Discord', true, false)] })).toBe('Discord')
    expect(label({ ...quiet(), apps: [app('Discord', true, false), app('Teams', true, true)] })).toBe('Discord +1')
    expect(label(quiet())).toBe('')
  })
})

describe('lasted', () => {
  it('says nothing under a minute, then minutes, then hours and minutes', () => {
    expect(lasted(0, 59_000, 'en')).toBe('')
    expect(lasted(0, 12 * 60_000, 'en')).toMatch(/^12\s?min$/)
    expect(lasted(0, 65 * 60_000, 'en')).toMatch(/^1\s?hr?,?\s5\s?min$/)
  })
})
