import { describe, expect, it } from 'vitest'
import { answer, charge, duration, lines, percent, spoken, waits, type Battery, type Device } from './power'

const headset: Device = { name: 'WH-1000XM4', glyph: 'headset', percent: 80 }
const laptop = (more: Partial<Battery> = {}): Battery => ({ percent: 47, plugged: true, minutes: null, devices: [], ...more })

describe('answer', () => {
  it('says where the power comes from, as the spec words it', () => {
    expect(answer(laptop(), 'fr')).toBe(`${percent(47)} · sur secteur`)
    expect(answer(laptop(), 'en')).toBe(`${percent(47)} · plugged in`)
    expect(answer(laptop({ plugged: false, minutes: 130 }), 'fr')).toBe(`${percent(47)} · environ 2 h 10`)
    expect(answer(laptop({ plugged: false, minutes: 130 }), 'en')).toBe(`${percent(47)} · about 2 h 10 left`)
    expect(answer(laptop({ plugged: false }), 'fr')).toBe(`${percent(47)} · sur batterie`)
    expect(answer(laptop({ plugged: false }), 'en')).toBe(`${percent(47)} · on battery`)
  })

  it('adds the devices, by what they are, or by name', () => {
    const pad: Device = { name: 'Pro Controller', glyph: 'controller', percent: 35 }
    const speaker: Device = { name: 'JBL Go 4', glyph: 'other', percent: 60 }
    expect(answer(laptop({ devices: [headset] }), 'fr')).toBe(`${percent(47)} · sur secteur · Casque ${percent(80)}`)
    expect(answer(laptop({ devices: [pad, speaker] }), 'en')).toBe(
      `${percent(47)} · plugged in · Controller ${percent(35)} · JBL Go 4 ${percent(60)}`,
    )
  })

  it('says there is no battery only when no device has one either', () => {
    const desktop = laptop({ percent: null, plugged: false })
    expect(answer(desktop, 'fr')).toBe('Pas de batterie sur ce PC')
    expect(answer(desktop, 'en')).toBe('This PC has no battery')
    expect(answer({ ...desktop, devices: [headset] }, 'en')).toBe(`Headset ${percent(80)}`)
  })

  it('is just the word until Rust has answered', () => {
    expect(answer(undefined, 'fr')).toBe('Batterie')
  })
})

describe('peeks', () => {
  it('reads the time left in hours and minutes', () => {
    expect(duration(65)).toBe('1 h 05')
    expect(duration(130)).toBe('2 h 10')
    expect(duration(45)).toBe('45 min')
  })

  it('writes a level that never wraps', () => {
    expect(percent(47)).toBe('47\u202f%')
  })

  it('gives each peek its lines', () => {
    expect(lines({ kind: 'plugged', percent: 47 }, 'fr')).toEqual([percent(47)])
    expect(lines({ kind: 'low', percent: 20, minutes: 65 }, 'fr')).toEqual([percent(20), 'Environ 1 h 05'])
    expect(lines({ kind: 'low', percent: 20, minutes: 65 }, 'en')).toEqual([percent(20), 'About 1 h 05 left'])
    expect(lines({ kind: 'low', percent: 18, minutes: null }, 'fr')).toEqual([percent(18), 'Batterie faible'])
    expect(lines({ kind: 'low', percent: 18, minutes: null }, 'en')).toEqual([percent(18), 'Low battery'])
    expect(lines({ kind: 'device', device: headset }, 'en')).toEqual(['WH-1000XM4', percent(80)])
    expect(lines({ kind: 'deviceLow', device: { ...headset, percent: 15 } }, 'en')).toEqual([percent(15), 'WH-1000XM4'])
  })

  it('tells a screen reader what each peek is about', () => {
    expect(spoken({ kind: 'plugged', percent: 47 }, 'fr')).toBe(`Sur secteur · ${percent(47)}`)
    expect(spoken({ kind: 'low', percent: 20, minutes: 65 }, 'en')).toBe(`Low battery · ${percent(20)} · About 1 h 05 left`)
    expect(spoken({ kind: 'low', percent: 18, minutes: null }, 'en')).toBe(`${percent(18)} · Low battery`)
    expect(spoken({ kind: 'deviceLow', device: { ...headset, percent: 15 } }, 'fr')).toBe(
      `Batterie faible · ${percent(15)} · WH-1000XM4`,
    )
  })

  it('fills the battery to its level', () => {
    expect(charge({ kind: 'low', percent: 20, minutes: null })).toBe(0.2)
    expect(charge({ kind: 'device', device: headset })).toBe(0.8)
  })

  it('lets a low battery wait, and drops the rest', () => {
    expect(waits({ kind: 'low', percent: 20, minutes: null })).toBe(true)
    expect(waits({ kind: 'deviceLow', device: headset })).toBe(true)
    expect(waits({ kind: 'plugged', percent: 47 })).toBe(false)
    expect(waits({ kind: 'device', device: headset })).toBe(false)
  })
})
