/**
 * The screen capture's words and results, without the DOM. Rust freezes the screen, draws the loupe and reads the box
 * (src-tauri/src/capture.rs). The island shows the HEX under the loupe as it moves, then what was copied for 3 s.
 */

import type { Lang } from './intent'

/** How a capture ended, as Rust says (`Captured` in capture.rs). */
export type Captured =
  | { kind: 'colour'; hex: string }
  | { kind: 'text'; words: number }
  | { kind: 'link'; host: string }
  | { kind: 'code' }
  | { kind: 'empty' }
  | { kind: 'unreadable' }
  | { kind: 'cancelled' }
  | { kind: 'failed' }

/** A key the island hands to Rust during a capture (`Key` in capture.rs). */
export type CaptureKey = 'escape' | 'left' | 'right' | 'up' | 'down' | 'shift'

/** The island's keys that steer a capture, by `KeyboardEvent.key`. */
export const CAPTURE_KEYS: Record<string, CaptureKey> = {
  Escape: 'escape',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Shift: 'shift',
}

/** On 16 units, 1.5 stroke: the loupe, on the bar's chip, and the box, while one is drawn. */
export const CAPTURE_GLYPHS = {
  loupe: 'M11.2 7a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 0 1 8.4 0zM10.2 10.2l3.2 3.2',
  box: 'M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11M5.5 6.5h5M5.5 9.5h3.5',
} as const

export const CAPTURE_WORDS = {
  fr: {
    drag: 'glissez pour du texte',
    shift: 'couleur du texte',
    release: 'Relâchez pour lire la zone',
    colour: 'Couleur copiée',
    text: 'Texte copié',
    words: (n: number) => `${n} mot${n > 1 ? 's' : ''}`,
    link: 'Lien copié',
    code: 'Code QR copié',
    empty: 'Aucun texte trouvé',
    unreadable: 'Aucune langue OCR installée',
    failed: 'Impossible de copier',
    start: 'Capture. Visez une couleur et cliquez, ou glissez un cadre autour d’un texte ou d’un code QR. Échap pour annuler.',
    said: {
      colour: (hex: string) => `Couleur ${hex} copiée.`,
      text: (n: number) => `Texte copié, ${n} mot${n > 1 ? 's' : ''}.`,
      link: (host: string) => `Lien ${host} copié.`,
    },
  },
  en: {
    drag: 'drag for text',
    shift: 'text colour',
    release: 'Release to read the area',
    colour: 'Colour copied',
    text: 'Text copied',
    words: (n: number) => `${n} word${n === 1 ? '' : 's'}`,
    link: 'Link copied',
    code: 'QR code copied',
    empty: 'No text found',
    unreadable: 'No OCR language installed',
    failed: "Couldn't copy",
    start: 'Capture. Point at a colour and click, or drag a box around text or a QR code. Esc to cancel.',
    said: {
      colour: (hex: string) => `Colour ${hex} copied.`,
      text: (n: number) => `Text copied, ${n} word${n === 1 ? '' : 's'}.`,
      link: (host: string) => `Link ${host} copied.`,
    },
  },
} as const

/**
 * What the island shows after a capture, for 3 s: its parts, with « · » between them, and what a screen reader hears.
 * `bead` is the colour the ink bead drops with, `null` for a black one, or `false` for none, as nothing was copied.
 * Nothing for Esc: the island goes back to what it showed.
 */
export function result(
  captured: Captured,
  lang: Lang,
): { parts: string[]; spoken: string; bead: string | null | false } | undefined {
  const words = CAPTURE_WORDS[lang]
  const nothing = (text: string) => ({ parts: [text], spoken: `${text}.`, bead: false as const })
  switch (captured.kind) {
    case 'colour':
      return { parts: [captured.hex, words.colour], spoken: words.said.colour(captured.hex), bead: captured.hex }
    case 'text':
      return { parts: [words.text, words.words(captured.words)], spoken: words.said.text(captured.words), bead: null }
    case 'link':
      return { parts: [words.link, captured.host], spoken: words.said.link(captured.host), bead: null }
    case 'code':
      return { parts: [words.code], spoken: `${words.code}.`, bead: null }
    case 'empty':
      return nothing(words.empty)
    case 'unreadable':
      return nothing(words.unreadable)
    case 'failed':
      return nothing(words.failed)
    case 'cancelled':
      return undefined
  }
}
