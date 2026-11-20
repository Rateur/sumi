/**
 * The weather the command bar asks for: Open-Meteo's two links, a WMO code's glyph and words, the consent sentence,
 * and the peek's two lines. No DOM and no network here: Island.svelte asks, after a yes given in the bar, and keeps
 * the yes and the city in memory for the session only.
 */

import type { Lang } from './intent'

/** The peek's six glyphs. Fog is a cloud, and a clear night is the moon. */
export type Glyph = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'storm'

/** A city found by name: what the peek calls it and where it is. */
export interface City {
  name: string
  lat: number
  lon: number
}

/** The part of Open-Meteo's forecast the peek reads, in the city's own time: '2026-11-20T21:15'. */
export interface Forecast {
  current: { time: string; temperature_2m: number; weather_code: number; is_day: number }
  hourly: { time: string[]; precipitation_probability: (number | null)[] }
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
}

/** What the peek shows: a glyph, then « Lyon · 14° · Nuageux » over « 9° / 17° » or « Pluie vers 16 h ». */
export interface Sky {
  glyph: Glyph
  lines: [string, string]
}

/** How long the peek shows, and an error, in ms. */
export const WEATHER_PEEK = 4000
export const WEATHER_ERROR = 2000

/** How long both requests may take before the peek says there is no connection, in ms. */
export const TIMEOUT = 8000

/** Never cached, so WebView2 writes nothing to disk; no cookie and no referrer go with it. */
export const FETCH: RequestInit = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }

/** The longest city the consent sentence shows whole, in characters. */
const LONGEST = 11

/** An hour still to come today with this rain chance or more, in %, gives the rain line. */
export const RAIN = 50

const WORDS = {
  fr: {
    weather: 'Météo',
    tomorrow: 'demain',
    city: 'tapez une ville',
    consent: (city: string) => `Open-Meteo recevra « ${city} » et votre IP.`,
    allow: 'Autoriser',
    offline: 'Pas de réseau',
    unknown: 'Ville introuvable',
    rain: (h: number) => `Pluie vers ${h} h`,
  },
  en: {
    weather: 'Weather',
    tomorrow: 'tomorrow',
    city: 'type a city',
    consent: (city: string) => `Open-Meteo will get "${city}" and your IP.`,
    allow: 'Allow',
    offline: 'No connection',
    unknown: 'City not found',
    rain: (h: number) => `Rain around ${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`,
  },
} as const

/** The words the bar and the island say around the weather. */
export { WORDS as WEATHER_WORDS }

// The WMO codes Open-Meteo sends (https://open-meteo.com/en/docs), each with its glyph and its words.
const CODES: [codes: number[], glyph: Glyph, fr: string, en: string][] = [
  [[0], 'sun', 'Dégagé', 'Clear'],
  [[1], 'sun', 'Peu nuageux', 'Mostly clear'],
  [[2], 'cloud', 'Nuageux', 'Cloudy'],
  [[3], 'cloud', 'Couvert', 'Overcast'],
  [[45, 48], 'cloud', 'Brouillard', 'Fog'],
  [[51, 53, 55], 'rain', 'Bruine', 'Drizzle'],
  [[56, 57], 'rain', 'Bruine verglaçante', 'Freezing drizzle'],
  [[61, 63], 'rain', 'Pluie', 'Rain'],
  [[65], 'rain', 'Forte pluie', 'Heavy rain'],
  [[66, 67], 'rain', 'Pluie verglaçante', 'Freezing rain'],
  [[71, 73], 'snow', 'Neige', 'Snow'],
  [[75], 'snow', 'Forte neige', 'Heavy snow'],
  [[77], 'snow', 'Grésil', 'Snow grains'],
  [[80, 81], 'rain', 'Averses', 'Showers'],
  [[82], 'rain', 'Fortes averses', 'Heavy showers'],
  [[85, 86], 'snow', 'Averses de neige', 'Snow showers'],
  [[95], 'storm', 'Orage', 'Thunderstorm'],
  [[96, 99], 'storm', 'Orage et grêle', 'Thunderstorm, hail'],
]

/** A code's glyph and words. The sun is the moon at night; a code Open-Meteo adds later is a cloud, unnamed. */
export function sky(code: number, day: boolean, lang: Lang): { glyph: Glyph; word: string } {
  const row = CODES.find(([codes]) => codes.includes(code))
  if (!row) return { glyph: 'cloud', word: '' }
  const [, glyph, fr, en] = row
  return { glyph: glyph === 'sun' && !day ? 'moon' : glyph, word: lang === 'fr' ? fr : en }
}

/** The glyphs, drawn white on the 24-unit grid of the island's icons. */
export const DRAWINGS: Record<Glyph, string> = {
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z',
  cloud: 'M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a4.25 4.25 0 0 1 .5 8.5Z',
  rain: 'M7 15a3.5 3.5 0 0 1-.4-6.98A5 5 0 0 1 16.2 7a3.75 3.75 0 0 1 .8 8ZM8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3',
  snow: 'M7 15a3.5 3.5 0 0 1-.4-6.98A5 5 0 0 1 16.2 7a3.75 3.75 0 0 1 .8 8ZM8 18.5h.01M12 20.5h.01M16 18.5h.01',
  storm: 'M7 15a3.5 3.5 0 0 1-.4-6.98A5 5 0 0 1 16.2 7a3.75 3.75 0 0 1 .8 8ZM12.5 15.5 10.5 19h3l-2 3.5',
}

/** The chip while typing: « Météo Lyon », « Météo Lyon demain », or « Météo · tapez une ville » without a city. */
export function chip(city: string | undefined, day: 0 | 1, lang: Lang): string {
  const words = WORDS[lang]
  if (!city) return `${words.weather} · ${words.city}`
  return [words.weather, city, ...(day ? [words.tomorrow] : [])].join(' ')
}

/**
 * The consent sentence the field shows, the city cut so the sentence ends inside the 480 px bar: « Open-Meteo recevra
 * « Saint-Rémy… » et votre IP. ». A screen reader hears it whole.
 */
// shortcut: a long city is cut at a count of characters, not measured; measure the field if a city still overflows
export function consent(city: string, lang: Lang): string {
  const shown = city.length > LONGEST ? `${city.slice(0, LONGEST - 1).replace(/[\s-]+$/, '')}…` : city
  return WORDS[lang].consent(shown)
}

/** Where the city is looked up. `encodeURIComponent` makes a space %20 and an accent its UTF-8 bytes. */
export function geocoding(city: string, lang: Lang): string {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${lang}`
}

/** Where its forecast comes from: the city's coordinates, never the user's own place. */
export function forecast(city: City, fahrenheit: boolean): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&hourly=precipitation_probability&timezone=auto&forecast_days=2' +
    (fahrenheit ? '&temperature_unit=fahrenheit' : '')
  )
}

/** Degrees Fahrenheit for a US region, as the island's language says it: 'en-US'. */
export const fahrenheit = (language: string): boolean => {
  try {
    return new Intl.Locale(language).region === 'US'
  } catch {
    return false
  }
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const numbers = (list: unknown, n: number): list is number[] =>
  Array.isArray(list) && list.length >= n && list.slice(0, n).every(isNumber)

/** The first city of a geocoding answer, or nothing when it found none or sent something else. */
export function cityOf(json: unknown): City | undefined {
  const first = (json as { results?: unknown[] } | null)?.results?.[0] as Record<string, unknown> | undefined
  if (!first || typeof first.name !== 'string' || !isNumber(first.latitude) || !isNumber(first.longitude)) return
  return { name: first.name, lat: first.latitude, lon: first.longitude }
}

/** A forecast answer the peek can read, or nothing. */
export function forecastOf(json: unknown): Forecast | undefined {
  const f = json as Partial<Forecast> | null
  const { current, hourly, daily } = f ?? {}
  if (typeof current?.time !== 'string' || !isNumber(current.temperature_2m) || !isNumber(current.weather_code)) return
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.precipitation_probability)) return
  if (!Array.isArray(daily?.time) || daily.time.length < 2 || !numbers(daily.weather_code, 2)) return
  if (!numbers(daily.temperature_2m_max, 2) || !numbers(daily.temperature_2m_min, 2)) return
  return f as Forecast
}

/** The first hour still to come today with a rain chance of `RAIN` % or more: « Pluie vers 16 h ». */
export function rain(f: Forecast, lang: Lang): string | undefined {
  const { time, precipitation_probability: chance } = f.hourly
  const i = time.findIndex((t, i) => t.startsWith(f.daily.time[0]) && t > f.current.time && (chance[i] ?? 0) >= RAIN)
  return i < 0 ? undefined : WORDS[lang].rain(Number(time[i].slice(11, 13)))
}

const degrees = (t: number) => `${Math.round(t)}°`

/** The peek for today (`day` 0) or tomorrow (1), under the name Open-Meteo gave the city. */
export function peek(city: string, day: 0 | 1, f: Forecast, lang: Lang): Sky {
  const { daily } = f
  const range = `${degrees(daily.temperature_2m_min[day])} / ${degrees(daily.temperature_2m_max[day])}`
  if (day) {
    const { glyph, word } = sky(daily.weather_code[1], true, lang)
    return { glyph, lines: [[`${city} ${WORDS[lang].tomorrow}`, word].filter(Boolean).join(' · '), range] }
  }
  const { glyph, word } = sky(f.current.weather_code, f.current.is_day !== 0, lang)
  const first = [city, degrees(f.current.temperature_2m), word].filter(Boolean).join(' · ')
  return { glyph, lines: [first, rain(f, lang) ?? range] }
}
