# Design

How the island looks and behaves. If code and this page disagree, one of them has a bug.

This is the design for 1.0. What each release already does is in the [changelog](https://github.com/Rateur/sumi/blob/main/CHANGELOG.md).

## States

| State | Size | When |
|---|---|---|
| Idle | 132 × 34 px | Nothing happening. Shows the time, or the weather if chosen. |
| Hover | 152 × 36 px | Cursor on the island, after a short rest. Adds the date. |
| Compact | Call 144, timer 96, music 200 × 34 px* | An activity runs: content on the left and right ends. |
| Peek | Music 300 × 56 px*, up to 3 s | Something just happened: charger, low battery. A new song swells instead, see [Music](#music). |
| Expanded | Clock 280 × 120 px*, music 360 × 164 px*, panels up to 560 px wide | Click. Closes on Esc or a click elsewhere. Music shows the artwork, title and artist, the progress, and previous, play or pause and next. |
| Bubble | 34 px circle | A second activity, or the time, 8 px right of the island. A click brings it to the island. |
| Privacy tag | 20 px circle, card 248 px wide | An app uses the microphone or the camera, or the microphone is muted. 6 px right of everything else; opens into a card under the cursor. |
| Hidden | — | A game, video or slideshow fills the main screen. Comes back compact. |

The island sits 8 px below the top edge, centered on the chosen screen. Sizes are at 100 % scale and follow the display scale.

\* Provisional, not yet checked against the Figma frames.

## Who gets the island

When several things happen at once, the highest one takes the island, the next one the bubble, and the rest wait. Between equals, what is already shown keeps its place. A click on the bubble swaps it with the island, except over a call.

The time is last in line: it has the island when nothing runs, and the bubble when one thing does. Picked from the bubble, it keeps the island until the music ends. Otherwise it waits while two or more things run, and comes back when only one is left; a call on the island shows the time anyway.

1. Call
2. Timer
3. Music
4. Time or weather

## Music

- Any player that Windows' media controls can see: Spotify, browsers, VLC and the rest. Two players at once take the island and the bubble.
- A player shows once it plays. Paused, it stays a minute, then the time comes back; playing again brings it back. A player that disappears for a moment between two songs is held for 2.5 s, so the island doesn't blink.
- A new song swells the island, unless Windows says you're busy. The title and artist are in the panel.
- The progress bar and the times are worked out from the last position Windows gave, so nothing is sent while a song plays. A live stream without a length has no bar.
- The bar can be dragged, in players that allow it. It thickens under the cursor, as on the iPhone, and stays where it is dropped until the player answers, 3 s at most. A drag that starts on the island keeps the cursor until the button is up, even past the island's edge.
- A drag on the bar ends without a seek if the panel closes or another song takes it.
- A new song swells the island when it is on the island, and the bubble when it is in the bubble.
- The artwork reaches the island as data, never as a file. Its main color is read from a 16 px copy, and lightened until it shows on black.

## Microphone and camera

- Apple's rule: one dot, green while an app uses a camera, with or without the microphone, orange for the microphone alone. It sits in its own 20 px black disc, 6 px right of the island or the bubble, level with the island's top row. The disc splits off the shape beside it like a drop, as the bubble does from the island, and sinks back into it. The island itself never changes for it, so the music and the time keep their places.
- The microphone comes from Windows' audio sessions, counting only those that capture right now, since Teams and others keep theirs open after a call. The camera comes from Media Foundation's sensor activity. Both call back when something changes. The registry list behind Windows' privacy page isn't read: recent Windows 11 builds stopped updating it, and a crash leaves stale entries in it for months.
- A WebView2 process counts as the app that hosts it. Names come from the exe's description, "Discord" or "Google Chrome", and otherwise from its file name.
- Rest the cursor on the disc, as on the island, and it opens into a card, width first, as the island opens: a row per app with its icon, what it uses and for how long, four at most with the last counting the rest, then the buttons. A click opens it too. It stays where it opened while open, closes 300 ms after the cursor leaves, or on Esc or a click elsewhere, and closes before the disc sinks back into the island.
- The buttons follow what is in use: mute while an app uses the microphone or it is muted; a camera button while an app films, which brings that app forward, since Windows can't turn the camera off for every app without admin rights; and Windows' privacy settings. A click on an app brings it forward too: its window, or the Store app's frame around it, restored if it was minimized and shown again if it was in the tray. When no window comes forward, Windows' privacy page opens instead.
- Icons come from the exe, as raw pixels the page paints: no image encoder in the app.
- Mute is Windows' own mute of the default microphones, for every app. It counts as on only when every default microphone is muted. While it's on, a crossed microphone stays in the disc, even when no app listens.
- Media Foundation is loaded at run time: Windows N editions ship without it, and Sumi must still start there, with the microphone alone.

## Input

Clicks outside the island reach the window underneath. The island never takes focus, except while the command bar is open, so a game or a call keeps it.

Without focus, the island never receives Esc or a click elsewhere. While it is expanded, it watches for them instead and closes, and they still reach the app they were meant for. Switching apps closes it too.

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
- A frozen Sumi never leaves a "Not responding" copy at the top of the screen.

## Motion

- **Shapes are springs, never fades.** Width and height spring on their own: opening leads with the width, closing with the height. Growing overshoots a little, shrinking never does. A moving shape stretches with its speed, by 4 % at most.
- **Content comes in from a blur** a beat after the shape starts, piece after piece, and leaves faster than it came, without one: a growing blur stalls the GPU. A piece that stays, such as the time, the artwork or the equalizer, moves to its new place instead of fading. Only the digits that change roll over.
- **Press** and the island gives a little; release and it opens with that speed. A new activity, a song change or a finished timer swell it for a moment.
- **The bubble** splits off like a drop, joined to the island until they part, and merges back the same way.
- **In fullscreen** the content leaves and the island slides up off the screen. It drops back down when the game or video ends.
- **Reduced motion** turned on in Windows: shapes change at once and the content crossfades. No blur, stretch, roll, press or goo.
- **At rest nothing runs**: no animation frame, no filter, no message to Rust. The clock wakes once a minute, a timer once a second, and the equalizer moves only while music plays and the island is visible.
- **The first hover is as smooth as the next ones**: a hidden copy of each text size is laid out at launch, so the fonts are ready before they are needed.
- **The website moves the same way.** Its islands use CSS curves worked out at build time from the app's own springs and timings (`src/lib/curves.ts`), so a change to one changes the other.

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
