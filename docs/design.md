# Design

How the island looks and behaves. If code and this page disagree, one of them has a bug.

This is the design for 1.0. What each release already does is in the [changelog](https://github.com/Rateur/sumi/blob/main/CHANGELOG.md).

## States

| State | Size | When |
|---|---|---|
| Idle | 132 × 34 px | Nothing happening. Shows the time, or the weather if chosen. |
| Hover | 152 × 36 px | Cursor on the island, after a short rest. Adds the date, or a timer's name. |
| Compact | Call 144, timer 112 (128 from an hour), music 200 × 34 px* | An activity runs: content on the left and right ends. |
| Peek | Music 300 × 56 px*, up to 3 s; a finished timer 300 × 56 px*, 6 s; plugging in 200 × 34 px*, 2 s, and a device connecting, 3 s; a low battery 300 × 56 px*, 3 s; the weather 300 × 56 px*, 4 s | Something just happened: timer ended, charger, low battery, a device with a battery connecting, the weather asked in the command bar. A new song swells instead, see [Music](#music). The battery's are in [Battery](#battery), the weather's in [Weather](#weather). |
| Done | Timer 150 × 34 px* at least | A timer ended and waits for OK. |
| Expanded | Clock and timer 280 × 120 px*, music 360 × 164 px*, batteries 280 or 360 × 120 px*, 164 tall with a ring grown, panels up to 560 px wide | Click. Closes on Esc or a click elsewhere. Music shows the artwork, title and artist, the progress, and previous, play or pause and next. The batteries open from the command bar or a battery peek, see [Battery](#battery). |
| Bubble | 34 px circle | A second activity, or the time, 8 px right of the island. A click brings it to the island. |
| Privacy tag | 20 px circle, card 248 px wide | An app uses the microphone or the camera, or the microphone is muted. 6 px right of everything else; opens into a card under the cursor. |
| Hidden | — | A game, video or slideshow fills the main screen. Comes back compact. |
| Tucked | Line 132 × 4 px, caught over 132 × 12 px | Swiped away in any direction, from the tray, while a window is moved, or by itself at rest. See [Tuck](#tuck). |
| Welcome | Greeting max(200, text + 80) × 56 px, shortcut row text + 48 × 56 px | Once, at the first launch. |

The island sits 8 px below the top edge, centered on the chosen screen. Sizes are at 100 % scale and follow the display scale.

\* Provisional, not yet checked against the Figma frames.

## Who gets the island

When several things happen at once, the highest one takes the island, the next one the bubble, and the rest wait. Between equals, what is already shown keeps its place. A click on the bubble swaps it with the island, except over a call.

The time is last in line: it has the island when nothing runs, and the bubble when one thing does. Picked from the bubble, it keeps the island until the music ends. Otherwise it waits while two or more things run, and comes back when only one is left; a call on the island shows the time anyway.

1. Call
2. Timer that ended
3. Timer: the running one that ends first
4. Music
5. Other timers, running or paused, soonest end first
6. Time or weather

What was picked from the bubble comes right after a timer that ended. Timers go by their end rather than by what is shown, so the island always holds the next one to ring.

The weather asked in the bar shows over all of it for 4 s, as the bar's answers do. A battery peek shows over this order for a few seconds, and never covers a call or a timer's end peek. A low battery waits for them, and for the bar, an open panel, the welcome, fullscreen and while Windows says you're busy. Plugging in and a device connecting are dropped instead.

## Music

- Any player that Windows' media controls can see: Spotify, browsers, VLC and the rest. Two players at once take the island and the bubble.
- A player shows once it plays. Paused, it stays a minute, then the time comes back; playing again brings it back. A player that disappears for a moment between two songs is held for 2.5 s, so the island doesn't blink.
- A new song swells the island, unless Windows says you're busy. The title and artist are in the panel.
- The progress bar and the times are worked out from the last position Windows gave, so nothing is sent while a song plays. A live stream without a length has no bar.
- The bar can be dragged, in players that allow it. It thickens under the cursor, as on the iPhone, and stays where it is dropped until the player answers, 3 s at most. A drag that starts on the island keeps the cursor until the button is up, even past the island's edge.
- A drag on the bar ends without a seek if the panel closes or another song takes it.
- A new song swells the island when it is on the island, and the bubble when it is in the bubble.
- The artwork reaches the island as data, never as a file. Its main color is read from a 16 px copy, and lightened until it shows on black.

## Timers

- Typed in the command bar: `25m`, `1h30`, `10 min pâtes`. Each one counts down to its end on the wall clock, worked out again at each second shown, so sleep or a change of daylight saving time never makes it drift.
- Compact: a 14 px amber ring empties at the left end, and the digits sit at the right end, m:ss under an hour, h:mm:ss above. No name, unless the cursor rests on it.
- A click opens the panel: the name, or "Timer", the digits, the end time in the clock's format, and two round buttons, pause or resume and cancel. "+1" beside the name says another timer runs.
- Paused, the ring and the digits freeze at half strength, without a blink, and the timer waits below the music, so a forgotten pause never takes the island back.
- Several timers: the island shows the one that ends first, the others wait, still counting. Without a label they are numbered: "Timer 2".
- At the end, the island swells and peeks for 6 s: the full ring, the name or "Time's up", the time since the end counting up ("+0:12"), a quiet +1 min and a white OK. It then folds into the done pill, ring, name and "+3:10", whose buttons show under the cursor.
- A click on the done pill, or OK, dismisses it, and so does `stop` in the bar. Esc and a click elsewhere don't: you may not have seen it yet. +1 min starts a minute under the same name. There is no Repeat button.
- A short, soft chime made by the app every 10 s for a minute, then silence, at Windows' volume. On by default; Settings, in 0.9, will turn it off. The browser demo stays silent.
- While Windows says you're busy, a finished timer still peeks and rings: it is an alarm you set. In fullscreen only the chime plays; when the fullscreen app ends, the island drops back, swells once and shows the end.
- Timers live in memory only: quitting Sumi or restarting Windows clears them. Nothing the island shows is written to disk.

## Microphone and camera

- Apple's rule: one dot, green while an app uses a camera, with or without the microphone, orange for the microphone alone. It sits in its own 20 px black disc, 6 px right of the island or the bubble, level with the island's top row. The disc splits off the shape beside it like a drop, as the bubble does from the island, and sinks back into it. The island itself never changes for it, so the music and the time keep their places.
- The microphone comes from Windows' audio sessions, counting only those that capture right now, since Teams and others keep theirs open after a call. The camera comes from Media Foundation's sensor activity. Both call back when something changes. The registry list behind Windows' privacy page isn't read: recent Windows 11 builds stopped updating it, and a crash leaves stale entries in it for months.
- A WebView2 process counts as the app that hosts it. Names come from the exe's description, "Discord" or "Google Chrome", and otherwise from its file name.
- Rest the cursor on the disc, as on the island, and it opens into a card, width first, as the island opens: a row per app with its icon, what it uses and for how long, four at most with the last counting the rest, then the buttons. A click opens it too. It stays where it opened while open, closes 300 ms after the cursor leaves, or on Esc or a click elsewhere, and closes before the disc sinks back into the island.
- The buttons follow what is in use: mute while an app uses the microphone or it is muted; a camera button while an app films, which brings that app forward, since Windows can't turn the camera off for every app without admin rights; and Windows' privacy settings. A click on an app brings it forward too: its window, or the Store app's frame around it, restored if it was minimized and shown again if it was in the tray. When no window comes forward, Windows' privacy page opens instead.
- Icons come from the exe, as raw pixels the page paints: no image encoder in the app.
- Mute is Windows' own mute of the default microphones and of every microphone an app is capturing from at that moment, never an idle one. It counts as on only when all of those are muted. Unmute turns back on only the ones Sumi muted, or all of them when Sumi muted none. While it's on, a crossed microphone stays in the disc, even when no app listens.
- Media Foundation is loaded at run time: Windows N editions ship without it, and Sumi must still start there, with the microphone alone.

## Battery

### The batteries panel

One ring per device, the PC first, then by kind (headset, speaker, controller, mouse, keyboard, other), then by name. Waking up or reconnecting never reshuffles the row, and levels never reorder it.

- **Opens** from the command bar's `battery`, whose Enter folds the bar into it, and from a click on any battery peek. Never from the idle island: its click stays the clock's panel, with no rings. It closes as every panel does. A PC without a battery shows its devices only; with none either, the bar says "This PC has no battery" and Enter does nothing.
- **Size**: 280 × 120 px* for 2 to 4 slots, 360 × 120 px* for 5. At most 5 slots: past that, the fifth is "+N", a white track and "+N" in 13 px 600, with no level. It is no button: its spoken name lists the others, and so does the bar's chip. A device at 20 % or less swaps in for the last one shown.
- **Rings**: slots min(72, (width − 40) / slots) px wide, centred. Each ring is 44 px with a 4 px stroke, its arc from 12 o'clock clockwise with round caps, its centre 48 px from the top. Inside, the device's glyph, 20 px, drawn white on 24 units with a 1.8 stroke. Under it, 6 px down, its level: "64 %", 13 px 600 white. No names under the rings: the glyph says what it is.
- **Colours** say the state, the number the level: green `#4ADE80`; red `#F87171` at 20 % or less on battery, even with energy saver on, since Windows turns it on by itself at 20 %; amber `#FBBF24` while energy saver is on above that, for the PC only. On mains, green. The track is the ring's colour at 25 %. While on mains the PC's ring wears the plug-in bolt at 12 o'clock, white at 70 % size on a black disc of radius 6.5. Devices never do: Windows doesn't say when they charge.
- **Seven glyphs**: laptop for the PC, headset, speaker, mouse, keyboard, controller, and a battery outline for the rest. Classic earbuds report as headphones and get the headset.
- **Without a level**: a connected headset, speaker or controller Windows gives no level for comes after the devices that have one, as its glyph inside a white track at 25 %, no arc, and "—" for its level. Its spoken name is "JBL Go 4, level unknown". Grown, its detail is its name and, below, "Windows doesn't report its battery", in white, on two lines at most.
- **One device**: the panel is its detail at once, laid out as the timer's panel: a 56 px ring 24 px from the left, its centre 60 px down, then 16 px further its lines in 13 px 500 white at 60 % and its level in Segoe UI Variable Display 40 px 600. The PC has three lines, centred 28, 60 and 92 px down: "This PC", with "· charging" on mains, "· low" at 20 % or less on battery, or "· energy saver"; its level; then "About 3 h 10 left", or on mains "Full in 50 min", rounded up to 10 min and shown after 2 min on mains, with "Plugged in" before that or when Windows gives no charge rate. A device has its name, cut with an ellipsis, and its level, centred on the ring at 44 and 76 px.
- **A click on a ring grows it** to that detail, the panel 164 px tall: the ring to 56 px, its centre 58 px down, its lines 2 px higher. Every device but that one sits in a small row of 28 px rings, 40 px apart, centred 132 px down, hidden ones included, with a gap where the grown one came from. A click on a small ring grows it instead. A second click on the grown ring, or Esc, goes back to the row; Esc again closes.
- **Growing**: the levels under the rings leave in 60 ms, opacity only. The height goes from 120 to 164 on `OPEN.height` (0.52 s, bounce 0.18), and the grown ring rides it. Rings that shrink move on 0.34 s without a bounce; those dropping to the small row drop at once and slide from 40 ms. The name and the level come in at 85 and 120 ms, the PC's third line at 155. At rest by about 760 ms. **Back**: after 60 ms, `OPEN.height` without a bounce; at rest by about 830. **From one grown ring to another**, the two would cross: they leave and come in as content does, and nothing else moves.
- **Opening**, ring after ring comes in as content does, its level a step later, and its arc fills from empty on a 0.6 s spring that never bounces: an overshoot would show a level the device doesn't have. A level that changes while the panel is open springs the same way.
- **Keyboard**: opened from the bar, the panel keeps the bar's focus. Left and Right walk the rings, the grown one first, Home and End go to the first and the last, Enter or Space grows one, Esc goes back, then closes and gives the focus back. Opened by a click, it takes no focus.
- **Spoken**: as it opens, every device, hidden ones too: "Batteries. This PC, 64 %, about 3 h 10 left. UGREEN headset, 80 %." Each ring is named by its line, with "charging, full in 50 min", "energy saver" and "low battery" when they apply.

### Peeks

- **Plugging in**: the music's compact shape, 200 × 34 px*, for 2 s. A white bolt draws itself in 180 ms at the left end, then the level comes in at the right end, "64 %", then a 25 × 12 px battery after it, outlined in white at 45 %, filled green to the level. Tucked by hand or by itself, the island comes out of the line for it, as it comes back, and tucks again as the peek ends, unless you did something meanwhile. While a window is moved, in fullscreen, while you're busy or over a call, it is dropped.
- **At 20 %**: a 300 × 56 px* peek for 3 s. A red `#F87171` battery outline filled to the level, then "20 %" and, below, "About 1 h 05 left" when Windows knows the time, otherwise "Low battery". Once per discharge: on the first reading at or under 20 %, never only an exact match, since some PCs step by more than 1 %. Plugging in starts a new discharge. It waits, and shows once the island is free if you're still on battery. It brings a tucked island back.
- **A device connecting**, with the level Windows shows in its Bluetooth settings: the 200 × 34 px* compact for 3 s, its glyph at the left end, 14 px in, then at the right end its level, 14 px 600, and 6 px after it an 18 px ring with a 2.2 px stroke in the level's colour. Glyph at 50 ms, level at 85, ring at 120, its arc filling from there. No name: you just turned it on. Headsets, speakers, controllers and other devices only: a mouse or a keyboard reconnects each time it wakes, so it shows only its low peek. The same device doesn't peek again within 30 min, as a headset out of range for a moment; the time is kept in memory only. One that connects at 20 % or less shows the compact in red, and that counts as its low warning. A headset, a speaker or a controller Windows gives no level for still peeks once it has waited 5 s for one: its glyph, then its name at the right end, 13 px, cut with an ellipsis, with no level and no ring. It shows as plugging in does, out of the line and back.
- **A device at 20 %**: a 300 × 56 px* peek for 3 s, its ring at 32 px, red, with its glyph, then its level and, below, its name. Once per discharge, as for the PC.
- **A click on any battery peek** opens the batteries panel.
- **Nothing** on unplugging, a full charge or energy saver.
- Only a level read after a device connects counts: Windows keeps the last one of a device that left. Windows gives no level for many speakers, which report theirs only to their maker's app over a protocol of its own, such as the JBL Go 4. A mouse or a keyboard without one shows nothing. Phones and computers are left out: they show their own battery.
- The peeks move as a song's does; the bolt's stroke is new. **Reduced motion**: the content fades out in 120 ms, the shape and the rings change, the new content fades in over 120 ms; arcs are drawn at their level and the bolt is there at once. **Contrast theme**: the rings keep their own colours, as the dots do.
- The laptop's battery is read once at launch: without one, nothing is listened to. Then only Windows' events come: the supply, the level and energy saver, and for devices the connection and the level. Nothing is logged or stored.

## Weather

Asked in the command bar only: no weather at rest, no alert and nothing at launch. It is Sumi's only network request, and it waits for a yes.

- **Words**: `météo`, `meteo` or `weather` on a line of their own, with a city or not (`météo Lyon`, `météo à Lyon`, `weather in Paris`), ending with `demain` or `tomorrow` or not. A city is letters only, 4 words at most. `temps` is no weather word. The chip is worked out on the PC as you type: "Weather Paris", "Weather Paris tomorrow". These words come before an app's exact name, since Windows' own weather app is called "Weather"; Tab still offers it.
- **No city typed**: the city found this session. Before one, the chip reads "Weather · type a city" and Enter does nothing.
- **The yes**, on the first weather Enter of a session. Nothing is sent: the field becomes "Open-Meteo will get "Lyon" and your IP.", which can't be edited and takes the room the chip leaves, and the chip becomes "Allow ↵". A long city is cut with "…", never the end of the sentence; a screen reader hears it whole. Enter is yes. Esc is no: the bar closes, and nothing is sent or kept. No new shape and no buttons.
- **While Open-Meteo answers**, the bar folds into the launch shape, 200 × 34 px*, a cloud and "Weather Lyon".
- **Peek**: 300 × 56 px* for 4 s, which always shows: you just asked. A 28 px glyph 16 px from the left, drawn white on 24 units with a 1.6 stroke, then 12 px further two lines: "Lyon · 14° · Cloudy", or "Lyon tomorrow · Showers", in white, and under it, at 60 %, the low and the high, "9° / 17°". For today, when an hour still to come has a rain chance of 50 % or more, the second line is "Rain around 4 pm" instead. In the bottom right corner, 18 px in and on the second line's baseline, "Open-Meteo" in 11 px 500, white at 50 % (AA contrast): a click opens open-meteo.com. The rest of the peek takes no click and doesn't give under a press.
- **Six glyphs**: sun, moon (a clear sky at night, from `is_day`), cloud (fog too), rain, snow and storm. The chip and the launch shape show the cloud.
- **Errors**, for 2 s in the launch shape: "City not found", and "No connection", which 8 s without an answer counts as too.
- **Degrees**: Celsius, or Fahrenheit when the island's language has the US region (`en-US`).
- **Requests**: the city to `geocoding-api.open-meteo.com/v1/search` (one result, in the island's language), then its coordinates, never yours, to `api.open-meteo.com/v1/forecast`. Both with `cache: 'no-store'`, so WebView2 writes nothing to disk, `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. The CSP allows these two hosts and no other. There is no forecast cache.
- **Kept**: the yes and the city found, in memory for the session only. Quitting Sumi forgets both. Nothing is written to disk or a log.
- The peek moves as a song's: glyph, first line, second line, then the credit. **Reduced motion** and **contrast theme**: as the battery's peeks.
- Weather data by [Open-Meteo](https://open-meteo.com), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Input

Clicks outside the island reach the window underneath. The island never takes focus, except while the command bar is open, so a game or a call keeps it.

Without focus, the island never receives Esc or a click elsewhere. While it is expanded, it watches for them instead and closes, and they still reach the app they were meant for. Switching apps closes it too. A finished timer stays through both.

Known limits: with touch or a pen, the first tap on the island reaches the app underneath and the second one opens it. While an elevated app such as Task Manager has focus, Windows hides Esc and clicks from Sumi, so only switching apps closes the panel.

| Shortcut | Action |
|---|---|
| `Win+Alt+S` | Open or close the command bar |
| `Enter` | Run what the chip shows |
| `Tab` / `Shift+Tab` | Next / previous target |
| `Esc` | Close |

In the command bar, `25m`, `90s` or `1h30` is a timer, an app's name opens it, `what time is it` shows the time, `battery` gives the batteries on the chip and opens their panel, `weather in Paris` asks Open-Meteo after a yes, see [Weather](#weather), and anything else is a question. A word alone of three letters or more that starts the bar's own words of one kind gives that answer: `bat` and `autono` the batteries, `heu` and `tim` the time, `dat` the date, `mét` and `weat` the weather. An app it also starts comes next on Tab. The line is read without punctuation, politeness counts only around a verb, and verbs in any form (`ouvre`, `ouvrir`, `lance`, `open`) count as one. One word of four letters or more opens the one app whose name, or a word in it, starts that way: `disc` opens Discord, but never while the word could still become one of the bar's own words or a question. When in doubt, the line is a question: a tie between apps or a verb in the negative opens nothing. The chip says what Enter will do, and Tab turns it to the next target: the apps that tied, the default assistant, the other assistants, then the search engine. On an empty line, Enter does nothing.

The shortcut brings the bar to the front with the focus. Esc gives the focus back to the window you were in; a click elsewhere or switching apps closes the bar too. Before an app or a site opens, the bar lets go of the focus, so what opens comes to the front. While the island is hidden in fullscreen, the shortcut does nothing.

If another app already holds `Win+Alt+S`, Sumi takes `Alt+Shift+S`. If both are taken, the bar has no shortcut, and nothing pops up to say so. Settings, in 0.9, will let you change it. `Ctrl+Alt+S` is left alone, since some keyboards type a letter with AltGr+S, and so is `Ctrl+Shift+S`, Save As. So are `Alt+Space` (Windows and PowerToys Run) and `Ctrl+Alt+Space` (Claude's quick entry).

## Staying out of the way

- Only the drawn shape takes the mouse. The rest of the window, and the 8 px above the island, belong to the app underneath.
- A drag that starts elsewhere, such as a tab, a text selection or a window, passes over the island. It wakes up once every button is up.
- It grows only after the cursor rests on it for the Windows hover time, and shrinks 300 ms after the cursor leaves. A click opens it at once.
- It is put on top once and never pushed back up, so menus, tooltips, Start and Alt+Tab can cover it. Moving it never takes focus.
- It hides while a window fills the main screen, or while Windows reports a fullscreen game or a presentation: it slides up off the screen, then its window hides, so nothing sits over the game. A click on another screen keeps it hidden. It comes back without taking focus.
- While Windows says you're busy, such as a fullscreen app on another screen, news changes in place with no peek, and a new song doesn't swell. A call still peeks.
- It sits under the top of the work area, so a taskbar at the top pushes it down. It checks once a second.
- It tucks into a 4 px line under the top edge: when you swipe it away, by itself at rest when it shows only the time or a running timer, and while a window is moved, so Snap layouts has the top. See [Tuck](#tuck).
- A frozen Sumi never leaves a "Not responding" copy at the top of the screen.

## Motion

- **Shapes are springs, never fades.** Width and height spring on their own: opening leads with the width, closing with the height. Growing overshoots a little, shrinking never does. A moving shape stretches with its speed, by 4 % at most.
- **Content comes in from a blur** a beat after the shape starts, piece after piece, and leaves faster than it came, without one: a growing blur stalls the GPU. A piece that stays, such as the time, the artwork or the equalizer, moves to its new place instead of fading. Only the digits that change roll over.
- **Press** and the island gives a little; release and it opens with that speed. A new activity, a song change or a finished timer swell it for a moment.
- **The bubble** splits off like a drop, joined to the island until they part, and merges back the same way.
- **In fullscreen** the content leaves and the island slides up off the screen. It drops back down when the game or video ends.
- **Tucking**, the island closes into a drop that the top edge draws in from the side it was swiped, and comes back as a bead that falls from the line. An open panel's ink drains up into the edge instead. See [Tuck](#tuck).
- **Every start** the island drops in from above the screen the same way (from −66 px, a 0.5 s spring with 0.2 bounce), on the first frame after the fonts are ready, and its content comes in 60 % of the way down. It doesn't drop while something is fullscreen: it comes back with the return drop.
- **Reduced motion** turned on in Windows: shapes change at once and the content crossfades. No blur, stretch, roll, press or goo.
- **At rest nothing runs**: no animation frame, no filter, no message to Rust. The clock wakes once a minute, a timer once a second while the island shows it and otherwise only for its end and its chimes, and the equalizer moves only while music plays and the island is visible. Tucked, nothing runs but the clock and a timer's end; the wait before it tucks itself is one timeout.
- **The first hover is as smooth as the next ones**: a hidden copy of each text size is laid out at launch, so the fonts are ready before they are needed.
- **The website moves the same way.** Its islands use CSS curves worked out at build time from the app's own springs and timings (`src/lib/curves.ts`), so a change to one changes the other.

## Tuck

The island tucks into a line under the top edge, out of the way of tabs and title bars, and comes back when something needs it.

| | |
|---|---|
| Line | 132 × 4 px, centred, flush with the top edge, whatever it tucked from. Square on top, 2 px radius below. Its bottom row is white at 20 % over the black, which sets it apart from a dark title bar. No shadow. |
| Hit area | 132 × 12 px from the top edge, while tucked only. Everything else lets the cursor through. |
| Tuck | A swipe, in any direction. Rest the cursor on the island for the Windows hover time, then scroll or swipe the touchpad: `deltaX` or `deltaY` summed over 200 ms past ±40. One wheel notch does it; a scroll before the rest does nothing. Or press the island and drag it out of an 8 px square: it follows with resistance, up to 24 px, and tucks from that side on release; released back inside, it springs back to its place, and a press that stays inside is a click. The open panel tucks the same way, from anywhere on it but the progress bar, where a drag seeks; its buttons still take a click. A left click on the tray icon, or its menu's "Tuck the island", does it too. |
| Come back | Rest on the line for the hover time, click it, scroll down on it (+40 within 200 ms), or press on it and pull 12 px down. A left click on the tray icon or its menu's "Bring the island back", the command bar's shortcut (the bar opens from the line) and a kind that stays, below, as it arrives. It comes back to what it would show then, never to the hover view. |
| Window moves | While a window is moved or resized, once the cursor has gone past Windows' drag distance, the island tucks so Snap layouts has the top. It comes back when the move ends, unless it was tucked already. |

A cursor the scroll left on the line has to leave it once before a rest there brings the island back. While the microphone or camera dot shows, the island doesn't tuck.

### Tucks itself

What the island and its bubble show decides whether it stays or tucks itself after 10 s at rest: no cursor on it, nothing open, no welcome playing. A click elsewhere while it waits, or the one that closes its panel, makes that 1 s. After you bring it back by hand, the count starts again once the cursor leaves. A swipe still tucks any of them, except beside the microphone and camera dot.

| Shows | At rest |
|---|---|
| Microphone or camera dot | Stays, and brings it back |
| Call | Stays, and brings it back |
| Command bar or its answer, the weather's peek included | Stays, and brings it back |
| Welcome | Stays, and brings it back |
| A timer's end peek or done pill | Stays, and brings it back |
| Low battery, the PC's or a device's | Stays, and brings it back |
| Plugging in, or a device connecting | Comes out for its peek, then tucks again, unless you did something meanwhile. Not while a window is moved. |
| Music, playing or paused | Stays, and brings it back |
| Running timer | Tucks itself. Its end brings it back. |
| Time alone | Tucks itself |

With a bubble, both must tuck for the island to tuck. While Windows says you're busy, only a call and a timer's end bring it back. In fullscreen nothing does: what came meanwhile brings it back once the island shows.

### Motion

The island closes into a drop that the edge draws in, and the ink spreads along the edge. It comes back as the welcome's bead, mirrored: the line beads a drop, which falls and opens into the island. Times in ms:

| ms | Tuck |
|---|---|
| 0 | The content leaves. Goo from σ 0 to 7 in 80 ms. Ink 24 px wide comes down from above the edge to the line's bottom (0.36 s, no bounce). |
| 60 | The island closes into a 34 px drop (0.3 s, no bounce). A bubble merges back into it meanwhile. |
| 180 | The drop is drawn up, its top to 50 px above its place, 16 × 40 px (0.36 s). |
| 300 | The ink spreads along the edge to 132 px (0.4 s, no bounce). |
| about 350 | The drop is inside the line: it goes, and the goo fades out in 120 ms. |
| about 630 | The line is drawn, and its lighter row fades in over 120 ms. At rest by about 900. |

| ms | Return |
|---|---|
| 0 | Goo σ 5 at once. A bead of radius 8, its centre 8 px inside the line's bottom, falls: its top to 8 px under the edge (0.5 s, bounce 0.3), 34 px wide and tall (0.4 s, bounce 0.25). The line gathers to 40 px; its lighter row fades out in 60 ms. |
| 120 | The edge lets go: the ink goes back above the edge. |
| 260 | The drop opens into the island as the panel does, and the content comes in. At rest by about 880, 1030 for the music. |

**From each side.** A wheel swipe first pushes the island that way (240 px/s, with the press's release spring). Up is the tuck above. Left or right, it slides 40 px that way (0.36 s, no bounce), leaning with its speed, its top ahead, 10° at most: the neck forms off-centre and the drop is drawn up on a curve, then the ink spreads back to the centred line. Down, it first stretches 14 px longer and thinner like a rubber band (0.3 s), and every beat after comes 100 ms later, so it snaps up into the same neck.

**From an open panel.** Its ink drains up into the edge, as into a nib, without closing into a drop first. The content leaves and the ink comes down as above. At 60 ms the panel pulls in toward the top centre: its corners round first, into a bell that hangs from the neck (0.3 s, no bounce), and its sides pull in to 16 px (0.3 s, no bounce) faster than its bottom rises to 40 px tall (0.34 s, no bounce). At 140 the body drains up through the neck, its top to 50 px above its place (0.36 s), while the ink spreads along the edge to 132 px (0.4 s, no bounce). It is inside the line by about 350, the line is drawn by about 480, and it is at rest by about 750. Sideways and down it moves as the island does, but anything taller than the drop, a panel first, leans less, so its bottom trails no more than the drop's.

The ink runs 40 px above the screen's edge, so the goo keeps a full meniscus there. The shadow fades with how much of the island is still below the line. Called back mid-tuck, every spring heads back from where it is. With reduced motion, and in a contrast theme, the island and the line crossfade in 120 ms each way and nothing travels; in a contrast theme the line is outlined.

## Tray icon

Sumi's logo in the notification area, drawn at the taskbar's small icon size (16 px at 100 %, 20 at 125 %, 24 at 150 %, 32 at 200 %) so it stays sharp, and drawn again when the scale changes. It is the app icon's tile, with the mark 1.2 times larger so it still reads at 16 px. The bar's edges sit on whole pixels. The tile is opaque, so the icon is the same on a light or a dark taskbar.

| The island has | Corner | Tooltip |
|---|---|---|
| An app using the camera | Green dot `#4ADE80` | Sumi · camera: Zoom |
| An app using the microphone | Orange dot `#FB923C` | Sumi · microphone: Discord |
| Music playing | Three bars of the mark's colour, as the equalizer stands | Sumi · title – artist |
| Nothing of these | None | Sumi · the command bar's shortcut |

The first row that applies wins, as on the island: green over orange, any dot over the music. A paused song shows nothing here. The corner sits around the tile's corner arc, as the island's disc holds its dot: a ring of the tile, as wide as the icon over 16, all around it. With several apps on the device, the tooltip names the first and counts the others. It is cut to the 127 characters Windows keeps.

A left click tucks the island or brings it back; a right click opens the menu: "Tuck the island" or "Bring the island back", then "Quit Sumi", in the island's language. The icon and its tooltip change only when what they show changes.

## Welcome

Once, at the first launch after install or after an upgrade from 0.5, the island says hello and shows the command bar's shortcut. Nothing waits for a click and nothing takes focus. Times are in ms from the start of the drop:

| ms | Beat |
|---|---|
| 0 | The empty island drops in. |
| 140 | An ink bead, the logo's drop, splits off the pill's bottom from inside, as the bubble does (goo σ 7). It hangs with a 15.5 px radius, its centre 21 px under the pill, for about 0.6 s. |
| 700 | The bead is drawn back up while the island opens, as the panel does, to "Bonjour" or "Hello": Segoe UI Variable Display, 600, 24 px. |
| 1700 | The island widens to the shortcut: "Barre de commande" or "Command bar" (14 px, 500, 60 % white), then flat keycaps (13 px, 600, 26 px tall, radius 7, 12 % white with a 16 % white line). The keys are the ones Sumi registered; on a French keyboard Shift is "Maj". |
| 4900 | The island folds, as the panel closes, to the time, or to the music or the timer already there. At rest by about 5.6 s. |

Without a shortcut there is no shortcut beat, and it folds at 2300. It counts as seen once the shortcut has shown for a second, or after a click on the island, which folds at once. It plays only while the island is shown: in fullscreen or while Windows says you're busy, it waits, and it stops and plays again later if that happens midway. A cursor resting on it holds the shortcut until 300 ms after it leaves; the bar's shortcut ends it and opens the bar; a new activity ends it and takes the island, and so does a timer that ends. A screen reader hears it once, with the real shortcut. The shortcut also stays in the tray icon's tooltip, while nothing else is going on.

With reduced motion, the island fades in where it is, already the logo, and each later beat fades the content out in the old shape, changes the shape, and fades the new content in. In a contrast theme there is no bead.

## Look

- The island is pure black (`#000`), fully rounded. Panels use a 24 to 32 px radius.
- Type is Segoe UI Variable, with Inter as fallback. Times and timers use tabular figures.
- Music tints the equalizer and the progress bar with the artwork's main color. The island itself stays black, so text keeps AA contrast on any artwork.
- Fixed colors: microphone `#FB923C`, camera `#4ADE80`, timer `#FBBF24`, low battery `#F87171`.
- A light theme (white island, black text) is available in Settings.
- With a contrast theme turned on in Windows, the island is outlined in the theme's colors. The microphone and camera dots, the artwork and the equalizer keep their own.

## Why these choices

- **Click to expand, not hover.** At the top of a Windows screen the cursor crosses the island on its way to browser tabs and title bars. Hover only gives a hint.
- **Small at rest, hidden in fullscreen.** Island apps on Windows draw complaints for covering content and for idle CPU use. The target is close to 0 % CPU when nothing happens.
- **Compact, expanded and bubble** follow the model people already know from phones. The names, drawings and code are ours.
