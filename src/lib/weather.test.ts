import { describe, expect, it } from 'vitest'
import { chip, cityOf, consent, fahrenheit, forecast, forecastOf, geocoding, peek, rain, sky, type Forecast } from './weather'

// Lyon's forecast as Open-Meteo sent it on 20 November 2026 at 21:15, the hours cut to that day.
const lyon: Forecast = {
  current: { time: '2026-11-20T21:15', temperature_2m: 11.5, weather_code: 2, is_day: 0 },
  hourly: {
    time: Array.from({ length: 24 }, (_, h) => `2026-11-20T${String(h).padStart(2, '0')}:00`),
    precipitation_probability: [0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 3, 5, 25, 65, 38, 18, 20, 10, 8, 15, 10, 8, 8],
  },
  daily: {
    time: ['2026-11-20', '2026-11-21'],
    weather_code: [80, 80],
    temperature_2m_max: [14.3, 14.1],
    temperature_2m_min: [10.3, 9.4],
  },
}

// The same day at 11:15, with rain on its way at 14 h.
const morning: Forecast = { ...lyon, current: { ...lyon.current, time: '2026-11-20T11:15', is_day: 1 } }

describe('the WMO table', () => {
  it.each([
    [0, 'sun', 'Dégagé', 'Clear'],
    [1, 'sun', 'Peu nuageux', 'Mostly clear'],
    [2, 'cloud', 'Nuageux', 'Cloudy'],
    [3, 'cloud', 'Couvert', 'Overcast'],
    [45, 'cloud', 'Brouillard', 'Fog'],
    [48, 'cloud', 'Brouillard', 'Fog'],
    [51, 'rain', 'Bruine', 'Drizzle'],
    [57, 'rain', 'Bruine verglaçante', 'Freezing drizzle'],
    [61, 'rain', 'Pluie', 'Rain'],
    [65, 'rain', 'Forte pluie', 'Heavy rain'],
    [67, 'rain', 'Pluie verglaçante', 'Freezing rain'],
    [71, 'snow', 'Neige', 'Snow'],
    [75, 'snow', 'Forte neige', 'Heavy snow'],
    [77, 'snow', 'Grésil', 'Snow grains'],
    [80, 'rain', 'Averses', 'Showers'],
    [82, 'rain', 'Fortes averses', 'Heavy showers'],
    [86, 'snow', 'Averses de neige', 'Snow showers'],
    [95, 'storm', 'Orage', 'Thunderstorm'],
    [99, 'storm', 'Orage et grêle', 'Thunderstorm, hail'],
  ] as const)('gives code %i a %s, « %s », "%s"', (code, glyph, fr, en) => {
    expect(sky(code, true, 'fr')).toEqual({ glyph, word: fr })
    expect(sky(code, true, 'en')).toEqual({ glyph, word: en })
  })

  it('shows the moon on a clear night, and nothing else changes at night', () => {
    expect(sky(0, false, 'fr').glyph).toBe('moon')
    expect(sky(1, false, 'en').glyph).toBe('moon')
    expect(sky(61, false, 'fr').glyph).toBe('rain')
  })

  it('draws an unknown code as a cloud, unnamed', () => {
    expect(sky(42, true, 'fr')).toEqual({ glyph: 'cloud', word: '' })
  })
})

describe('the rain rule', () => {
  it('names the first hour still to come today at 50 % or more', () => {
    expect(rain(morning, 'fr')).toBe('Pluie vers 14 h')
    expect(rain(morning, 'en')).toBe('Rain around 2 pm')
  })

  it('says nothing once those hours are past, or under 50 %', () => {
    expect(rain(lyon, 'fr')).toBeUndefined()
    const dry = { ...morning, hourly: { ...morning.hourly, precipitation_probability: morning.hourly.time.map(() => 49) } }
    expect(rain(dry, 'fr')).toBeUndefined()
  })

  it('never counts the hour already started, nor tomorrow', () => {
    const now = { ...morning, current: { ...morning.current, time: '2026-11-20T14:00' } }
    expect(rain(now, 'fr')).toBeUndefined()
    const late = {
      ...lyon,
      hourly: { time: ['2026-11-20T23:00', '2026-11-21T09:00'], precipitation_probability: [0, 90] },
    }
    expect(rain(late, 'fr')).toBeUndefined()
  })

  it('says the morning and noon in English', () => {
    const at = (h: number) => ({
      ...morning,
      current: { ...morning.current, time: '2026-11-20T06:00' },
      hourly: { time: [`2026-11-20T${String(h).padStart(2, '0')}:00`], precipitation_probability: [50] },
    })
    expect(rain(at(9), 'en')).toBe('Rain around 9 am')
    expect(rain(at(12), 'en')).toBe('Rain around 12 pm')
  })
})

describe('the peek', () => {
  it('shows today: the city, the degrees and the sky, then the low and the high', () => {
    expect(peek('Lyon', 0, lyon, 'fr')).toEqual({ glyph: 'cloud', lines: ['Lyon · 12° · Nuageux', '10° / 14°'] })
  })

  it('shows the rain to come instead of the low and the high', () => {
    expect(peek('Lyon', 0, morning, 'en').lines).toEqual(['Lyon · 12° · Cloudy', 'Rain around 2 pm'])
  })

  it('shows tomorrow without degrees on the first line, by day', () => {
    expect(peek('Lyon', 1, lyon, 'fr')).toEqual({ glyph: 'rain', lines: ['Lyon demain · Averses', '9° / 14°'] })
    expect(peek('Lyon', 1, lyon, 'en').lines[0]).toBe('Lyon tomorrow · Showers')
  })
})

describe('the chip', () => {
  it('names the city and the day, or asks for a city', () => {
    expect(chip('Lyon', 0, 'fr')).toBe('Météo Lyon')
    expect(chip('Paris', 1, 'en')).toBe('Weather Paris tomorrow')
    expect(chip(undefined, 1, 'fr')).toBe('Météo · tapez une ville')
  })
})

describe('the consent', () => {
  it('says what Open-Meteo will get, the city apart so the bar can cut it alone', () => {
    expect(consent('Lyon', 'fr')).toEqual(['Open-Meteo recevra « ', 'Lyon', ' » et votre IP.'])
    expect(consent('Paris', 'en').join('')).toBe('Open-Meteo will get "Paris" and your IP.')
  })
})

describe('the links', () => {
  it('encodes an accent and a space', () => {
    expect(geocoding('Saint-Étienne', 'fr')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=Saint-%C3%89tienne&count=1&language=fr',
    )
    expect(geocoding('New York', 'en')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=New%20York&count=1&language=en',
    )
  })

  it('keeps a typed name inside its parameter', () => {
    expect(geocoding('Lyon&count=50#', 'fr')).toContain('name=Lyon%26count%3D50%23&count=1')
  })

  it("sends the city's coordinates, in Fahrenheit for a US region only", () => {
    const city = { name: 'Lyon', lat: 45.74906, lon: 4.84789 }
    expect(forecast(city, false)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=45.74906&longitude=4.84789' +
        '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min' +
        '&hourly=precipitation_probability&timezone=auto&forecast_days=2',
    )
    expect(forecast(city, true)).toMatch(/&temperature_unit=fahrenheit$/)
    expect([fahrenheit('en-US'), fahrenheit('en-GB'), fahrenheit('fr-FR'), fahrenheit('en'), fahrenheit('')]).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('the answers', () => {
  it('reads the first city found, or none', () => {
    const json = { results: [{ name: 'Lyon', latitude: 45.74906, longitude: 4.84789, country: 'France' }] }
    expect(cityOf(json)).toEqual({ name: 'Lyon', lat: 45.74906, lon: 4.84789 })
    expect(cityOf({ generationtime_ms: 0.08 })).toBeUndefined()
    expect(cityOf({ results: [{ name: 'Lyon', latitude: '45' }] })).toBeUndefined()
    expect(cityOf(null)).toBeUndefined()
  })

  it('takes a forecast it can read, and nothing else', () => {
    expect(forecastOf(lyon)).toBe(lyon)
    expect(forecastOf({ ...lyon, daily: { ...lyon.daily, temperature_2m_max: [14.3] } })).toBeUndefined()
    expect(forecastOf({ error: true, reason: 'Latitude must be in range of -90 to 90°.' })).toBeUndefined()
    expect(forecastOf('nope')).toBeUndefined()
  })
})
