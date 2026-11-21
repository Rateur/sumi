---
title: Weather
description: A city's weather, from the command bar.
---

Type `weather in Paris` in the command bar and press Enter. The island shows the weather for 4 seconds, then what it showed before. Nothing is sent before you press Enter.

## What to type

- **A city**: `weather Paris`, `weather in Paris`, or in French `météo Lyon` or `météo à Lyon`.
- **Tomorrow**: add `tomorrow` or `demain`: `weather in Paris tomorrow`.
- **The same city again**: `weather` alone, for the city you last asked for, even after a restart. Before the first one, the chip says "Weather · type a city" and Enter does nothing.

The chip shows what Enter will ask, such as "Weather Paris tomorrow", before anything is sent. `temps` and questions such as `what's the weather like in Rome` stay questions for Claude.

## The first time

The first time you press Enter on the weather, nothing is sent yet. The bar says "Open-Meteo will get "Paris" and your IP." and the chip says "Allow". Press Enter to allow it, or Esc to close the bar: then nothing is sent and nothing is kept.

Your yes stays after a restart. To take it back, right-click Sumi's icon by the clock and pick **Forget the weather**. Sumi forgets the city too, and the bar asks again next time.

## The peek

For 4 seconds, a glyph, then "Paris · 12° · Cloudy" and below it the day's low and high, "10° / 14°". When rain is likely later today, 50 % or more in an hour still to come, the second line says "Rain around 2 pm" instead. Tomorrow reads "Paris tomorrow · Showers", then its low and high.

- **Six glyphs**: sun, moon on a clear night, cloud (fog too), rain, snow and storm.
- **"City not found"** or **"No connection"** shows for 2 seconds when Open-Meteo has no such city or can't be reached.
- **Degrees** are Celsius, or Fahrenheit when Windows is set to English (United States).
- **Open-Meteo**, in the bottom right corner, opens their website.

## Privacy

The weather is the only thing in Sumi that uses the network, and only after you allow it.

- **What leaves your PC**, each time you ask: the city you typed goes to Open-Meteo's geocoding service, then its coordinates, never your own location, to their forecast service. Like any website, Open-Meteo sees your IP address, and keeps it in its logs for up to 90 days: see their [terms](https://open-meteo.com/en/terms).
- **What Sumi keeps**: your yes and the city you last asked for, on this PC, encrypted by Windows for your account, until you pick **Forget the weather**. Nothing goes to a log, and the answers are never cached.
- Nothing is sent while you type, and nothing at launch.

## Limits

- One place per name: the one Open-Meteo finds first, usually the best known. The peek shows its name only, not its country.
- No weather at rest, no alerts and no hourly view yet.

## Credits

Weather data by [Open-Meteo](https://open-meteo.com), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
