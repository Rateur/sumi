import { describe, expect, it } from 'vitest'
import {
  COLOR,
  QUIET,
  answer,
  colorOf,
  duration,
  fresh,
  info,
  items,
  layout,
  lines,
  opens,
  others,
  panelSize,
  percent,
  readOut,
  row,
  said,
  spoken,
  title,
  waits,
  type Battery,
  type Device,
} from './power'

const head: Device = { name: 'Casque UGREEN HiTune Max5', kind: 'headset', percent: 80 }
const mouse: Device = { name: 'Souris MX Master 3S', kind: 'mouse', percent: 52 }
const speaker: Device = { name: 'Enceinte JBL Flip 6', kind: 'speaker', percent: 45 }
const pad: Device = { name: 'Manette Xbox', kind: 'controller', percent: 15 }
const keys: Device = { name: 'Clavier MX Keys', kind: 'keyboard', percent: 91 }
const buds: Device = { name: 'Galaxy Buds2 Pro', kind: 'headset', percent: 72 }
const pc = (more: Partial<Battery> = {}): Battery => ({
  percent: 64,
  plugged: false,
  minutes: 190,
  full: null,
  saver: false,
  devices: [],
  ...more,
})
const p = percent

describe('the bar', () => {
  it('answers with the PC, then each device by what it is, in the panel order', () => {
    expect(answer(pc({ devices: [mouse, head] }), 'fr')).toBe(`${p(64)} · environ 3 h 10 · Casque ${p(80)} · Souris ${p(52)}`)
    expect(answer(pc({ plugged: true }), 'en')).toBe(`${p(64)} · plugged in`)
    expect(answer(pc({ minutes: null }), 'fr')).toBe(`${p(64)} · sur batterie`)
    expect(answer(pc({ devices: [{ ...speaker, kind: 'other' }] }), 'en')).toBe(`${p(64)} · about 3 h 10 left · Device ${p(45)}`)
  })

  it('says there is no battery only when no device has one either, and Enter opens nothing then', () => {
    const desktop = pc({ percent: null })
    expect(answer(desktop, 'fr')).toBe('Pas de batterie sur ce PC')
    expect(opens(desktop)).toBe(false)
    expect(answer({ ...desktop, devices: [head] }, 'en')).toBe(`Headset ${p(80)}`)
    expect(opens({ ...desktop, devices: [head] })).toBe(true)
    expect(answer(undefined, 'fr')).toBe('Batterie')
  })
})

describe('the rings', () => {
  it('puts the PC first, then by kind, then by name, whatever the levels', () => {
    const all = items(pc({ devices: [mouse, keys, pad, speaker, head, buds] }), 'fr')
    expect(all.map((it) => it.name)).toEqual([
      'Ce PC',
      'Casque UGREEN HiTune Max5',
      'Galaxy Buds2 Pro',
      'Enceinte JBL Flip 6',
      'Manette Xbox',
      'Souris MX Master 3S',
      'Clavier MX Keys',
    ])
  })

  it('numbers two devices of the same kind and name', () => {
    const ids = items(pc({ devices: [speaker, speaker] }), 'fr').map((it) => it.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('is red at 20 % or less on battery even with energy saver, amber with it above, green otherwise', () => {
    expect(colorOf({ percent: 18, plugged: false, saver: true })).toBe(COLOR.red)
    expect(colorOf({ percent: 64, plugged: false, saver: true })).toBe(COLOR.amber)
    expect(colorOf({ percent: 12, plugged: true })).toBe(COLOR.green)
    expect(colorOf({ percent: 15 })).toBe(COLOR.red)
  })

  it('shows five slots at most, the last counting the rest, and never hides a low device', () => {
    const all = items(pc({ devices: [buds, keys, head, speaker, pad, mouse] }), 'fr')
    const { shown, hidden } = row(all)
    expect(shown.map((it) => it.name)).toEqual(['Ce PC', 'Casque UGREEN HiTune Max5', 'Galaxy Buds2 Pro', 'Manette Xbox'])
    expect(hidden.map((it) => it.name)).toEqual(['Enceinte JBL Flip 6', 'Souris MX Master 3S', 'Clavier MX Keys'])
    expect(others(hidden, 'fr')).toBe(
      `3 autres : Enceinte JBL Flip 6, ${p(45)} ; Souris MX Master 3S, ${p(52)} ; Clavier MX Keys, ${p(91)}`,
    )
    const cells = layout(all, undefined, 'fr').cells
    expect(cells.map((c) => c.id).at(-1)).toBe('more')
  })

  it("takes the clock's panel for 2 to 4 slots, the player's width for 5, and its height while one is grown", () => {
    const three = items(pc({ devices: [head, mouse] }), 'fr')
    const five = items(pc({ devices: [head, speaker, pad, mouse] }), 'fr')
    expect(panelSize(three)).toEqual({ width: 280, height: 120 })
    expect(panelSize(five)).toEqual({ width: 360, height: 120 })
    expect(panelSize(three, 'pc')).toEqual({ width: 280, height: 164 })
    expect(panelSize(items(pc(), 'fr'), 'pc')).toEqual({ width: 280, height: 120 })
  })

  it('places the row as the lab does: 72 px slots for 3, 64 for 5, centres 48 px down', () => {
    const three = layout(items(pc({ devices: [head, mouse] }), 'fr'), undefined, 'fr').cells
    expect(three.map((c) => [c.cx, c.cy, c.d])).toEqual([
      [-72, 48, 44],
      [0, 48, 44],
      [72, 48, 44],
    ])
    const five = layout(items(pc({ devices: [head, speaker, pad, mouse] }), 'fr'), undefined, 'fr').cells
    expect(five.map((c) => c.cx)).toEqual([-128, -64, 0, 64, 128])
  })

  it('grows a ring to 56 px at the left with its lines, the others in a small row with a gap where it was', () => {
    const all = items(pc({ devices: [head, mouse] }), 'fr')
    const { cells, lines: text } = layout(all, all[1].id, 'fr')
    expect(cells[0]).toMatchObject({ id: all[1].id, cx: -140 + 24 + 28, cy: 58, d: 56 })
    expect(cells.slice(1).map((c) => [c.cx, c.cy, c.d])).toEqual([
      [-40, 132, 28],
      [40, 132, 28],
    ])
    expect(text.map((l) => [l.text, l.y])).toEqual([
      ['Casque UGREEN HiTune Max5', 42],
      [p(80), 74],
    ])
  })

  it('is the detail at once for one device, the PC on three lines', () => {
    const { cells, lines: text } = layout(items(pc(), 'fr'), undefined, 'fr')
    expect(cells[0]).toMatchObject({ cy: 60, d: 56 })
    expect(text.map((l) => [l.text, l.y])).toEqual([
      ['Ce PC', 28],
      [p(64), 60],
      ['Environ 3 h 10', 92],
    ])
  })
})

describe('the words', () => {
  const first = (b: Battery) => items(b, 'fr')[0]

  it("says the PC's state and time, as the spec's table", () => {
    expect([title(first(pc()), 'fr'), info(first(pc()), 'fr')]).toEqual(['Ce PC', 'Environ 3 h 10'])
    const charging = first(pc({ plugged: true, full: 50 }))
    expect([title(charging, 'fr'), info(charging, 'fr')]).toEqual(['Ce PC · en charge', 'Plein dans 50 min'])
    expect(info(first(pc({ plugged: true })), 'fr')).toBe('Sur secteur')
    expect(title(first(pc({ saver: true })), 'fr')).toBe('Ce PC · économiseur')
    expect(title(first(pc({ saver: true, percent: 18, minutes: 50 })), 'fr')).toBe('Ce PC · faible')
    expect(info(first(pc({ percent: 18, minutes: 50 })), 'en')).toBe('About 50 min left')
  })

  it('names each ring for a screen reader, and the panel as it opens', () => {
    const all = items(pc({ devices: [head, mouse] }), 'fr')
    expect(spoken(all[0], 'fr')).toBe(`Ce PC, ${p(64)}, environ 3 h 10 restantes`)
    expect(spoken(first(pc({ plugged: true, full: 50 })), 'fr')).toBe(`Ce PC, ${p(64)}, en charge, plein dans 50 min`)
    expect(spoken(items(pc({ saver: true, percent: 18 }), 'en')[0], 'en')).toBe(
      `This PC, ${p(18)}, about 3 h 10 left, energy saver, low battery`,
    )
    expect(readOut(all, 'fr')).toBe(
      `Batteries. Ce PC, ${p(64)}, environ 3 h 10 restantes. Casque UGREEN HiTune Max5, ${p(80)}. Souris MX Master 3S, ${p(52)}.`,
    )
  })

  it('reads the time in hours and minutes', () => {
    expect(duration(65)).toBe('1 h 05')
    expect(duration(45)).toBe('45 min')
    expect(percent(47)).toBe('47\u202f%')
  })
})

describe('peeks', () => {
  it('gives each its text', () => {
    expect(lines({ kind: 'plugged', percent: 64 }, 'fr')).toEqual([p(64)])
    expect(lines({ kind: 'low', percent: 20, minutes: 65 }, 'fr')).toEqual([p(20), 'Environ 1 h 05'])
    expect(lines({ kind: 'low', percent: 18, minutes: null }, 'en')).toEqual([p(18), 'Low battery'])
    expect(lines({ kind: 'device', device: speaker }, 'fr')).toEqual([p(45)])
    expect(lines({ kind: 'deviceLow', device: pad }, 'fr')).toEqual([p(15), 'Manette Xbox'])
  })

  it('tells a screen reader what happened', () => {
    expect(said({ kind: 'plugged', percent: 64 }, 'fr')).toBe(`Sur secteur, ${p(64)}`)
    expect(said({ kind: 'low', percent: 20, minutes: 65 }, 'fr')).toBe(`Batterie faible, ${p(20)}, environ 1 h 05 restantes`)
    expect(said({ kind: 'device', device: speaker }, 'fr')).toBe(`Enceinte JBL Flip 6 vient de se connecter, ${p(45)}`)
    expect(said({ kind: 'device', device: pad }, 'en')).toBe(`Manette Xbox connected, ${p(15)}, low battery`)
    expect(said({ kind: 'deviceLow', device: pad }, 'fr')).toBe(`Batterie faible, Manette Xbox, ${p(15)}`)
  })

  it('lets a low battery wait, and drops the rest', () => {
    expect(waits({ kind: 'low', percent: 20, minutes: null })).toBe(true)
    expect(waits({ kind: 'deviceLow', device: pad })).toBe(true)
    expect(waits({ kind: 'plugged', percent: 47 })).toBe(false)
    expect(waits({ kind: 'device', device: head })).toBe(false)
  })

  it("doesn't let the same device peek again within 30 min", () => {
    const heard = new Map<string, number>()
    expect(fresh(heard, head.name, 0)).toBe(true)
    expect(fresh(heard, head.name, QUIET - 1)).toBe(false)
    expect(fresh(heard, speaker.name, 1000)).toBe(true)
    expect(fresh(heard, head.name, QUIET)).toBe(true)
  })
})
