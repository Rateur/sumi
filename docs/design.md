# Design

How the island looks and behaves. If code and this page disagree, one of them has a bug.

## States

| State | Size | When |
|---|---|---|
| Idle | 132 × 34 px | Nothing happening. Shows the time, or the weather if chosen. |
| Hover | 152 × 36 px | Cursor on the island, after a short rest. Adds the date. |
| Compact | Call 144, timer 96, music 200 × 34 px* | An activity runs: content on the left and right ends. |
| Peek | Music 300 × 56 px*, up to 3 s | Something just happened: new track, charger, low battery. |
| Expanded | Clock 280 × 120 px*, panels up to 560 px wide | Click. Closes on Esc or a click elsewhere. |
| Bubble | 34 px circle | A second activity, 8 px right of the island. |
| Hidden | — | A game, video or slideshow is fullscreen. |

The island sits 8 px below the top edge, centered on the chosen screen. Sizes are at 100 % scale and follow the display scale.

\* Provisional, not yet checked against the Figma frames.

## Who gets the island

When several things happen at once, the highest one takes the island, the next one the bubble, and the rest wait. Between equals, what is already shown keeps its place.

1. Call, microphone or camera
2. Timer
3. Music
4. Time or weather

## Input

Clicks outside the island reach the window underneath. The island never takes focus, except while the command bar is open, so a game or a call keeps it.

Without focus, the island never receives Esc or a click elsewhere. While it is expanded, it watches for them instead and closes, and they still reach the app they were meant for. Switching apps closes it too.

Known limits: with touch or a pen, the first tap on the island reaches the app underneath and the second one opens it. While an elevated app such as Task Manager has focus, Windows hides Esc and clicks from Sumi, so only switching apps closes the panel.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Space` | Open the command bar |
| `Enter` | Send to the selected assistant |
| `Tab` / `Shift+Tab` | Next / previous assistant |
| `Esc` | Close |

In the command bar, `25m`, `90s` or `1h30` starts a timer instead. Every shortcut can be changed in Settings. `Alt+Space` is left alone: Windows and PowerToys Run use it.

## Staying out of the way

- Only the drawn shape takes the mouse. The rest of the window, and the 8 px above the island, belong to the app underneath.
- A drag that starts elsewhere, such as a tab, a text selection or a window, passes over the island. It wakes up once every button is up.
- It grows only after the cursor rests on it for the Windows hover time, and shrinks 300 ms after the cursor leaves. A click opens it at once.
- It is put on top once and never pushed back up, so menus, tooltips, Start and Alt+Tab can cover it. Moving it never takes focus.
- It sits under the top of the work area, so a taskbar at the top pushes it down. It checks once a second.
- A frozen Sumi never leaves a "Not responding" copy at the top of the screen.

## Motion

Size changes are springs, never fades. Growing overshoots a little, shrinking doesn't. Content appears a few milliseconds after the shape starts moving, and leaves before it shrinks. With reduced motion turned on in Windows, sizes change at once and the content crossfades.

Nothing animates at rest. The equalizer moves only while music plays and the island is visible.

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
