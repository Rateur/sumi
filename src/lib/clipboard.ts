/**
 * The clipboard history's words and the list's logic, without the DOM: a row's line, what the filter keeps, how many
 * rows show and what the count says. Rust keeps the history (src-tauri/src/clipboard.rs). The island shows it only
 * while the bar's list is open, never as you copy.
 */

import { fold, type Lang } from './intent'
import { LIST } from './shapes'

/** Where Enter on an item left it, as Rust says (`Landed` in clipboard.rs). */
export type Landed = 'pasted' | 'copied' | 'failed'

/** On 16 units, 1.5 stroke: the clipboard, on the bar's chip, and a text item's lines, on its row and in the peek. */
export const GLYPHS = {
  clip: 'M6 3.2h4v1.9H6zM6 4H4.4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H10',
  text: 'M3 4.5h10M3 8h10M3 11.5h6',
} as const

/**
 * What the island says around the history. The consent fits whole beside its chip, about 335 px in French. It comes
 * in three parts, as the weather's does, so a wider font cuts the middle first and the promise at the end always
 * shows. A screen reader hears it whole.
 */
export const CLIPBOARD_WORDS = {
  fr: {
    consent: ['', 'Historique du presse-papiers', ', chiffré sur ce PC.'],
    keys: 'Entrée pour accepter, Échap pour refuser.',
    allow: 'Autoriser',
    again: 'Activer',
    search: 'Rechercher dans le presse-papiers',
    fresh: 'Ce que vous copiez s’affichera ici.',
    none: (q: string) => `Rien ne contient « ${q} »`,
    count: (n: number) => `${n} élément${n > 1 ? 's' : ''}`,
    of: (n: number, all: number) => `${n} sur ${all}`,
    help: 'Flèches pour choisir, Entrée pour coller.',
    paste: 'Coller',
    plain: 'Texte brut',
    pasted: 'Collé',
    pastedPlain: 'Collé en texte brut',
    copied: 'Copié · Ctrl+V',
    failed: 'Impossible de coller',
  },
  en: {
    consent: ['', 'Clipboard history', ', encrypted on this PC.'],
    keys: 'Enter to allow, Esc to refuse.',
    allow: 'Allow',
    again: 'Turn on',
    search: 'Search clipboard history',
    fresh: 'What you copy will show here.',
    none: (q: string) => `Nothing contains "${q}"`,
    count: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    of: (n: number, all: number) => `${n} of ${all}`,
    help: 'Arrows to choose, Enter to paste.',
    paste: 'Paste',
    plain: 'Plain text',
    pasted: 'Pasted',
    pastedPlain: 'Pasted as plain text',
    copied: 'Copied · Ctrl+V',
    failed: "Couldn't paste",
  },
} as const

/**
 * A row's one line: the text from its first letter, its line breaks and runs of spaces as one space. Cut long before
 * the row ends, on whole characters, since an item may be 64 KB.
 */
export function preview(text: string): string {
  return text
    .trimStart()
    .slice(0, 400)
    .replace(/\s+/g, ' ')
    .trimEnd()
    .replace(/[\uD800-\uDBFF]$/, '')
}

/** The items that hold `query`, accents and case aside, newest first. `keys` are the items folded, read once. */
export function matching(items: readonly string[], keys: readonly string[], query: string): string[] {
  const q = fold(query.trim())
  return q ? items.filter((_, i) => keys[i].includes(q)) : [...items]
}

/** The quiet line under the rows: what to type was found in nothing, or the history has just begun. */
export function quiet(matches: number, total: number, query: string, lang: Lang): string | undefined {
  const words = CLIPBOARD_WORDS[lang]
  if (query.trim()) return matches ? undefined : words.none(query.trim())
  return total < 2 ? words.fresh : undefined
}

/** How many rows the list shows: the matches and the quiet line, at least one and at most five. */
export function rows(matches: number, total: number, query: string, lang: Lang): number {
  const line = quiet(matches, total, query, lang) ? 1 : 0
  return Math.max(1, Math.min(LIST.rows, matches + line))
}

/** The count in the chip's place: « 12 éléments », or « 2 sur 12 » while filtering. */
export function count(matches: number, total: number, query: string, lang: Lang): string {
  const words = CLIPBOARD_WORDS[lang]
  return query.trim() ? words.of(matches, total) : words.count(total)
}

/** What a screen reader hears as the list opens: the count, then the keys. */
export function arrived(total: number, lang: Lang): string {
  return `${count(total, total, '', lang)}. ${CLIPBOARD_WORDS[lang].help}`
}
