---
title: Battery
description: A peek as you plug in, when the battery runs low, and when a headset connects.
---

On a laptop, the island tells you when you plug in and when the battery runs low. Bluetooth devices that report their battery to Windows, such as headsets, mice and controllers, get the same: a peek as they connect, and a warning when they run low.

## What you see

- **Plug in**: a white bolt draws itself, then the level, `47 %`, for 2 seconds. Only while the island is out: tucked, in a game or during a call, nothing shows.
- **At 20 %**: a red battery, the level, and the time left when Windows knows it, otherwise "Low battery", for 3 seconds. Once per discharge. During a game, a call or while Windows says you're busy, it waits, and shows once the island is back if you're still on battery. It brings a tucked island back.
- **A device connects**: what it is (a headset, a mouse or a controller), its name and its level. At 20 %, the red battery with its name, once until it's charged again.

Nothing shows when you unplug, when the battery is full, or in energy saver.

## In the command bar

Type `battery` or `battery level`, or in French `batterie`, `autonomie` or `niveau de batterie`. The chip is the answer: `47 % · plugged in`, `47 % · about 2 h 10 left` or `47 % · on battery`, then each connected device, such as `Headset 80 %`. Enter closes the bar. On a PC without a battery or such a device, it says "This PC has no battery".

## Limits

- A device's level is the one Windows shows in Settings > Bluetooth & devices. A device that doesn't give Windows its level shows nothing.
- A device peeks with the first level Windows reads after it connects. A level kept from last time never shows.
- Phones and computers are left out: they show their own battery.
- "Plugged in" doesn't say whether the battery is charging: PC makers report it differently.
- The warning comes at 20 %. Settings, in 0.9, will let you choose.

## Privacy

The levels come from Windows when they change, and stay on your PC. Nothing is logged, stored or sent.
