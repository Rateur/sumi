import type { Lang } from './intent'
import type { Axis } from './motion'
import type { Size } from './shapes'
import type { Tucker } from './tuck'

/** What a device is, for its glyph and its place in the panel. Mirrored in src-tauri/src/power.rs. */
export type Kind = 'headset' | 'speaker' | 'controller' | 'mouse' | 'keyboard' | 'other'

/** Each bud's level and the case's, from Fast Pair, null when unknown. Mirrored in src-tauri/src/fastpair.rs. */
export interface Buds {
  left: number | null
  right: number | null
  case: number | null
}

/**
 * A connected device's battery: null for a headset, a speaker or a controller Windows gives no level for, and each
 * bud's and the case's when Fast Pair gives them. Mirrored in src-tauri/src/power.rs.
 */
export interface Device {
  name: string
  kind: Kind
  percent: number | null
  buds?: Buds
}

/**
 * What the bar and the batteries panel show: the laptop's level, null without a battery, whether it is plugged in,
 * the minutes left on battery and to full on mains when Windows knows them, energy saver, and the connected devices
 * that report a battery. Mirrored in power.rs.
 */
export interface Battery {
  percent: number | null
  plugged: boolean
  minutes: number | null
  full: number | null
  saver: boolean
  devices: Device[]
}

/** The laptop running low. Mirrored in power.rs. */
export interface Low {
  percent: number
  minutes: number | null
}

/** A battery peek: plugging in, the laptop running low, a device connecting or running low. */
export type Power =
  | { kind: 'plugged'; percent: number }
  | ({ kind: 'low' } & Low)
  | { kind: 'device' | 'deviceLow'; device: Device }

/** How long each peek shows, in ms. */
export const POWER_PEEK: Record<Power['kind'], number> = { plugged: 2000, low: 3000, device: 3000, deviceLow: 3000 }

/** The bolt of the plug-in peek draws itself this fast, in ms, then the level comes in. */
export const BOLT = 180

/** At or under this level on battery, a ring is red and the low peek fires. */
export const LOW = 20

/** The same device doesn't peek again this soon after its last peek, in ms: a headset out of range for a moment. */
export const QUIET = 30 * 60_000

/** The ring colours: the camera's green, the timer's amber for energy saver, the low battery's red. */
export const COLOR = { green: '#4ade80', amber: '#fbbf24', red: '#f87171' } as const

/** An arc fills from empty to its level as its ring comes in. No bounce: an overshoot would show a level that isn't. */
export const FILL: Axis = [0.6, 0]

/**
 * The panel: rings of `ring` px with a `stroke` px stroke, centres `row` px from the top, `slot` px apart at most,
 * `side` px from the edges, at most `max` slots, the last counting the rest past that. 280 wide, 360 for 5 slots.
 */
export const PANEL = { ring: 44, stroke: 4, row: 48, slot: 72, side: 20, max: 5, height: 120, width: 280, wide: 360 } as const

/**
 * A ring grown to its detail: `ring` px, `pad` px from the left, its text `gap` px further, the island `height` tall,
 * the others in a small row of `small` px rings `slot` px apart. A click drops the levels in `fade` ms, opacity only,
 * and the rings dropping to the small row slide after `slide` ms; the shrinking rings move on `ASIDE`.
 */
export const GROWN = { ring: 56, pad: 24, gap: 16, height: 164, small: 28, slot: 40, fade: 60, slide: 40 } as const
export const ASIDE: Axis = [0.34, 0]

/** The device connecting: the music's compact shape, its ring `ring` px with a `stroke` px stroke. */
export const COMPACT = { width: 200, height: 34, ring: 18, stroke: 2.2 } as const

/**
 * A low battery waits until the island can show it, and brings it back from its line to stay. Plugging in and a device
 * connecting are dropped while the island can't show them, and come out of the line only for their peek.
 */
export const waits = (power: Power): boolean => power.kind === 'low' || power.kind === 'deviceLow'

/**
 * What a battery peek does as it comes, early or late: shows, from the line too when the island is tucked by hand or
 * by itself, which then comes out and goes back; waits for the island, a low battery only; or is dropped. `tucker` is
 * who tucked the island, `undefined` while it is out. While a window is moved it stays tucked: Snap layouts has the
 * top.
 */
export function lands(power: Power, free: boolean, tucker: Tucker | undefined): 'show' | 'wait' | 'drop' {
  if (free && (waits(power) || tucker !== 'move')) return 'show'
  return waits(power) ? 'wait' : 'drop'
}

/** A ring: one per device, `pc` for the PC's, which knows its supply, its time and energy saver. */
export interface Item {
  id: string
  name: string
  kind: Kind | 'laptop'
  /** Null when Windows gives none. */
  percent: number | null
  pc?: boolean
  plugged?: boolean
  saver?: boolean
  minutes?: number | null
  full?: number | null
}

const WORDS = {
  fr: {
    title: 'Batterie',
    pc: 'Ce PC',
    about: (t: string) => `environ ${t}`,
    left: (t: string) => `Environ ${t}`,
    remaining: (t: string) => `environ ${t} restantes`,
    toFull: (t: string) => `Plein dans ${t}`,
    charging: (t: string) => `en charge, plein dans ${t}`,
    battery: 'sur batterie',
    plugged: 'sur secteur',
    none: 'Pas de batterie sur ce PC',
    low: 'Batterie faible',
    state: { charging: 'en charge', low: 'faible', saver: 'économiseur' },
    saver: "économiseur d'énergie",
    connected: (name: string) => `${name} vient de se connecter`,
    unknown: 'niveau inconnu',
    unreported: 'Windows ne donne pas sa batterie',
    others: (n: number) => `${n} autres : `,
    and: ' ; ',
    kind: { headset: 'Casque', speaker: 'Enceinte', controller: 'Manette', mouse: 'Souris', keyboard: 'Clavier', other: 'Appareil' },
  },
  en: {
    title: 'Battery',
    pc: 'This PC',
    about: (t: string) => `about ${t} left`,
    left: (t: string) => `About ${t} left`,
    remaining: (t: string) => `about ${t} left`,
    toFull: (t: string) => `Full in ${t}`,
    charging: (t: string) => `charging, full in ${t}`,
    battery: 'on battery',
    plugged: 'plugged in',
    none: 'This PC has no battery',
    low: 'Low battery',
    state: { charging: 'charging', low: 'low', saver: 'energy saver' },
    saver: 'energy saver',
    connected: (name: string) => `${name} connected`,
    unknown: 'level unknown',
    unreported: "Windows doesn't report its battery",
    others: (n: number) => `${n} more: `,
    and: '; ',
    kind: { headset: 'Headset', speaker: 'Speaker', controller: 'Controller', mouse: 'Mouse', keyboard: 'Keyboard', other: 'Device' },
  },
} as const

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** A level, with a narrow no-break space before the sign, so it never wraps, or a dash when Windows gives none. */
export const percent = (n: number | null): string => (n === null ? '—' : `${Math.round(n)}\u202f%`)

/** Minutes as the island says them: 1 h 05, or 45 min under an hour. */
export function duration(minutes: number): string {
  const [h, m] = [Math.floor(minutes / 60), minutes % 60]
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

// The PC, then by kind, then by name: waking up or reconnecting never reshuffles the row, and levels never reorder it.
const ORDER: Item['kind'][] = ['laptop', 'headset', 'speaker', 'controller', 'mouse', 'keyboard', 'other']

/** The rings, in order, the devices Windows gives no level for last. A device's id is its kind and name, numbered
 * when two share them. */
export function items(battery: Battery, lang: Lang): Item[] {
  const { percent: level, plugged, saver, minutes, full } = battery
  const pc: Item[] =
    level === null
      ? []
      : [{ id: 'pc', name: WORDS[lang].pc, kind: 'laptop', percent: level, pc: true, plugged, saver, minutes, full }]
  const seen = new Map<string, number>()
  const devices = battery.devices
    .toSorted(
      (a, b) =>
        +(a.percent === null) - +(b.percent === null) ||
        ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name, lang),
    )
    .map((d): Item => {
      const key = `${d.kind}:${d.name}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      return { ...d, id: n > 1 ? `${key}#${n}` : key }
    })
  return [...pc, ...devices]
}

/** At `LOW` or under on battery, even with energy saver on, which Windows turns on by itself at 20 %. */
export const low = (it: Pick<Item, 'percent' | 'plugged'>): boolean =>
  it.percent !== null && it.percent <= LOW && !it.plugged

/** Red when low, amber while energy saver is on above that, green otherwise, and white without a level. */
export const colorOf = (it: Pick<Item, 'percent' | 'plugged' | 'saver'>): string =>
  it.percent === null ? '#fff' : low(it) ? COLOR.red : it.saver ? COLOR.amber : COLOR.green

/** Five slots at most: past them, the last one counts the rest. A device at `LOW` or under swaps in for the last shown. */
export function row(all: readonly Item[]): { shown: Item[]; hidden: Item[] } {
  if (all.length <= PANEL.max) return { shown: [...all], hidden: [] }
  const head = all[0].pc ? [all[0]] : []
  const devices = all.slice(head.length)
  const keep = [...devices.filter((d) => low(d)), ...devices.filter((d) => !low(d))].slice(0, PANEL.max - 1 - head.length)
  return { shown: [...head, ...devices.filter((d) => keep.includes(d))], hidden: devices.filter((d) => !keep.includes(d)) }
}

/** The panel's size: the clock's panel, the player's width for 5 slots, and its height while a ring is grown. */
export function panelSize(all: readonly Item[], grown?: string): Size {
  const { shown, hidden } = row(all)
  const slots = shown.length + (hidden.length ? 1 : 0)
  const tall = all.length > 1 && all.some((it) => it.id === grown)
  return { width: slots >= PANEL.max ? PANEL.wide : PANEL.width, height: tall ? GROWN.height : PANEL.height }
}

/** A ring in the panel: where its centre is from the island's top centre, its size, and whether its level shows. */
export interface Cell {
  id: string
  it: Item
  /** The devices "+N" stands for. */
  more?: Item[]
  cx: number
  cy: number
  d: number
  label: boolean
  step: number
}

/** A line of the detail: its text, its look, its centre `y` from the top and its left `x` from the centre. */
export interface Line {
  text: string
  /** `note` wraps onto a second line. */
  cls: 'muted' | 'big' | 'note'
  x: number
  y: number
  step: number
  max?: number
}

/**
 * A ring grown to its detail, as the timer's panel: the PC's name and state, its level in big digits and its time; a
 * device's name and level, centred on the ring.
 */
function detail(it: Item, width: number, cy: number, lang: Lang): { cell: Cell; lines: Line[] } {
  const x = -width / 2 + GROWN.pad + GROWN.ring + GROWN.gap
  const max = width / 2 - 20 - x
  const texts: [string, Line['cls'], number][] = it.pc
    ? [
        [title(it, lang), 'muted', -32],
        [percent(it.percent), 'big', 0],
        [info(it, lang), 'muted', 32],
      ]
    : it.percent === null
      ? [
          [it.name, 'muted', -16],
          [WORDS[lang].unreported, 'note', 14],
        ]
      : [
          [it.name, 'muted', -16],
          [percent(it.percent), 'big', 16],
        ]
  return {
    cell: { id: it.id, it, cx: -width / 2 + GROWN.pad + GROWN.ring / 2, cy, d: GROWN.ring, label: false, step: 0 },
    lines: texts.map(([text, cls, dy], i) => ({ text, cls, x, y: cy + dy, step: i + 1, max: cls === 'big' ? undefined : max })),
  }
}

/**
 * Where everything is: one device is its detail at once; otherwise a row of rings, or with one `grown`, its detail
 * above a small row of every device, hidden ones included, with a gap where the grown one came from, so a switch
 * moves two rings only.
 */
export function layout(all: readonly Item[], grown: string | undefined, lang: Lang): { cells: Cell[]; lines: Line[] } {
  const { width, height } = panelSize(all, grown)
  if (all.length === 1) {
    const { cell, lines } = detail(all[0], width, height / 2, lang)
    return { cells: [cell], lines }
  }
  const it = all.find((o) => o.id === grown)
  if (it) {
    const { cell, lines } = detail(it, width, 58, lang)
    const cy = GROWN.height - 18 - GROWN.small / 2
    const small = all.map((o, j) => ({
      id: o.id,
      it: o,
      cx: (j - (all.length - 1) / 2) * GROWN.slot,
      cy,
      d: GROWN.small,
      label: false,
      step: 3 + j,
    }))
    return { cells: [cell, ...small.filter((c) => c.id !== it.id)], lines }
  }
  const { shown, hidden } = row(all)
  const slots = shown.length + (hidden.length ? 1 : 0)
  const slot = Math.min(PANEL.slot, (width - 2 * PANEL.side) / slots)
  const x = (i: number) => (i - (slots - 1) / 2) * slot
  const cells: Cell[] = shown.map((o, i) => ({ id: o.id, it: o, cx: x(i), cy: PANEL.row, d: PANEL.ring, label: true, step: i }))
  if (hidden.length) {
    const i = slots - 1
    cells.push({ id: 'more', it: hidden[0], more: hidden, cx: x(i), cy: PANEL.row, d: PANEL.ring, label: false, step: i })
  }
  return { cells, lines: [] }
}

/** The PC's first line: its state after its name, when there is one. */
export function title(it: Item, lang: Lang): string {
  const state = WORDS[lang].state
  if (!it.pc) return it.name
  const what = it.plugged ? state.charging : low(it) ? state.low : it.saver ? state.saver : ''
  return what ? `${it.name} · ${what}` : it.name
}

/** The PC's third line: the time to full, rounded by Rust, or the time left. */
export function info(it: Item, lang: Lang): string {
  const words = WORDS[lang]
  if (it.plugged) return it.full ? words.toFull(duration(it.full)) : cap(words.plugged)
  return it.minutes ? words.left(duration(it.minutes)) : cap(words.battery)
}

/** A ring's spoken name: its name and level, then for the PC its time, energy saver and a low battery. */
export function spoken(it: Item, lang: Lang): string {
  const words = WORDS[lang]
  const parts = [it.name, it.percent === null ? words.unknown : percent(it.percent)]
  if (it.pc && it.plugged) parts.push(it.full ? words.charging(duration(it.full)) : words.plugged)
  else if (it.pc) parts.push(it.minutes ? words.remaining(duration(it.minutes)) : words.battery)
  if (it.saver) parts.push(words.saver)
  if (low(it)) parts.push(words.low.toLowerCase())
  return parts.join(', ')
}

/** "+N"'s spoken name: each device it stands for. */
export const others = (hidden: readonly Item[], lang: Lang): string =>
  WORDS[lang].others(hidden.length) +
  hidden.map((d) => `${d.name}, ${d.percent === null ? WORDS[lang].unknown : percent(d.percent)}`).join(WORDS[lang].and)

/** What a screen reader hears as the panel opens: every device, hidden ones too. */
export const readOut = (all: readonly Item[], lang: Lang): string =>
  `Batteries. ${all.map((it) => spoken(it, lang)).join('. ')}.`

/**
 * The bar's chip, which is the answer: the laptop's level and where its power comes from, then each connected device
 * by what it is, « Casque 80 % ». Before Rust has answered, it is just the word.
 */
export function answer(battery: Battery | undefined, lang: Lang): string {
  const words = WORDS[lang]
  if (!battery) return words.title
  const devices = items(battery, lang).flatMap((it) =>
    it.kind === 'laptop' ? [] : [`${words.kind[it.kind]} ${percent(it.percent)}`],
  )
  if (battery.percent === null) return devices.length ? devices.join(' · ') : words.none
  const supply = battery.plugged
    ? words.plugged
    : battery.minutes
      ? words.about(duration(battery.minutes))
      : words.battery
  return [percent(battery.percent), supply, ...devices].join(' · ')
}

/** Whether the bar's Enter opens the panel: not on a PC without a battery or a device. */
export const opens = (battery: Battery | undefined): boolean =>
  !!battery && (battery.percent !== null || battery.devices.length > 0)

/** A peek's text: the level; the laptop's level and its time left or that it is low; a device's level and name. */
export function lines(power: Power, lang: Lang): string[] {
  const words = WORDS[lang]
  if (power.kind === 'plugged') return [percent(power.percent)]
  if (power.kind === 'low') return [percent(power.percent), power.minutes ? words.left(duration(power.minutes)) : words.low]
  const { name, percent: level } = power.device
  // Without a level, a device connecting shows its name instead.
  if (level === null) return [name]
  return power.kind === 'device' ? [percent(level)] : [percent(level), name]
}

/** What a screen reader hears as a peek shows. */
export function said(power: Power, lang: Lang): string {
  const words = WORDS[lang]
  if (power.kind === 'plugged') return `${cap(words.plugged)}, ${percent(power.percent)}`
  if (power.kind === 'low') {
    const left = power.minutes ? `, ${words.remaining(duration(power.minutes))}` : ''
    return `${words.low}, ${percent(power.percent)}${left}`
  }
  const { name, percent: level } = power.device
  if (power.kind === 'deviceLow') return `${words.low}, ${name}, ${percent(level)}`
  if (level === null) return words.connected(name)
  return `${words.connected(name)}, ${percent(level)}${level <= LOW ? `, ${words.low.toLowerCase()}` : ''}`
}

/**
 * Whether a device connecting may peek: not when it peeked less than `QUIET` ago, as a headset out of range for a
 * moment. Records the peek, so ask only once it would show: one dropped in a game or under the bar doesn't count. The
 * times live in memory only.
 */
export function fresh(heard: Map<string, number>, name: string, now: number): boolean {
  const last = heard.get(name)
  if (last !== undefined && now - last < QUIET) return false
  heard.set(name, now)
  return true
}
