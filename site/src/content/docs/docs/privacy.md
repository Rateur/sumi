---
title: Privacy
description: Sumi collects nothing.
---

Sumi has no account, no telemetry and no analytics. What it shows comes from Windows and stays on your PC: the music's title, artist and artwork, which apps use the microphone or the camera, and the battery of your PC and of your Bluetooth devices. For a JBL speaker's battery, Sumi connects to your own speaker over Bluetooth LE for a moment; nothing leaves the PC.

## The network

The weather is Sumi's first and only network request, and it is opt-in:

- Nothing is sent until you ask for the weather in the command bar and press Enter. The first time, the bar says what will be sent and waits for your yes; Esc says no.
- Each time you ask, [Open-Meteo](https://open-meteo.com) gets the city you typed, its coordinates and, like any website, your IP address, which it keeps in its logs for up to 90 days: see its [terms](https://open-meteo.com/en/terms). Never your own location.
- Your yes and the city you last asked for stay on this PC, encrypted by Windows for your account, until you pick **Forget the weather** in the tray icon's menu. The answers are never cached or written to disk.

See [Weather](../weather/). Update checks, in a later version, will ask GitHub for the latest version, and will stay off until you turn them on.

## On your PC

Nothing the island shows is written to a log. Only two things go to a file, encrypted by Windows for your account: the clipboard history once you allow it, and your yes to the weather with the city you last asked for. Both stay on this PC, and the clipboard history is never sent anywhere. See [Clipboard history](../clipboard/). The capture's frozen screen stays in memory, never on the disk, and is freed as soon as the capture ends. Its text is read on this PC by Windows. See [Capture](../capture/). Battery levels are read when Windows says they changed, and are never kept. The few Sumi reads itself, from Fast Pair earbuds and game controllers, travel only over Bluetooth or the Xbox adapter, between the device and your PC.

The command bar opens the app or site you pick with your question; Sumi sends it nowhere, and the app list stays in memory. The clipboard history opens a link in your browser, a new message in your mail app or a folder in File Explorer only when you pick that with Tab and Enter.

## This site

This site is hosted on GitHub Pages, serves its own fonts and loads no tracker.
