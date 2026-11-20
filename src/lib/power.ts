import type { Lang } from './intent'

/** A connected device's battery. Mirrored in src-tauri/src/power.rs. */
export interface Device {
  name: string
  glyph: 'headset' | 'mouse' | 'controller' | 'other'
  percent: number
}

/**
 * What the command bar reads as it opens: the laptop's level, null without a battery, whether it is plugged in, the
 * minutes left when Windows knows them, and the connected devices that report a battery. Mirrored in power.rs.
 */
export interface Battery {
  percent: number | null
  plugged: boolean
  minutes: number | null
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

/**
 * A low battery waits until the island can show it, and brings it back from its line. Plugging in and a device
 * connecting show only while the island is out, and are dropped otherwise.
 */
export const waits = (power: Power): boolean => power.kind === 'low' || power.kind === 'deviceLow'

const WORDS = {
  fr: {
    title: 'Batterie',
    mains: 'Sur secteur',
    about: (t: string) => `environ ${t}`,
    left: (t: string) => `Environ ${t}`,
    battery: 'sur batterie',
    plugged: 'sur secteur',
    none: 'Pas de batterie sur ce PC',
    low: 'Batterie faible',
    glyph: { headset: 'Casque', mouse: 'Souris', controller: 'Manette' },
  },
  en: {
    title: 'Battery',
    mains: 'Plugged in',
    about: (t: string) => `about ${t} left`,
    left: (t: string) => `About ${t} left`,
    battery: 'on battery',
    plugged: 'plugged in',
    none: 'This PC has no battery',
    low: 'Low battery',
    glyph: { headset: 'Headset', mouse: 'Mouse', controller: 'Controller' },
  },
} as const

/** A level, with a narrow no-break space before the sign, so it never wraps. */
export const percent = (n: number): string => `${Math.round(n)}\u202f%`

/** Minutes as the island says them: « 1 h 05 », or « 45 min » under an hour. */
export function duration(minutes: number): string {
  const [h, m] = [Math.floor(minutes / 60), minutes % 60]
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

/** A device in the bar's answer: what it is, « Casque 80 % », or its name when it is none of those. */
const named = (d: Device, lang: Lang) => `${d.glyph === 'other' ? d.name : WORDS[lang].glyph[d.glyph]} ${percent(d.percent)}`

/**
 * The bar's chip, which is the answer: the laptop's level and where its power comes from, then each connected device.
 * "Plugged in" never says charging or charged, so it holds whatever the PC's maker reports. Before Rust has answered,
 * it is just the word.
 */
export function answer(battery: Battery | undefined, lang: Lang): string {
  const words = WORDS[lang]
  if (!battery) return words.title
  const devices = battery.devices.map((d) => named(d, lang))
  if (battery.percent === null) return devices.length ? devices.join(' · ') : words.none
  const supply = battery.plugged
    ? words.plugged
    : battery.minutes
      ? words.about(duration(battery.minutes))
      : words.battery
  return [percent(battery.percent), supply, ...devices].join(' · ')
}

/**
 * A peek's lines of text: the level after the bolt; the level and the time left, or that it is low; a device's name
 * and level as it connects; its level and name when it runs low.
 */
export function lines(power: Power, lang: Lang): string[] {
  const words = WORDS[lang]
  if (power.kind === 'plugged') return [percent(power.percent)]
  if (power.kind === 'low') return [percent(power.percent), power.minutes ? words.left(duration(power.minutes)) : words.low]
  const { name, percent: level } = power.device
  return power.kind === 'device' ? [name, percent(level)] : [percent(level), name]
}

/** What a screen reader hears as a peek shows: its lines, after what they are about when they don't say it. */
export function spoken(power: Power, lang: Lang): string {
  const words = WORDS[lang]
  const said = lines(power, lang)
  if (power.kind === 'plugged') said.unshift(words.mains)
  if (power.kind === 'deviceLow' || (power.kind === 'low' && power.minutes)) said.unshift(words.low)
  return said.join(' · ')
}

/** The level a peek fills its battery to, from 0 to 1. */
export const charge = (power: Power): number =>
  Math.min(1, Math.max(0, ('device' in power ? power.device.percent : power.percent) / 100))
