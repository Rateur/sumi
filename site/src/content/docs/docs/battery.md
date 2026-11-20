---
title: Battery
description: Every battery in one panel, and a peek as you plug in, when the battery runs low, and when a headset connects.
---

The island shows your laptop's battery and the Bluetooth devices that report theirs to Windows, such as headsets, speakers, controllers, mice and keyboards, and JBL speakers, which Sumi asks itself. Nothing new sits on it at rest: the batteries open when you ask, and a peek comes when something happens.

## The batteries panel

- **Open it** from the command bar: type `battery` and press Enter. A click on any battery peek opens it too.
- **One ring per device**, the PC first, then by kind and by name, so the row never moves around. The ring fills to the level, written under it.
- **Green** is fine. **Red** is 20 % or less on battery, even with energy saver on. **Amber** is energy saver above that. A small bolt on the PC's ring means it's plugged in.
- **Click a ring** to see its detail: the device's name and level, and for the PC whether it's charging, saving energy or low, with the time left or until full. Click it again, or press Esc, to go back.
- **Five rings at most**: past that, the last one counts the others, `+3`. A device at 20 % or less always keeps its ring.
- **A headset, a speaker or a controller Windows gives no level for** comes last, as a grey ring with a dash for its level. Its detail says Windows doesn't report its battery.
- With one device only, the panel shows its detail at once.
- **From the command bar**, the arrow keys move between the rings, Enter shows a ring's detail, and Esc goes back, then closes.

## Peeks

- **Plug in**: a white bolt draws itself, then the level and a small green battery, for 2 seconds. Tucked, the island comes out for it and tucks again after, unless you used it meanwhile. In a game or during a call, nothing shows.
- **At 20 %**: a red battery, the level, and the time left when Windows knows it, otherwise "Low battery", for 3 seconds. Once per discharge. During a game, a call or while Windows says you're busy, it waits, and shows once the island is back if you're still on battery. It brings a tucked island back.
- **A headset, a speaker or a controller connects**: what it is, its level and a ring, for 3 seconds, out of the line and back as for plugging in. Red at 20 % or less, and that's its low warning. If Windows gives no level for it, its name instead. The same device doesn't peek again within 30 minutes.
- **A device at 20 %**: a red ring, its level and its name. A mouse or a keyboard peeks only then: they reconnect each time they wake.

Nothing shows when you unplug, when the battery is full, or in energy saver.

## JBL speakers

Windows has no level for most JBL speakers: they give theirs only to JBL's app. Sumi asks the speaker itself.

- **As it connects**, Sumi listens up to 5 seconds for the speaker's Bluetooth LE signal, connects to it for a moment, asks for its info once, reads the battery, and lets go. Its peek waits for the answer, 10 seconds at most.
- **Again** when you open the batteries panel, and every 15 minutes while it stays connected.
- Sumi sends the speaker nothing else. If it doesn't answer, it shows without a level.

Models: Boombox, Boombox 2 and 3, Charge 3, 4, 5 and 6, Clip 5, Flip 4, 5, 6 and 7, Go 4, Go 4 Duo, Pulse 3, 4 and 5, Tuner 3, Xtreme 2, 3 and 4. Only the Go 4 was tried with Sumi so far. The Go 5, Grip, Xtreme 5, Boombox 4 and the Essential 3 SE speak a newer protocol and show without a level.

The list of models and the way to ask come from [JBLControl](https://github.com/ffrafat/JBLControl), MIT licence, itself built on [OpenJBL](https://github.com/NiceDayZc/openjbl). Thanks to both.

## In the command bar

Type `battery`, or just `bat`, or `battery level`, or in French `batterie`, `autonomie` or `niveau de batterie`. The chip is the answer: `64 % · about 3 h 10 left`, `64 % · plugged in` or `64 % · on battery`, then each device, such as `Headset 80 %`. Enter opens the panel. On a PC without a battery or such a device, the chip says "This PC has no battery" and Enter does nothing.

## Limits

- A device's level is the one Windows shows in Settings > Bluetooth & devices. Many speakers give theirs only to their maker's app: apart from the JBL speakers above, they show without a level. A mouse or a keyboard without one shows nothing.
- A device's level only shows once Windows reads it after the device connects. A level kept from last time never shows.
- Phones and computers are left out: they show their own battery.
- Windows doesn't say whether a Bluetooth device is charging: only the PC gets the bolt.
- "Full in" shows after 2 minutes on mains, rounded up to 10 minutes. Before that, or if Windows gives no charge rate, the panel says "Plugged in".
- The warning comes at 20 %. Settings, in 0.9, will let you choose.

## Privacy

The levels come from Windows when they change, and stay on your PC. A JBL speaker's comes from a short Bluetooth LE connection to your own speaker. Nothing is logged, stored or sent. When each device last peeked is kept in memory only, and forgotten when Sumi quits.
