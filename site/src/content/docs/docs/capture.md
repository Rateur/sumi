---
title: Capture
description: Press Win+Alt+C to copy a colour, text or a QR code from the screen.
---

Press `Win+Alt+C` and the screen freezes as it is. Nothing dims, and clicks no longer reach your apps. A round loupe follows the cursor, and the island shows the colour under it. If another app already uses the shortcut, it is `Alt+Shift+C`. You can also type `capture` or `pipette` in the command bar.

## A colour

- **Click** to copy the colour under the loupe, as HEX: `#1E90FF`. The island says "Colour copied", and a drop holding your colour falls from it for 3 seconds.
- **Shift+click** copies the colour of the text nearby instead of its background, on a light app and a dark one alike. While you hold Shift, the island says "text colour".
- **The arrow keys** move the loupe one pixel at a time.

## Text or a QR code

- **Drag a box** around text and let go. Sumi reads it with Windows' own text recognition and copies it. The island says "Text copied · 42 words".
- **A box around a whole QR code** copies what it holds instead. For a link, the island names its site: "Link copied · example.com".
- If the box holds no text, the island says "No text found" and nothing is copied.

Windows reads text in the languages installed with their text recognition, your own first. If none is, the island says "No OCR language installed". Add a language in Settings > Time & language > Language & region.

## Cancel

Press Esc, or `Win+Alt+C` again. The screen comes back and nothing is copied.

## What Sumi keeps

- **The frozen screen** stays in memory, never on the disk, and is freed as soon as the capture ends. Sumi saves no screenshot.
- **The text** is read on this PC by Windows. Nothing is sent anywhere.
- **What you copy** goes on the clipboard, and into your [clipboard history](../clipboard/) when it is on.
- **Hidden from screenshots**: the loupe and the frozen screen never show in a screenshot or on a shared screen, and the island doesn't either while the capture runs.

## Limits

- Text recognition may misread code and long numbers. Check what you paste.
- On an HDR screen, a colour may differ from what you see. A protected video may freeze black.
- While the island is hidden in fullscreen, the shortcut does nothing.
