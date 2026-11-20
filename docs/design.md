# Design

How the island looks and behaves. If code and this page disagree, one of them has a bug.

This is the design for 1.0. What each release already does is in the [changelog](https://github.com/Rateur/sumi/blob/main/CHANGELOG.md).

## States

| State | Size | When |
|---|---|---|
| Idle | 132 × 34 px | Nothing happening. Shows the time, or the weather if chosen. |
| Hover | 152 × 36 px | Cursor on the island, after a short rest. Adds the date, or a timer's name. |
| Compact | Call 144, timer 112 (128 from an hour), music 200 × 34 px* | An activity runs: content on the left and right ends. |
| Peek | Music 300 × 56 px*, up to 3 s; a finished timer 300 × 56 px*, 6 s | Something just happened: timer ended, charger, low battery. A new song swells instead, see [Music](#music). |
| Done | Timer 150 × 34 px* at least | A timer ended and waits for OK. |
| Expanded | Clock and timer 280 × 120 px*, music 360 × 164 px*, panels up to 560 px wide | Click. Closes on Esc or a click elsewhere. Music shows the artwork, title and artist, the progress, and previous, play or pause and next. |
| Bubble | 34 px circle | A second activity, or the time, 8 px right of the island. A click brings it to the island. |
| Privacy tag | 20 px circle, card 248 px wide | An app uses the microphone or the camera, or the microphone is muted. 6 px right of everything else; opens into a card under the cursor. |
| Hidden | — | A game, video or slideshow fills the main screen. Comes back compact. |
| Tucked | Line 132 × 4 px, caught over 132 × 12 px | Scrolled up after a rest, from the tray, while a window is moved, or by itself at rest. See [Tuck](#tuck). |
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

In the command bar, `25m`, `90s` or `1h30` is a timer, an app's name opens it, `what time is it` shows the time, and anything else is a question. The line is read without punctuation, politeness counts only around a verb, and verbs in any form (`ouvre`, `ouvrir`, `lance`, `open`) count as one. One word of four letters or more opens the one app whose name, or a word in it, starts that way: `disc` opens Discord, but never while the word could still become one of the bar's own words or a question. When in doubt, the line is a question: a tie between apps or a verb in the negative opens nothing. The chip says what Enter will do, and Tab turns it to the next target: the apps that tied, the default assistant, the other assistants, then the search engine. On an empty line, Enter does nothing.

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
- It tucks into a 4 px line under the top edge: when you scroll up on it, by itself at rest when it shows only the time or a running timer, and while a window is moved, so Snap layouts has the top. See [Tuck](#tuck).
- A frozen Sumi never leaves a "Not responding" copy at the top of the screen.

## Motion

- **Shapes are springs, never fades.** Width and height spring on their own: opening leads with the width, closing with the height. Growing overshoots a little, shrinking never does. A moving shape stretches with its speed, by 4 % at most.
- **Content comes in from a blur** a beat after the shape starts, piece after piece, and leaves faster than it came, without one: a growing blur stalls the GPU. A piece that stays, such as the time, the artwork or the equalizer, moves to its new place instead of fading. Only the digits that change roll over.
- **Press** and the island gives a little; release and it opens with that speed. A new activity, a song change or a finished timer swell it for a moment.
- **The bubble** splits off like a drop, joined to the island until they part, and merges back the same way.
- **In fullscreen** the content leaves and the island slides up off the screen. It drops back down when the game or video ends.
- **Tucking**, the island closes into a drop that the top edge draws in, and comes back as a bead that falls from the line. See [Tuck](#tuck).
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
| Tuck | Rest the cursor on the island for the Windows hover time, then scroll up: `deltaY` summed over 200 ms at −40 or less. One wheel notch does it; a scroll before the rest does nothing. The tray menu's "Tuck the island" does it too. |
| Come back | Rest on the line for the hover time, scroll down on it (+40 within 200 ms), or press on it and pull 12 px down. The tray menu's "Bring the island back", the command bar's shortcut (the bar opens from the line) and a kind that stays, below, as it arrives. It comes back to what it would show then, never to the hover view. |
| Window moves | While a window is moved or resized, once the cursor has gone past Windows' drag distance, the island tucks so Snap layouts has the top. It comes back when the move ends, unless it was tucked already. |

A cursor the scroll left on the line has to leave it once before a rest there brings the island back. While the microphone or camera dot shows, the island doesn't tuck.

### Tucks itself

What the island and its bubble show decides whether it stays or tucks itself after 10 s at rest: no cursor on it, nothing open, no welcome playing. After you bring it back by hand, the count starts again once the cursor leaves. A scroll up still tucks any of them, except beside the microphone and camera dot.

| Shows | At rest |
|---|---|
| Microphone or camera dot | Stays, and brings it back |
| Call | Stays, and brings it back |
| Command bar or its answer | Stays, and brings it back |
| Welcome | Stays, and brings it back |
| A timer's end peek or done pill | Stays, and brings it back |
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

The ink runs 40 px above the screen's edge, so the goo keeps a full meniscus there. The shadow fades with how much of the island is still below the line. Called back mid-tuck, every spring heads back from where it is. With reduced motion, and in a contrast theme, the island and the line crossfade in 120 ms each way and nothing travels; in a contrast theme the line is outlined.

## Welcome

Once, at the first launch after install or after an upgrade from 0.5, the island says hello and shows the command bar's shortcut. Nothing waits for a click and nothing takes focus. Times are in ms from the start of the drop:

| ms | Beat |
|---|---|
| 0 | The empty island drops in. |
| 140 | An ink bead, the logo's drop, splits off the pill's bottom from inside, as the bubble does (goo σ 7). It hangs with a 15.5 px radius, its centre 21 px under the pill, for about 0.6 s. |
| 700 | The bead is drawn back up while the island opens, as the panel does, to "Bonjour" or "Hello": Segoe UI Variable Display, 600, 24 px. |
| 1700 | The island widens to the shortcut: "Barre de commande" or "Command bar" (14 px, 500, 60 % white), then flat keycaps (13 px, 600, 26 px tall, radius 7, 12 % white with a 16 % white line). The keys are the ones Sumi registered; on a French keyboard Shift is "Maj". |
| 4900 | The island folds, as the panel closes, to the time, or to the music or the timer already there. At rest by about 5.6 s. |

Without a shortcut there is no shortcut beat, and it folds at 2300. It counts as seen once the shortcut has shown for a second, or after a click on the island, which folds at once. It plays only while the island is shown: in fullscreen or while Windows says you're busy, it waits, and it stops and plays again later if that happens midway. A cursor resting on it holds the shortcut until 300 ms after it leaves; the bar's shortcut ends it and opens the bar; a new activity ends it and takes the island, and so does a timer that ends. A screen reader hears it once, with the real shortcut. The shortcut also stays in the tray icon's tooltip.

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
