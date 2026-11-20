---
title: Privacy
description: Sumi collects nothing.
---

Sumi has no account, no telemetry and no analytics. What it shows comes from Windows and stays on your PC: the music's title, artist and artwork, which apps use the microphone or the camera, and the battery of your PC and of your Bluetooth devices.

## The network

The weather is Sumi's first and only network request, and it is opt-in each session:

- Nothing is sent until you ask for the weather in the command bar and press Enter. The first time after Sumi starts, the bar says what will be sent and waits for your yes; Esc says no.
- [Open-Meteo](https://open-meteo.com) then gets the city you typed, its coordinates and, like any website, your IP address, which it keeps in its logs for up to 90 days: see its [terms](https://open-meteo.com/en/terms). Never your own location.
- Your yes and the city found stay in memory until Sumi quits. The answers are never cached or written to disk.

See [Weather](../weather/). Update checks, in a later version, will ask GitHub for the latest version, and will stay off until you turn them on.

## On your PC

What the island shows from your PC is never written to a log or a file. Battery levels are read when Windows says they changed, and are never kept.

The command bar opens the app or site you pick with your question; Sumi sends it nowhere, and the app list stays in memory.

## This site

This site is hosted on GitHub Pages, serves its own fonts and loads no tracker.
