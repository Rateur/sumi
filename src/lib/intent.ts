/**
 * What a line typed in the command bar does: a timer, an app, the time or a question. Local rules only, so the same
 * text always gives the same chip, and nothing is sent anywhere while typing. The line is read once, the same way
 * every time (folded, elisions and clitics split, politeness off its ends), then the first rule that matches wins: a
 * timer, an app's exact name or alias as typed, the time or the date, an assistant by name, a search, a verb and an
 * app, then the default target. When in doubt the line is a question: acting wrongly costs more than not acting.
 */

import { formatLongDate, formatTime } from './clock'

export type Lang = 'fr' | 'en'

/** An entry from Start's list. The bar hands back the caller's own object, so it may carry more. */
export interface App {
  name: string
}

/** A running timer, as the bar needs it: `left` is the time left while paused. */
export interface Timer {
  id: string
  endsAt: number
  label?: string
  left?: number
}

export type Assistant = 'claude' | 'chatgpt' | 'gemini' | 'perplexity'
export type Target = Assistant | 'search'

export type Choice<A extends App = App> = { label: string } & (
  | { kind: 'timer'; ms: number; name?: string }
  | { kind: 'add'; id: string; ms: number }
  | { kind: 'pause' | 'resume' | 'stop'; id: string }
  | { kind: 'app'; app: A }
  // The answer is the label itself: 'Il est 11:27' or 'Jeudi 19 novembre'.
  | { kind: 'clock'; what: 'time' | 'date' }
  // `peek` is what the island shows after Enter: 'Claude', or 'Claude · navigateur' when it opens on the web.
  | { kind: 'ask'; to: Target; question: string; web: boolean; peek: string }
)

export interface Options<A extends App> {
  apps: readonly A[]
  lang: Lang
  /** Whether Windows knows the `claude:` link, so Claude opens in its app. */
  claudeApp: boolean
  timers?: readonly Timer[]
  now?: number
  /** The locale of the island's clock; the system's when left out. */
  locale?: string
  /** The default target first, then the others in the user's order. The search engine always comes last. */
  order?: readonly Assistant[]
}

/**
 * Their links are a fixed table in Rust (`link` in src-tauri/src/apps.rs), which builds them from the question. Only
 * Claude has a documented app link; the others open their website, prefilled and never sent.
 */
export const ASSISTANTS: Record<Target, { name: string; app?: boolean }> = {
  claude: { name: 'Claude', app: true },
  chatgpt: { name: 'ChatGPT' },
  gemini: { name: 'Gemini' },
  perplexity: { name: 'Perplexity' },
  search: { name: 'Google' },
}

const ORDER: Assistant[] = ['claude', 'chatgpt', 'gemini', 'perplexity']

const WORDS = {
  fr: {
    open: 'Ouvrir',
    ask: 'Demander à',
    web: 'navigateur',
    search: 'Rechercher',
    timer: 'Minuteur',
    none: (q: string) => `Aucune app « ${q} »`,
    time: (t: string) => `Il est ${t}`,
    pause: ['Pause', 'Mettre en pause'],
    resume: ['Reprendre', 'Reprendre'],
    stop: ['Arrêter', 'Arrêter le minuteur'],
  },
  en: {
    open: 'Open',
    ask: 'Ask',
    web: 'browser',
    search: 'Search',
    timer: 'Timer',
    none: (q: string) => `No app "${q}"`,
    time: (t: string) => `It's ${t}`,
    pause: ['Pause', 'Pause the timer'],
    resume: ['Resume', 'Resume the timer'],
    stop: ['Stop', 'Stop the timer'],
  },
} as const

/** Lowercase without accents, one character for one, so a match in the folded text slices the typed one. */
export function fold(text: string): string {
  return Array.from(text, (c) => {
    const f = c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    return f.length === c.length ? f : c
  }).join('')
}

// --- Reading the line ---

// Punctuation outside numbers ('1:30' and '1,5h' keep theirs), and a hyphen after a number ('3-min').
const PUNCT = /[?!;«»"“”()]|(?<!\d)[.,:]|[.,:](?!\d)|(?<=\d)-(?=\p{L})/gu
// "l'explorateur" reads as two words, as do "qu'il" and "j'aimerais".
const ELISION = /^(?:qu|[cdjlmnst])'(?=\p{L})/u
// A hyphen splits only before these: 'ouvre-moi', 'lance-le', 'sommes-nous', 'a-t-il'. 'peux-tu' and 'est-il' stay.
const CLITICS = new Set(['moi', 'toi', 'le', 'la', 'les', 'lui', 'leur', 'nous', 'vous', 'y', 'en', 't'])
// Kept whole, as are the hyphenated words of app names.
const FROZEN = new Set(['rendez-vous', 'peut-etre', "aujourd'hui", "c'est-a-dire", 'notepad++'])
// Politeness, on the ends of the line only. 'dis-moi' and 'tell me' ask for something, so they stay.
const START = new RegExp(
  "^(?:hey sumi|sumi|est[- ]ce que (?:tu peux|vous pouvez)|tu peux|tu pourrais|peux[- ]tu|pourrais[- ]tu|" +
    "vous pouvez|pouvez vous|pourriez vous|stp|svp|s' il (?:te|vous) plait|please|can you|could you|would you|" +
    "je veux|je voudrais|j' aimerais|i want to|i want|i'd like to|i'd like|i would like to|i would like)(?= |$)",
)
const END = / (?:stp|svp|s' il (?:te|vous) plait|please|merci(?: beaucoup)?|thanks|thank you)$/
// A command said in the negative is no command: "n'ouvre pas discord", 'cherche pas', "don't open spotify".
const NEGATION = /^(?:ne|n'|pas|jamais|don't|dont|do not|never) |^\S+ (?:pas|jamais|rien|plus)(?: |$)/

/** A line as the rules read it: `text` folded for matching, `raw` with the letters as typed, `at` their places. */
interface Read {
  text: string
  raw: string
  at: number[]
}

// One apostrophe, no punctuation that can't matter, elisions and clitics split, single spaces. Words in `frozen`
// keep their hyphens. Places are UTF-16 ones in the typed line, as fold keeps one unit for one.
function prep(typed: string, frozen?: ReadonlySet<string>): Read {
  const s = typed.replace(/[’‘ʼ]/g, "'")
  const whole = (w: string) => FROZEN.has(w) || !!frozen?.has(w)
  const words: [string, number][] = []
  for (const m of fold(s).replace(PUNCT, ' ').matchAll(/\S+/g)) {
    let word = m[0]
    let at = m.index
    const elision = whole(word) ? null : ELISION.exec(word)
    if (elision) {
      words.push([elision[0], at])
      at += elision[0].length
      word = word.slice(elision[0].length)
    }
    const bits = whole(word) ? [word] : word.split('-')
    let piece = bits[0]
    for (let k = 1; k < bits.length; k++) {
      if (CLITICS.has(bits[k]) || (k > 1 && bits[k - 1] === 't')) {
        words.push([piece, at])
        at += piece.length + 1
        piece = bits[k]
      } else piece += '-' + bits[k]
    }
    words.push([piece, at])
  }
  const read: Read = { text: '', raw: '', at: [] }
  for (const [word, start] of words) {
    if (read.text) {
      read.text += ' '
      read.raw += ' '
      read.at.push(start)
    }
    read.text += word
    for (let i = 0; i < word.length; i++) {
      read.raw += s[start + i]
      read.at.push(start + i)
    }
  }
  return read
}

// Politeness off both ends, as long as something is left: 'merci' alone stays a line.
function strip(read: Read): Read {
  for (;;) {
    const { text } = read
    const start = START.exec(text)
    const end = END.exec(text)
    const [from, to] =
      start && start[0].length < text.length ? [start[0].length + 1, text.length] : [0, end ? end.index : text.length]
    if (from === 0 && to === text.length) return read
    read = { text: text.slice(from, to), raw: read.raw.slice(from, to), at: read.at.slice(from, to) }
  }
}

/** The line as the rules read it, letters as typed, and each one's place in the typed line. */
export function normalize(typed: string): { text: string; at: number[] } {
  const { raw, at } = strip(prep(typed))
  return { text: raw, at }
}

// --- Timers ---

const NUM = String.raw`\d+(?:[.,]\d+)?`
const SEC = 'secondes?|seconds?|secs?|s'
const MIN = 'minutes?|mins?|mn|m'
const HOUR = 'heures?|hours?|hrs?|h'
const UNIT: [RegExp, number][] = [
  [new RegExp(`^(?:${SEC})$`), 1000],
  [new RegExp(`^(?:${MIN})$`), 60_000],
  [new RegExp(`^(?:${HOUR})$`), 3_600_000],
]
// 1h30, 1 h 30, 1 hour and 30 minutes, 2m30, 2 min 30, 90s, 1,5h, or a bare number of minutes. A number after
// hours is minutes unless seconds follow it: 'an hour and 30 seconds'.
const AND = String.raw`(?:\s*(?:and|et)\b)?\s*`
const DURATION = new RegExp(
  String.raw`(?<![\w.,])(?:(${NUM})\s*(${HOUR})(?:${AND}(\d+)(?!\d)\s*(?:(?:${MIN})(?![a-z])|(?!\s*(?:${SEC})(?![a-z]))))?` +
    String.raw`(?:${AND}(\d+)\s*(?:${SEC}))?|(${NUM})\s*(${MIN})(?:${AND}(\d+)\s*(?:${SEC})?)?|(${NUM})\s*(${SEC})` +
    String.raw`|(\d+))(?![\w.,])`,
)
// Spelled numbers up to a hundred, French and English: a closed table, never a guess.
const NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11,
  douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40,
  cinquante: 50, soixante: 60, cent: 100, one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100,
}
const WORD = Object.keys(NUMBERS)
  .toSorted((a, b) => b.length - a.length)
  .join('|')
// 'vingt-cinq', 'vingt et un', 'soixante-dix', 'quatre-vingt-dix', 'twenty-five'.
const SPELLED = `(?:${WORD})(?:[- ](?:et[- ])?(?:${WORD}))*`
const SPOKEN_UNIT = 'secondes?|seconds?|secs?|minutes?|mins?|heures?|hours?|hrs?'
const COUNT = `(${SPELLED}|${NUM}|an?)`
const words = (s: string) => new RegExp(`(?<![\\p{L}\\d])(?:${s})(?![\\p{L}\\d])`, 'gu')
// 'quatre-vingt' is 80, 'cent' and 'hundred' multiply, the rest adds up.
const count = (n: string) =>
  /\d/.test(n)
    ? Number(n.replace(',', '.'))
    : n
        .split(/[- ]/)
        .filter((w) => w !== 'et')
        .reduce(
          (sum, w) =>
            w === 'cent' || w === 'hundred' ? (sum || 1) * 100 : w.startsWith('vingt') && sum === 4 ? 80 : sum + (NUMBERS[w] ?? 1),
          0,
        )
// Halves and quarters first ('une et demi heure' before 'demi heure'), then a number and its unit, then a number
// after a unit ('1 hour thirty').
const SPELL: [RegExp, (m: RegExpMatchArray) => string][] = [
  [words(`${COUNT} (?:et|and) (?:an? )?(?:demie?|half) (${SPOKEN_UNIT})`), (m) => `${count(m[1]) + 0.5} ${m[2]}`],
  [words(`(?:une? )?demi[- ]heure|(?:a )?half[- ](?:an )?hour`), () => '30 min'],
  [words(`(?:un )?quart d'heure|(?:a |one )?quarter (?:of an )?hour`), () => '15 min'],
  [words(`trois quarts? d'heure|three quarters of an hour`), () => '45 min'],
  [words(`${COUNT} (${SPOKEN_UNIT}) (?:et|and) (?:a )?(?:demie?|half)`), (m) => `${count(m[1]) + 0.5} ${m[2]}`],
  [words(`${COUNT} (?:heures?|hours?) (?:et|and) (?:a )?quart(?:er)?`), (m) => `${count(m[1])} h 15`],
  [words(`${COUNT} heures? moins (?:le )?quart`), (m) => `${count(m[1]) - 1} h 45`],
]
const ONE = words(`${COUNT} (${SPOKEN_UNIT})`)
const AFTER = words(`(${SPOKEN_UNIT}) (?:(?:et|and) )?(${SPELLED})`)

// Rewrites what `re` finds in the folded line, in the line as typed: fold keeps one character for one.
function rewrite(line: string, re: RegExp, write: (m: RegExpMatchArray) => string): string {
  let out = ''
  let last = 0
  for (const m of fold(line).matchAll(re)) {
    out += line.slice(last, m.index) + write(m)
    last = m.index + m[0].length
  }
  return out + line.slice(last)
}

// Spelled durations as digits: 'une demi-heure' is '30 min', 'ten minutes' '10 minutes'. `article` says a lone
// 'a', 'an', 'un' or 'une' gave one, as in 'une minute' or 'wait a minute': a phrase unless a timer is asked for.
function spell(line: string): { line: string; article: boolean } {
  let article = false
  for (const [re, write] of SPELL) line = rewrite(line, re, write)
  line = rewrite(line, ONE, (m) => {
    article ||= /^(?:an?|une?)$/.test(m[1])
    return `${count(m[1])} ${m[2]}`
  })
  line = rewrite(line, AFTER, (m) => `${m[1]} ${count(m[2])}`)
  return { line, article }
}

// 'chrono' counts up, so it is a timer only with a unit: 'chrono 5 min', never 'chrono 5'.
const KEYWORDS = new Set(['minuteur', 'minuterie', 'timer', 'chrono', 'chronometre'])
// Glue and determiners around the duration and the label, with their accents: 'thé' is no 'the'.
const EDGE = new Set(
  ['de', "d'", 'pour', 'for', 'of', 'a', 'an', 'un', 'une', 'le', 'la', 'les', "l'", 'des', 'du', 'the', 'my'].concat(
    ['mon', 'ma', 'mes', 'ton', 'ta', 'tes'],
  ),
)
// The verbs that start one: 'mets un minuteur de 10 s', 'set a timer for 5 minutes', 'lance 25m'.
const SET = new RegExp(
  '^(?:mets|met|mettre|mettez|lance|lancer|lancez|demarre|demarrer|demarrez|programme|programmer|regle|regler|' +
    'set|start|make|put) ',
)
// A question, a conversion, a stopwatch or a cycle: never a timer.
const QUESTION = /\b(combien|comment|quel|quelle|quels|quelles|pourquoi|how|what|why|convert|convertir)\b|\?/
const CONVERSION = /\b(en|in|to) [a-z]/
const NOT_A_TIMER = /\b(stopwatch|pomodoro)\b/
// A time of day, checked before the accents go: 'à 18h30' is an alarm, 'a' alone is glue.
const TIME_OF_DAY = /(^|\s)(à|at|until|vers|jusqu['’]à|jusqu['’]a)\s*\d/
const HOURS_12 = 12 * 3_600_000

const toMs = (n: string, unit: string) => {
  const per = UNIT.find(([re]) => re.test(unit))![1]
  return Number(n.replace(',', '.')) * per
}

/** A whole line read as a new timer: its length, and its label of at most 3 words. Anything else is no timer. */
export function parseTimer(line: string): { ms: number; label?: string } | undefined {
  const { line: raw, article } = spell(line.trim().replace(/\s+/g, ' ').replace(/[’‘ʼ]/g, "'"))
  const folded = fold(raw)
  if (QUESTION.test(folded) || CONVERSION.test(folded) || NOT_A_TIMER.test(folded) || TIME_OF_DAY.test(raw.toLowerCase()))
    return
  const read = strip(prep(raw))
  if (NEGATION.test(read.text)) return
  const verb = SET.exec(read.text)?.[0].length ?? 0
  const typed = read.raw.slice(verb)
  const m = DURATION.exec(read.text.slice(verb))
  if (!m) return
  const [, h, hu, hm, hs, mn, mu, ms, sn, su, bare] = m
  const n = (s?: string) => (s ? Number(s) : 0)
  const total =
    h !== undefined
      ? toMs(h, hu) + n(hm) * 60_000 + n(hs) * 1000
      : mn !== undefined
        ? toMs(mn, mu) + n(ms) * 1000
        : sn !== undefined
          ? toMs(sn, su)
          : Number(bare) >= 1 && Number(bare) <= 180
            ? Number(bare) * 60_000
            : 0
  if (total < 1000 || total > HOURS_12) return
  // The words around the duration, without the keyword and the glue next to them, are its label.
  const split = (s: string) => s.split(' ').filter(Boolean)
  const before = split(typed.slice(0, m.index).replace(/(^|\s)d'$/i, ''))
  const after = split(typed.slice(m.index + m[0].length))
  const trim = (list: string[]) => {
    while (list.length && EDGE.has(list[0].toLowerCase())) list.shift()
    while (list.length && EDGE.has(list.at(-1)!.toLowerCase())) list.pop()
  }
  trim(before)
  trim(after)
  // In front ('minuteur 10'), or behind in English ('10 minute timer').
  const isKeyword = (w = '') => KEYWORDS.has(fold(w))
  const keyword = isKeyword(before[0]) ? before.shift() : isKeyword(after[0]) ? after.shift() : undefined
  trim(before)
  trim(after)
  const label = [...before, ...after]
  if (label.length > 3 || label.some((w) => /\d/.test(w) || !/\p{L}/u.test(w) || KEYWORDS.has(fold(w)))) return
  if (article && !keyword && !verb) return
// A bare number with words is a name ('gpt 4', 'windows 11') unless a keyword says it is a timer.
  if (bare !== undefined && ((label.length && !keyword) || fold(keyword ?? '').startsWith('chrono'))) return
  return { ms: Math.round(total), label: label.join(' ') || undefined }
}

/** '25 min', '1 h 30', '2 min 30 s', '45 s': unit words, never the raw text, so a misreading shows. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
  if (h) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
  if (m) return sec ? `${m} min ${sec} s` : `${m} min`
  return `${sec} s`
}

/** '+5', 'pause', 'stop pâtes': words that act on a running timer, the one that ends first or the one named. */
function timerAction<A extends App>(line: string, timers: readonly Timer[], now: number, lang: Lang): Choice<A> | undefined {
  const text = fold(line)
  const ends = (t: Timer) => (t.left !== undefined ? now + t.left : t.endsAt)
  const soonest = (list: readonly Timer[], name?: string) =>
    name ? list.find((t) => t.label && fold(t.label) === fold(name)) : list.toSorted((a, b) => ends(a) - ends(b))[0]
  const words = WORDS[lang]
  const add = new RegExp(String.raw`^\+\s*(${NUM})\s*(${SEC}|${MIN}|${HOUR})?$`).exec(text)
  if (add) {
    const ms = toMs(add[1], add[2] ?? 'm')
    const timer = soonest(timers)
    if (!timer || ms < 1000 || ms > HOURS_12) return
    return { kind: 'add', id: timer.id, ms, label: `+${formatDuration(ms)}${timer.label ? ` · ${timer.label}` : ''}` }
  }
  const verb = /^(pause|reprendre|resume|stop|annule|annuler|cancel)(?: (.+))?$/.exec(text)
  if (!verb) return
  const kind = verb[1] === 'pause' ? 'pause' : verb[1] === 'reprendre' || verb[1] === 'resume' ? 'resume' : 'stop'
  const name = verb[2] && line.slice(line.length - verb[2].length)
  const pool = timers.filter((t) => (kind === 'pause' ? t.left === undefined : kind === 'resume' ? t.left !== undefined : true))
  const timer = soonest(pool, name)
  if (!timer) return
  const [verbWord, alone] = words[kind]
  return { kind, id: timer.id, label: timer.label ? `${verbWord} ${timer.label}` : alone }
}

// --- Apps ---

/** How names compare: folded, without apostrophes or hyphens, each word without a plural s or x unless kept. */
export function key(name: string, plural = false): string {
  return fold(name)
    .replace(/['’]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && !plural ? w.replace(/[sx]$/, '') : w))
    .join(' ')
}

// Hand-written aliases, French and English alike: any word of a group finds the app named by another.
const ALIASES = [
  ['parametres', 'settings', 'reglages', 'preferences', 'options'],
  ['explorateur de fichiers', 'file explorer', 'explorateur', 'explorer', 'fichiers', 'mes fichiers', 'files'],
  ['calculatrice', 'calculator', 'calc'],
  ['visual studio code', 'code', 'vscode'],
]
const GROUPS = new Map(ALIASES.flatMap((group) => group.map((a) => [key(a), group] as const)))

// Optimal string alignment: a wrong, missing or extra letter, or two swapped neighbors, is one typo. Past `max`, it
// stops early and says max + 1.
function typos(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let before: number[] = []
  let last = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1)
    }
    if (Math.min(...row) > max) return max + 1
    before = last
    last = row
  }
  return last[b.length]
}

// Letters in order, the way people shorten a name: from the start of a word, then dropping only vowels ('ntpd')
// or jumping to the next word ('vsc'). So 'porte' never finds 'exPlORaTEur', nor 'timer' 'TIME doctoR'.
function shortens(query: string, name: string): boolean {
  let i = 0
  let skipped = 'x' // the first letter starts a word
  for (const [j, c] of [...name].entries()) {
    if (c === query[i] && (j === 0 || name[j - 1] === ' ' || !/[^aeiouy ]/.test(skipped))) {
      if (++i === query.length) return true
      skipped = ''
    } else skipped += c
  }
  return false
}

interface Entry<A> {
  app: A
  // The name's key, then its aliases', and the same with a space in front, for the start of a word.
  keys: string[]
  spaced: string[]
  // Plural kept, each with its words, for typos.
  typo: string[][]
}

interface Index<A> {
  entries: Entry<A>[]
  // Exact keys: aliases first, then names, so an alias wins as the research ranks it.
  exact: Map<string, A>
  // The hyphenated words of names, kept whole when the line is read.
  frozen: Set<string>
}

// Built once per list, so a keystroke only compares.
const INDEXES = new WeakMap<readonly App[], Index<App>>()

function indexOf<A extends App>(apps: readonly A[]): Index<A> {
  const known = INDEXES.get(apps) as Index<A> | undefined
  if (known) return known
  const index: Index<A> = { entries: [], exact: new Map(), frozen: new Set() }
  const names = new Map<string, A>()
  for (const app of apps) {
    const folded = fold(app.name)
    const name = key(app.name)
    // Uninstallers never open from the bar, and a name seen twice is the first one.
    if (/\b(uninstall|desinstall)/.test(folded) || names.has(name)) continue
    names.set(name, app)
    const group = GROUPS.get(name)?.filter((a) => key(a) !== name) ?? []
    const keys = [name, ...group.map((a) => key(a))]
    for (const k of keys.slice(1)) if (!index.exact.has(k)) index.exact.set(k, app)
    index.entries.push({
      app,
      keys,
      spaced: keys.map((k) => ' ' + k),
      typo: [app.name, ...group].map((a) => key(a, true)).map((k) => [k, ...k.split(' ')]),
    })
    for (const w of folded.split(/\s+/)) if (w.includes('-')) index.frozen.add(w)
  }
  for (const [name, app] of names) if (!index.exact.has(name)) index.exact.set(name, app)
  INDEXES.set(apps, index)
  return index
}

/**
 * The app a query names, by fixed tiers: an exact alias or name, a prefix, the start of a word, a typo, then a
 * shortening. The shorter name wins a prefix or a word start ('ste' is Steam, not Steam VR); a tie among typos or
 * shortenings finds nothing, as does a known name whose app is missing. Usage never reorders it.
 */
export function findApp<A extends App>(query: string, apps: readonly A[]): A | undefined {
  const q = key(query)
  if (!q) return
  const { entries, exact } = indexOf(apps)
  const named = exact.get(q)
  if (named) return named
  // No Calculator never opens Calendar.
  if (GROUPS.has(q)) return
  // One letter is too little to act on.
  if (q.length < 2) return
  const spaced = ' ' + q
  for (const test of [(e: Entry<A>) => e.keys.some((k) => k.startsWith(q)), (e: Entry<A>) => e.spaced.some((k) => k.includes(spaced))]) {
    let best: A | undefined
    for (const e of entries) if (test(e) && (!best || e.app.name.length < best.name.length)) best = e.app
    if (best) return best
  }
  // Typos and shortenings are for words: '10' is no typo of '11'.
  if (/\d/.test(q)) return
  // Each word allows as many typos as its own length does, plural kept: none up to 4 letters, one from 5, two from
  // 9, so 'timer' never finds 'Time' and 'teans' finds 'Teams'. Against the name, its start, or a word.
  const typed = key(query, true)
  let best = Infinity
  let found: A[] = []
  for (const e of entries) {
    let d = Infinity
    for (const [name, ...parts] of e.typo)
      for (const w of [name, name.slice(0, typed.length).trim(), ...parts]) {
        const max = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0
        const t = max ? typos(typed, w, max) : Infinity
        if (t <= max) d = Math.min(d, t)
      }
    if (d < best) [best, found] = [d, [e.app]]
    else if (d === best && d !== Infinity) found.push(e.app)
  }
  if (found.length) return found.length === 1 ? found[0] : undefined
  if (q.length < 3) return
  const short = entries.filter((e) => e.keys.some((k) => shortens(q, k)))
  return short.length === 1 ? short[0].app : undefined
}

// --- The time and the date ---

// Whole lines only, so 'quelle heure est-il à Tokyo' and 'time management tips' stay questions. Read with elisions
// split: "c' est", "l' heure".
const TIME = new RegExp(
  "^(?:(?:il est |c' est )?quel(?:le)? heure(?: (?:est(?:[- ]t'?)?[- ]il|il est|c' est|est[- ]ce))?|" +
    "(?:(?:affiche|montre|donne|dis)(?: moi)? )?(?:l'? )?heure|" +
    "what time is it|what time it is|what(?:'s| is) the time|whats the time|" +
    '(?:(?:show|tell)(?: me)? )?(?:the |current )?time)$',
)
const DATE = new RegExp(
  "^(?:(?:on est |c' est )?quel jour(?: (?:sommes nous|nous sommes|on est|est[- ]on|est[- ]il|c' est|est[- ]ce))?|" +
    '(?:on est|nous sommes) le combien|quelle date(?: (?:sommes nous|on est|est[- ]on))?|' +
    "(?:(?:affiche|montre|donne|dis)(?: moi)? )?(?:la )?date(?: d' aujourd'hui)?|what day is it|what day is today|" +
    "what(?:'s| is) (?:the|today's) date(?: today)?|whats (?:the|todays) date|" +
    "(?:(?:show|tell)(?: me)? )?(?:the |today's |todays )?date)$",
)

// --- Assistants ---

// A question opens in Claude's app when Windows knows its link, on the website otherwise.
function ask<A extends App>(to: Target, question: string, claudeApp: boolean, lang: Lang, label?: string): Choice<A> {
  const words = WORDS[lang]
  const { name, app } = ASSISTANTS[to]
  const web = !(app && claudeApp)
  const action = to === 'search' ? words.search : web ? name : `${words.ask} ${name}`
  return {
    kind: 'ask',
    to,
    question,
    web,
    peek: web ? `${name} · ${words.web}` : name,
    label: label ?? (web ? `${action} · ${words.web}` : action),
  }
}

// The verbs, as lemmas: each inflection a person types leads to one intent.
const BY_NAME = new RegExp(
  '^(?:(?:demande|demander|demandez|pose|poser|ask|tell)(?: (?:la|une|ma|the|a|my) question)?(?: (?:a|to))? )?' +
    '(claude|chatgpt|gpt|gemini|perplexity|google) (.+)$',
)
const SEARCH = /^(?:cherche|chercher|recherche|rechercher|trouve|trouver|search|look up|find)(?: moi)? (.+)$/
// Dropped after a verb: 'ouvre les paramètres', 'open the calculator', "lance l'explorateur".
const DET = "(?:(?:le|la|les|un|une|des|du|de la|mon|ma|mes|ton|ta|tes|the|a|an|my|l'|d') )?"
// The word for an app is no part of its name: "lance l'appli discord", 'open the spotify app'. Nor is the 'moi' of
// 'ouvre-moi discord'.
const NOUN = '(?:(?:app|appli|application|logiciel|programme) )?'
// The first group says no app aloud; 'montre' or 'show' without an app is just a question.
const VERB = new RegExp(
  '^(?:(ouvre|ouvres|ouvrez|ouvrir|lance|lances|lancer|lancez|demarre|demarrer|demarrez|open|launch|start)|' +
    `affiche|afficher|montre|montrer|show|run) (?:moi )?${DET}${NOUN}(.+?)(?: (?:app|appli|application))?$`,
  'd',
)

/**
 * What Enter can do with a line, the top guess first, then what Tab reaches: the default assistant, the others
 * in the user's order, then the search engine. An empty line does nothing.
 */
export function choices<A extends App>(line: string, options: Options<A>): Choice<A>[] {
  const { lang, claudeApp, timers = [], now = Date.now(), locale, order = ORDER } = options
  const typed = line.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const { exact, frozen } = indexOf(options.apps)
  const whole = prep(typed, frozen)
  const read = strip(whole)
  const text = read.text
  // The end of the line a rule matched, as typed, for a question.
  const rest = (match: string) => typed.slice(read.at[text.length - match.length])
  const open = (app: A): Choice<A> => ({ kind: 'app', app, label: `${WORDS[lang].open} ${app.name}` })

  // The top guess, and the question the alternatives pass on: a named assistant's own, or the whole line.
  const [top, question] = ((): [Choice<A>, string] => {
    const action = timers.length ? timerAction<A>(typed, timers, now, lang) : undefined
    if (action) return [action, typed]
    const timer = parseTimer(typed)
    if (timer) {
      const label = `${WORDS[lang].timer} ${formatDuration(timer.ms)}${timer.label ? ` · ${timer.label}` : ''}`
      return [{ kind: 'timer', ms: timer.ms, name: timer.label, label }, typed]
    }
    // An exact name as typed comes before the assistants, so 'Google Chrome' opens Chrome rather than searching
    // 'chrome'. Politeness stays on for it: 'merci claude' and 'sumi claude' are questions.
    const named = exact.get(key(whole.text))
    if (named) return [open(named), typed]
    if (NEGATION.test(text)) return [ask(order[0], typed, claudeApp, lang), typed]
    if (TIME.test(text)) {
      return [{ kind: 'clock', what: 'time', label: WORDS[lang].time(formatTime(new Date(now), locale)) }, typed]
    }
    if (DATE.test(text)) {
      const day = formatLongDate(new Date(now), locale)
      return [{ kind: 'clock', what: 'date', label: day[0].toUpperCase() + day.slice(1) }, typed]
    }
    const by = BY_NAME.exec(text)
    if (by) {
      const to: Target = by[1] === 'google' ? 'search' : by[1] === 'gpt' ? 'chatgpt' : (by[1] as Assistant)
      return [ask(to, rest(by[2]), claudeApp, lang), rest(by[2])]
    }
    const search = SEARCH.exec(text)
    if (search) return [ask('search', rest(search[1]), claudeApp, lang), rest(search[1])]
    const verb = VERB.exec(text)
    if (verb) {
      const app = findApp(verb[2], options.apps)
      if (app) return [open(app), typed]
      // Named as typed. 'lance un minuteur' is no missing app, just a question.
      const [from, to] = verb.indices![2]!
      const none = WORDS[lang].none(typed.slice(read.at[from], read.at[to - 1] + 1))
      if (verb[1] && !KEYWORDS.has(verb[2].split(' ')[0])) return [ask(order[0], typed, claudeApp, lang, none), typed]
    }
    return [ask(order[0], typed, claudeApp, lang), typed]
  })()

  const all = [top, ...[...order, 'search' as const].map((to) => ask<A>(to, question, claudeApp, lang))]
  const seen = new Set<string>()
  return all.filter((c) => {
    const id = c.kind === 'ask' ? c.to : `${c.kind}:${c.label}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
