/**
 * The clipboard history's words and the list's logic, without the DOM: a row's line, what the filter keeps, how many
 * rows show and what the count says, and each item's type with what Tab offers on it. Rust keeps the history
 * (src-tauri/src/clipboard.rs), says which items name a file or a folder, and checks every action before it runs. The
 * island shows the history only while the bar's list is open, never as you copy.
 */

import { fold, type Lang } from './intent'
import { LIST } from './shapes'

/** Where Enter on an item left it, as Rust says (`Landed` in clipboard.rs). */
export type Landed = 'pasted' | 'copied' | 'failed'

/**
 * What an item is, for its glyph, its line, the words that find it and what Tab offers. `path` comes from Rust, which
 * can see whether the file or the folder is there.
 */
export type Kind = 'text' | 'link' | 'colour' | 'path' | 'mail' | 'code'

/** A colour's three ways of being written, the order Tab turns through them in. */
export const FORMATS = ['hex', 'rgb', 'hsl'] as const
export type Format = (typeof FORMATS)[number]

/** What Enter does on an item. Each type's cycle starts with Enter's own: paste it, or a colour as it was copied. */
export type Action = 'paste' | 'plain' | 'open' | 'clean' | 'folder' | 'write' | Format

type Rgb = [number, number, number]

/**
 * On 16 units, 1.5 stroke: the clipboard, on the bar's chip, and each type's mark, on its row and in the peek. A colour
 * has its swatch instead.
 */
export const GLYPHS = {
  clip: 'M6 3.2h4v1.9H6zM6 4H4.4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H10',
  text: 'M3 4.5h10M3 8h10M3 11.5h6',
  link: 'M6.6 9.4l2.8-2.8M7.2 4.8l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M8.8 11.2l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1',
  path: 'M2.2 5a1 1 0 0 1 1-1h3.1l1.5 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z',
  mail: 'M4 3.6h8a1.8 1.8 0 0 1 1.8 1.8v5.2a1.8 1.8 0 0 1-1.8 1.8H4a1.8 1.8 0 0 1-1.8-1.8V5.4A1.8 1.8 0 0 1 4 3.6zM2.8 5l5.2 3.8L13.2 5',
  code: 'M5.6 4.6L2.4 8l3.2 3.4M10.4 4.6L13.6 8l-3.2 3.4',
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
    help: 'Flèches pour choisir, Entrée pour coller, Tab pour les autres actions.',
    actions: {
      paste: 'Coller',
      plain: 'Texte brut',
      open: 'Ouvrir',
      clean: 'Sans traqueurs',
      folder: 'Dossier',
      write: 'Écrire',
      hex: 'HEX',
      rgb: 'RGB',
      hsl: 'HSL',
    },
    pasted: 'Collé',
    pastedPlain: 'Collé en texte brut',
    pastedClean: 'Collé sans traqueurs',
    wrote: 'Nouveau message',
    copied: 'Copié · Ctrl+V',
    failed: 'Impossible de coller',
    unopened: 'Impossible d’ouvrir',
    lines: (n: number) => `${n} lignes`,
    // The first word is what a screen reader hears before the item; all of them find it in the filter.
    kinds: {
      text: '',
      link: 'lien url',
      colour: 'couleur',
      path: 'chemin dossier fichier',
      mail: 'e-mail email',
      code: 'code',
    },
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
    help: 'Arrows to choose, Enter to paste, Tab for other actions.',
    actions: {
      paste: 'Paste',
      plain: 'Plain text',
      open: 'Open',
      clean: 'No trackers',
      folder: 'Folder',
      write: 'Compose',
      hex: 'HEX',
      rgb: 'RGB',
      hsl: 'HSL',
    },
    pasted: 'Pasted',
    pastedPlain: 'Pasted as plain text',
    pastedClean: 'Pasted without trackers',
    wrote: 'New message',
    copied: 'Copied · Ctrl+V',
    failed: "Couldn't paste",
    unopened: "Couldn't open",
    lines: (n: number) => `${n} lines`,
    kinds: {
      text: '',
      link: 'link url',
      colour: 'colour color',
      path: 'path folder file',
      mail: 'email e-mail',
      code: 'code',
    },
  },
} as const

// --- Types ---

/**
 * An item's type. Only the text decides, trimmed: a link is http or https alone, so no other scheme ever opens, and a
 * path is one Rust found on this PC.
 */
export function kindOf(text: string, paths: ReadonlySet<string>): Kind {
  if (paths.has(text)) return 'path'
  const t = text.trim()
  if (isLink(t)) return 'link'
  if (colourOf(t)) return 'colour'
  if (isMail(t)) return 'mail'
  return isCode(t) ? 'code' : 'text'
}

/** http or https, a host, and no space or control character: Rust opens only that (`link` in clipboard.rs). */
function isLink(t: string): boolean {
  return /^https?:\/\/[^/?#]/i.test(t) && !/[\s\p{Cc}]/u.test(t)
}

/**
 * An address in plain ASCII, with no `?`, `&` or `%` that could add to the message Windows opens: Rust writes to the
 * same ones only (`address` in clipboard.rs).
 */
function isMail(t: string): boolean {
  const at = t.lastIndexOf('@')
  const [local, domain] = [t.slice(0, at), t.slice(at + 1)]
  const labels = domain.split('.')
  return (
    at > 0 &&
    t.length <= 254 &&
    local.length <= 64 &&
    /^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*$/.test(local) &&
    labels.length > 1 &&
    labels.every((label) => /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) &&
    /^[A-Za-z]{2,}$/.test(labels[labels.length - 1])
  )
}

/**
 * Code: more than one line, and shaped like it. A line that opens or closes a block, two statements, or indented lines
 * with code's signs. An address over two lines or an indented list stays text.
 */
function isCode(t: string): boolean {
  const lines = t.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return false
  const block = lines.some((line) => /[{[(]\s*$|^\s*[}\])]/.test(line))
  const statements = lines.filter((line) => /;\s*$/.test(line)).length > 1
  const indented = lines.some((line) => /^(\t| {2,})\S/.test(line)) && /[(){}[\]=<>;]/.test(t)
  return block || statements || indented
}

/**
 * What Tab turns through on an item, Enter's own first. A link offers its trackers' removal only when it has some; a
 * colour starts from the way it was copied.
 */
export function actionsOf(text: string, kind: Kind): Action[] {
  if (kind === 'link') return tracked(text.trim()) ? ['paste', 'open', 'clean'] : ['paste', 'open']
  if (kind === 'path') return ['paste', 'folder']
  if (kind === 'mail') return ['paste', 'write']
  if (kind === 'code') return ['plain']
  const colour = kind === 'colour' && colourOf(text)
  if (!colour) return ['paste']
  const own = FORMATS.indexOf(colour.format)
  return [...FORMATS.slice(own), ...FORMATS.slice(0, own)]
}

/**
 * What Enter on `action` puts on the clipboard in place of the item: a colour in another format, or the link without
 * its trackers. Nothing when it pastes the item itself, or opens something.
 */
export function formOf(text: string, action: Action): string | undefined {
  if (action === 'clean') return untracked(text.trim())
  if (action !== 'hex' && action !== 'rgb' && action !== 'hsl') return
  const colour = colourOf(text)
  return colour && colour.format !== action ? formatted(colour.rgb, action) : undefined
}

// --- Colours ---

const NUMBER = String.raw`(\d{1,3}(?:\.\d+)?)`
const BETWEEN = String.raw`(?:\s*,\s*|\s+)`
const RGB = new RegExp(String.raw`^rgb\(\s*(\d{1,3})${BETWEEN}(\d{1,3})${BETWEEN}(\d{1,3})\s*\)$`, 'i')
const HSL = new RegExp(String.raw`^hsl\(\s*${NUMBER}(?:deg)?${BETWEEN}${NUMBER}%${BETWEEN}${NUMBER}%\s*\)$`, 'i')

/**
 * A colour written `#RGB`, `#RRGGBB`, `rgb(30, 144, 255)` or `hsl(210, 100%, 56%)`, commas or spaces between, and the
 * way it was written.
 */
// shortcut: no alpha (#RGBA, rgba(), hsla()), add it if people copy translucent colours.
export function colourOf(text: string): { rgb: Rgb; format: Format } | undefined {
  const t = text.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb, format: 'hex' }
  }
  const rgb = RGB.exec(t)?.slice(1).map(Number)
  if (rgb) return rgb.every((c) => c <= 255) ? { rgb: rgb as Rgb, format: 'rgb' } : undefined
  const hsl = HSL.exec(t)?.slice(1).map(Number)
  if (hsl && hsl[0] <= 360 && hsl[1] <= 100 && hsl[2] <= 100) {
    return { rgb: fromHsl(hsl[0], hsl[1], hsl[2]), format: 'hsl' }
  }
}

/** The colour written as the list shows it: `#1E90FF`, `rgb(30, 144, 255)`, `hsl(210, 100%, 56%)`. */
export function formatted([r, g, b]: Rgb, format: Format): string {
  if (format === 'rgb') return `rgb(${r}, ${g}, ${b})`
  if (format === 'hsl') {
    const [h, s, l] = toHsl(r, g, b)
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** A colour item in `format`: as it was copied in its own, worked out in the others. */
export function shown(text: string, format: Format): string {
  const colour = colourOf(text)
  if (!colour) return preview(text)
  return colour.format === format ? text.trim() : formatted(colour.rgb, format)
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const [sat, light] = [s / 100, l / 100]
  const a = sat * Math.min(light, 1 - light)
  const at = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [at(0), at(8), at(4)]
}

function toHsl(r: number, g: number, b: number): Rgb {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const [max, min] = [Math.max(red, green, blue), Math.min(red, green, blue)]
  const [l, d] = [(max + min) / 2, max - min]
  let [h, s] = [0, 0]
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    h = max === red ? ((green - blue) / d) % 6 : max === green ? (blue - red) / d + 2 : (red - green) / d + 4
    h = (h * 60 + 360) % 360
  }
  return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)]
}

// --- Links ---

/**
 * Query parameters that only follow you: campaign tags and ad clicks. Everything else stays, since a site may need it.
 */
const TRACKERS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
])

const isTracker = (param: string) => {
  const name = param.split('=')[0].toLowerCase()
  return name.startsWith('utm_') || TRACKERS.has(name)
}

/** A link cut as Rust cuts it (`trims` in clipboard.rs): what comes before the query, its parameters, the hash. */
function split(url: string): { head: string; params: string[]; hash: string } {
  const at = url.indexOf('#')
  const [rest, hash] = at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at)]
  const q = rest.indexOf('?')
  if (q < 0) return { head: rest, params: [], hash }
  return { head: rest.slice(0, q), params: rest.slice(q + 1).split('&'), hash }
}

function tracked(url: string): boolean {
  return split(url).params.some(isTracker)
}

/** The link without its trackers, everything else in its place. */
export function untracked(url: string): string {
  const { head, params, hash } = split(url)
  const kept = params.filter((param) => !isTracker(param))
  return head + (kept.length ? `?${kept.join('&')}` : '') + hash
}

/**
 * A link's line: the domain without `www.`, then the path, the query and the hash in pieces, its trackers marked so
 * they show dimmer and leave as Tab offers to paste it without them.
 */
export function linkParts(url: string): { domain: string; rest: { text: string; tracker: boolean }[] } {
  const { head, params, hash } = split(url.trim())
  const authority = head.replace(/^https?:\/\//i, '')
  const slash = authority.indexOf('/')
  const [domain, path] = slash < 0 ? [authority, ''] : [authority.slice(0, slash), authority.slice(slash)]
  const query = params.map((param, i) => ({ text: (i ? '&' : '?') + param, tracker: isTracker(param) }))
  return {
    domain: domain.replace(/^www\./i, ''),
    rest: [{ text: path, tracker: false }, ...query, { text: hash, tracker: false }].filter((part) => part.text),
  }
}

// --- Paths and code ---

/** A path's line, cut in the middle: `C:\Users\…\Sumi\rapport-0.9.pdf`. The quotes of "Copy as path" go. */
export function middle(text: string): string {
  const path = text.trim().replace(/^"(.*)"$/, '$1')
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep)
  return parts.length > 4 ? [...parts.slice(0, 2), '…', ...parts.slice(-2)].join(sep) : path
}

/** The folder the peek names after « Dossier »: the one that holds the file or the folder, which Explorer opens. */
export function folderOf(text: string): string {
  const parts = text
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
  return parts.length > 1 ? parts[parts.length - 2] : parts[0]
}

/** Code's line: its first line, as it is, and how many lines it has. */
export function codeOf(text: string): { first: string; lines: number } {
  const lines = text.trim().split(/\r?\n/)
  return { first: preview(lines[0]), lines: lines.length }
}

// --- The list ---

/**
 * What the filter reads for an item, folded once: its text, a colour in all its formats, and its type's words in the
 * island's language, so « couleur » finds the colours.
 */
export function searchKey(text: string, kind: Kind, lang: Lang): string {
  const colour = kind === 'colour' && colourOf(text)
  const forms = colour ? FORMATS.map((format) => formatted(colour.rgb, format)) : []
  return fold([text, ...forms, CLIPBOARD_WORDS[lang].kinds[kind]].join(' '))
}

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
