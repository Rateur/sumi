# Design

How the island looks and behaves. If code and this page disagree, one of them has a bug.

## States

| State | Size | When |
|---|---|---|
| Idle | 132 × 34 px | Nothing happening. Shows the time, or the weather if chosen. |
| Hover | ~140 × 36 px | Cursor over the island. Adds the date. |
| Compact | 34 px high, wider | An activity runs: content on the left and right ends. |
| Peek | Larger, up to 3 s | Something just happened: new track, charger, low battery. |
| Expanded | Panel, up to 560 px wide | Click. Closes on Esc or a click elsewhere. |
| Bubble | 34 px circle | A second activity, next to the island. |
| Hidden | — | A game, video or slideshow is fullscreen. |

The island sits 8 px below the top edge, centered on the chosen screen. Sizes are at 100 % scale and follow the display scale.

## Who gets the island

When several things happen at once, the highest one takes the island, the next one the bubble, and the rest wait:

1. Call, microphone or camera
2. Timer
3. Music
4. Time or weather

## Input

Clicks outside the island reach the window underneath. The island never takes focus, except while the command bar is open, so a game or a call keeps it.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Space` | Open the command bar |
| `Enter` | Send to the selected assistant |
| `Tab` / `Shift+Tab` | Next / previous assistant |
| `Esc` | Close |

In the command bar, `25m`, `90s` or `1h30` starts a timer instead. Every shortcut can be changed in Settings. `Alt+Space` is left alone: Windows and PowerToys Run use it.

## Motion

Size changes are springs, never fades. Content appears a few milliseconds after the shape starts moving. With reduced motion turned on in Windows, the island crossfades instead.

Nothing animates at rest. The equalizer moves only while music plays and the island is visible.

## Look

- The island is pure black (`#000`), fully rounded. Panels use a 24 to 32 px radius.
- Type is Segoe UI Variable, with Inter as fallback. Times and timers use tabular figures.
- Music tints the equalizer and the progress bar with the artwork's main color. The island itself stays black, so text keeps AA contrast on any artwork.
- Fixed colors: microphone `#FB923C`, camera `#4ADE80`, timer `#FBBF24`, low battery `#F87171`.
- A light theme (white island, black text) is available in Settings.

## Why these choices

- **Click to expand, not hover.** At the top of a Windows screen the cursor crosses the island on its way to browser tabs and title bars. Hover only gives a hint.
- **Small at rest, hidden in fullscreen.** Island apps on Windows draw complaints for covering content and for idle CPU use. The target is close to 0 % CPU when nothing happens.
- **Compact, expanded and bubble** follow the model people already know from phones. The names, drawings and code are ours.
