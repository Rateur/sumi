/**
 * What a line typed in the command bar does: a timer, an app, the time or a question. Local rules only, so the same
 * text always gives the same chip, and nothing is sent anywhere while typing. The line is read once, the same way
 * every time (folded, elisions and clitics split, politeness off its ends), then the first rule that matches wins: a
 * timer, the weather, an app's exact name or alias as typed, the time or the date, an assistant by name, a search, a
 * verb and an app, a word alone that starts one app's name, then the default target. When in doubt the line is a
 * question: acting wrongly costs more than not acting.
 */

import { formatLongDate, formatTime } from './clock'
import { answer, type Battery } from './power'
import { chip } from './weather'

export type Lang = 'fr' | 'en'

/** The island's language: the browser's, unless the page says `?lang=fr` or `?lang=en`, as the site's frames do. */
export function langOf(search: string, language: string): Lang {
  const asked = new URLSearchParams(search).get('lang')
  if (asked === 'fr' || asked === 'en') return asked
  return language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

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
  // The answer is the label too: « 47 % · sur secteur ».
  | { kind: 'battery' }
  // Today (0) or tomorrow (1), in the city typed, as typed, or without one in the session's: « Météo Lyon demain ».
  | { kind: 'weather'; city?: string; day: 0 | 1 }
  // The clipboard history, which opens in the bar: « Presse-papiers ».
  | { kind: 'clipboard' }
  // The screen capture, which the bar folds into: « Capture ».
  | { kind: 'capture' }
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
  /** The battery, read from Rust as the bar opened. */
  battery?: Battery
  /** The city the weather last found this session, for a bare « météo ». */
  city?: string
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
    clipboard: 'Presse-papiers',
    capture: 'Capture',
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
    clipboard: 'Clipboard',
    capture: 'Capture',
    none: (q: string) => `No app "${q}"`,
    time: (t: string) => `It's ${t}`,
    pause: ['Pause', 'Pause the timer'],
    resume: ['Resume', 'Resume the timer'],
    stop: ['Stop', 'Stop the timer'],
  },
} as const

/** Lowercase without accents, one character for one, so a match in the folded text slices the typed one. */
export function fold(text: string): string {
  // Printable ASCII but capitals is folded already: only the rest is looked at.
  return text.replace(/[A-Z]|[^ -~]/gu, (c) => {
    const f = c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    return f.length === c.length ? f : c
  })
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
// 'jveux' and 'pls' as people text them. 'vite' and 'for me' add nothing to what is asked. 'yo', 'ok' and 'hi'
// open a line, and 'do you know' wraps a question.
const START = new RegExp(
  '^(?:hey sumi|sumi|hey|yo|ok|hi|do you know|' +
    "est[- ]ce que (?:tu peux|vous pouvez)|tu peux|tu pourrais|peux[- ]tu|pourrais[- ]tu|" +
    "vous pouvez|pouvez vous|pourriez vous|stp|svp|s' il (?:te|vous) plait|please|pls|plz|can (?:you|ya|u)|" +
    "could you|would you|je veux|jveux|j' veux|je voudrais|j' aimerais|i want to|i want|i'd like to|i'd like|" +
    'i would like to|i would like)(?= |$)',
)
const POLITE = ['stp', 'svp', "s' il te plait", "s' il vous plait", 'please and thank you', 'please', 'pls', 'plz']
  .concat(['merci', 'merci beaucoup', 'thanks', 'thank you', 'thx', 'ty', 'tysm', 'cheers', 'vite', 'for me'])
  .concat(['pour moi'])
const END = new RegExp(` (?:${POLITE.join('|')})$`)
// Any start of a tail, so the chip holds while it is typed, as a unit does: 'quelle heure e', 'quelle heure est-i'.
const half = (tails: string[]) =>
  tails.map((s) => [...s].reduceRight((rest, c) => (rest ? `${c}(?:${rest})?` : c), '')).join('|')
// What a verb or the time may end with, as it is typed: 'ouvre discord st' is on its way to 'stp'.
const NOW = ['now', 'right now', 'rn', 'asap', 'maintenant', 'ok', 'okay']
const TAIL = new RegExp(` (?:${half([...POLITE, ...NOW])})$`)
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
  // Each word is a run of the typed line, so its letters as typed are a slice.
  const at: number[] = []
  for (const [word, start] of words) {
    if (at.length) at.push(start)
    for (let i = 0; i < word.length; i++) at.push(start + i)
  }
  const text = words.map(([word]) => word).join(' ')
  const raw = words.map(([word, start]) => s.slice(start, start + word.length)).join(' ')
  return { text, raw, at }
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
// A unit half typed is that unit, so the chip holds still while 'heures' is typed: 'he', 'heu' and 'heur' are hours.
const SEC = 's(?:e(?:c(?:o(?:n(?:d(?:es?|s)?)?)?|s)?)?)?'
const MIN = 'm(?:i(?:n(?:u(?:t(?:es?)?)?|s)?)?|n)?'
const HOUR = 'h(?:e(?:u(?:r(?:es?)?)?)?|o(?:u(?:rs?)?)?|rs?)?'
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
// "d'heure" without its apostrophe too: 'quart dheure', 'quart d heure'.
const DH = "d(?:' ?| )?heure"
// Halves and quarters first ('une et demi heure' before 'demi heure'), then a number and its unit, then a number
// after a unit ('1 hour thirty').
const SPELL: [RegExp, (m: RegExpExecArray) => string][] = [
  [words(`${COUNT} (?:et|and) (?:an? )?(?:demie?|half) (${SPOKEN_UNIT})`), (m) => `${count(m[1]) + 0.5} ${m[2]}`],
  [words(`(?:une? )?demi[- ]heure|(?:a )?half[- ](?:an )?hour`), () => '30 min'],
  // Three quarters before a quarter, or 'trois quart' reads as 3 and 15 min.
  [words(`trois quarts? ${DH}|three quarters of an hour`), () => '45 min'],
  [words(`(?:un )?quart ${DH}|(?:a |one )?quarter (?:of an )?hour`), () => '15 min'],
  [words(`${COUNT} (${SPOKEN_UNIT}) (?:et|and) (?:a )?(?:demie?|half)`), (m) => `${count(m[1]) + 0.5} ${m[2]}`],
  // After digits, the units written short too: '1 h et demi', '1h et demie'.
  [words(`(${NUM}) ?(h|mn|min) (?:et|and) (?:a )?(?:demie?|half)`), (m) => `${count(m[1]) + 0.5} ${m[2]}`],
  [words(`${COUNT} (?:heures?|hours?) (?:et|and) (?:a )?quart(?:er)?`), (m) => `${count(m[1])} h 15`],
  [words(`${COUNT} heures? moins (?:le )?quart`), (m) => `${count(m[1]) - 1} h 45`],
]
// Its unit half typed too, as with digits: 'vingt m' holds 20 min while 'minutes' is typed.
const ONE = words(`${COUNT} (${SEC}|${MIN}|${HOUR})`)
const AFTER = words(`(${SPOKEN_UNIT}) (?:(?:et|and) )?(${SPELLED})`)
// A spelled count alone after a timer word is minutes, as its digits are: 'set a timer for five'.
const LAST = words(`((?:minuteur|minuterie|timer)(?: (?:de|d'|for|of))? )(${SPELLED})$`)

// Spelled durations as digits: 'une demi-heure' is '30 min', 'ten minutes' '10 minutes'. `article` says a lone
// 'a', 'an', 'un' or 'une' gave one, as in 'une minute' or 'wait a minute': a phrase unless a timer is asked for.
function spell(line: string): { line: string; article: boolean } {
  let article = false
  let folded = fold(line)
  // No unit, no spelled duration: most lines stop here.
  if (!/sec|min|heure|hour|hr|demi|timer/.test(folded)) return { line, article }
  // Rewrites what `re` finds in the folded line, in the line as typed: fold keeps one character for one.
  const rewrite = (re: RegExp, write: (m: RegExpExecArray) => string) => {
    let out = ''
    let last = 0
    re.lastIndex = 0
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      out += line.slice(last, m.index) + write(m)
      last = m.index + m[0].length
    }
    if (!last) return
    line = out + line.slice(last)
    folded = fold(line)
  }
  for (const [re, write] of SPELL)
    rewrite(re, (m) => {
      // 'une demi-heure' and 'half an hour' are phrases, as 'une heure' is, whichever rewrite reads them.
      article ||= /^(?:une?|an?) |half an /.test(m[0])
      return write(m)
    })
  rewrite(ONE, (m) => {
    // 'un min' is 'un minuteur' half typed: French says 'une minute'.
    if (m[1] === 'un') return m[0]
    article ||= /^(?:an?|une)$/.test(m[1])
    return `${count(m[1])} ${m[2]}`
  })
  rewrite(AFTER, (m) => `${m[1]} ${count(m[2])}`)
  // 'une' or 'one' alone is mostly 'une heure' half typed.
  rewrite(LAST, (m) => (/^(?:une?|one)$/.test(m[2]) ? m[0] : `${m[1]}${count(m[2])}`))
  return { line, article }
}

// 'chrono' counts up, so it is a timer only with a unit: 'chrono 5 min', never 'chrono 5'.
const KEYWORDS = new Set(['minuteur', 'minuterie', 'timer', 'countdown', 'chrono', 'chronometre'])
// A keyword of 8 letters or more allows one typo ('minutuer'), never 'timer', or 'times 10' would be one.
const isKeyword = (w = '') => {
  const f = fold(w)
  return KEYWORDS.has(f) || (f.length >= 7 && (typos(f, 'minuteur', 1) <= 1 || typos(f, 'minuterie', 1) <= 1))
}
const KW = [...KEYWORDS].join('|')
// A keyword glued to its number or glue ('minuteur10', 'minuteurde 5'), and a '1' before it, the article as
// texted ('met 1 minuteur de 10'): the number stays the one left.
const GLUED = new RegExp(`(?<![\\p{L}\\d])(${KW})(?=\\d|de(?!\\p{L})|d')`, 'giu')
const ONE_TIMER = new RegExp(`(?<![\\p{L}\\d])1 (?=(?:${KW})(?!\\p{L}))`, 'giu')
// 'minuteur de5' is 'minuteur de 5': only the space comes back, the number stays as typed.
const GLUED_DE = new RegExp(`(?<=(?<![\\p{L}\\d])(?:${KW}) d(?:e|'))(?=\\d)`, 'giu')
// "d'une" without its apostrophe, as 'dheure' is d'heure, but only before a spelled duration: 'Dune' stays a film.
const DUNE = /(?<![\p{L}\d])dune(?= (?:demi[- ])?heure| minute)/giu
// Glue and determiners around the duration and the label, with their accents: 'thé' is no 'the'.
const EDGE = new Set(
  ['de', "d'", 'pour', 'pr', 'pendant', 'for', 'of', 'to', 'a', 'an', 'un', 'une', 'le', 'la', 'les', "l'"].concat(
    ['des', 'du', 'the', 'my', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes'],
  ),
)
// Determiners: one right before the number makes a noun phrase.
const PHRASE = new Set(['the', 'a', 'an', 'my', 'your', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'mon', 'ma', 'mes'])
// Units are never corrected, so a word near one after a bare number is doubt: one letter ('2 j' for jours), one
// typo ('sce', 'nm', 'minuets'), or two from 4 letters on with the unit's first letter ('hrue').
const UNITS = ['sec', 'secs', 'second', 'seconds', 'seconde', 'secondes', 'mn', 'min', 'mins', 'minute', 'minutes']
  .concat(['hr', 'hrs', 'hour', 'hours', 'heure', 'heures'])
const nearUnit = (w = '') => {
  const f = fold(w)
  return f.length === 1 || (!!f && UNITS.some((u) => typos(f, u, 2) <= (f.length >= 4 && f[0] === u[0] ? 2 : 1)))
}
// A label with a subject or a conjugated verb is a sentence, not a name: 'jai 10 min a perdre', 'il reste 10 min'.
const SENTENCE = new Set(
  ["j'", 'jai', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', "m'", 'moi', 'i', 'we'].concat(
    ['you', 'he', 'she', 'they', 'ai', 'as', 'est', 'suis', 'sont', 'reste', 'passe', 'pars', 'part', 'arrive'],
    ['attends', 'attendez', 'wait'],
    ['am', 'is', 'are', 'was', "i'm", 'im', "it's", "i've", "i'll", "we're", "you're", 'it', 'que', "qu'"],
  ),
)
// Politeness, fillers and qualifiers are no name: dropped when a keyword or a verb asks for a timer, a remark
// otherwise ('encore 5 min', '5 minutes late', 'genre 10 min').
const FILLER = new Set(
  ['stp', 'svp', 'pls', 'plz', 'please', 'merci', 'thanks', 'thx', 'ty', 'tysm', 'ok', 'okay', 'asap', 'now'].concat(
    ['rn', 'maintenant', 'from', 'like', 'about', 'around', 'environ', 'genre', 'encore', 'plus', 'more', 'late'],
    ['retard', 'last'],
  ),
)
// The verbs that start one: 'mets un minuteur de 10 s', 'set a timer for 5 minutes', 'lance 25m'.
// The 'moi' of 'mets-moi' and 'fais-moi' says who for, not what.
const SETS = ['mets', 'met', 'mettre', 'mettez', 'lance', 'lancer', 'lancez', 'demarre', 'demarrer', 'demarrez']
  .concat(['programme', 'programmer', 'regle', 'regler', 'fais', 'faire', 'set', 'start', 'make', 'put'])
const SET = new RegExp(`^(?:make it|${SETS.join('|')})(?: moi| me)? `)
// A word as near one of these as its length allows ('lacne', 'tiemr'), with its first letter in place.
const nearly = (w: string, list: string[]) => {
  const f = fold(w)
  return list.some((v) => v[0] === f[0] && typos(f, v, 1) <= allows(f))
}
// 'more' between a number and its unit says nothing of the length: 'set a timer for 10 more minutes'.
const MORE = /(?<=\d) more(?= \p{L})/iu
// 'i need a 10 min timer', 'gimme a 5 min timer': a timer with its keyword only, as 'give me 5 minutes' is a remark.
const WISH = /^(?:i need|gimme|give me) /
// A question, a ranking, a conversion, a stopwatch or a cycle: never a timer. 'best 10 min workouts' is a search.
const QUESTION =
  /\b(combien|comment|quel|quelle|quels|quelles|pourquoi|how|what|why|convert|convertir|best|top|worst|meilleure?s?|pires?)\b|\?/
const CONVERSION = /\b(en|in|to) [a-z]/
const NOT_A_TIMER = /\b(stopwatch|pomodoro)\b/
// A moment, a habit or the past, not a countdown: 'jarrive dans 5 min', 'remind me in 10 minutes', 'every 5
// minutes', '10 min par jour', '10 minutes ago', 'demain 9h', 'en 5 minutes', '2 heures du mat'.
const NOT_NOW = new RegExp(
  "\\b(?:dans|in|en(?= \\d)|du mat|ago|depuis|since|every|each|chaque|toutes|tous|" +
    '(?:par|per) (?:jour|day|semaine|week|mois|month)|a (?:day|week|month)|demain|soir|matin|midi|minuit|' +
    'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|rdv|' +
    "rendez-vous|aujourd'?hui|tomorrow|tonight|today|noon|midnight|monday|tuesday|wednesday|thursday|friday|" +
    'saturday|sunday)\\b',
)
// A time of day, checked before the accents go: 'à 18h30' is an alarm, 'a' alone is glue.
const TIME_OF_DAY =
  /(^|\s)(à|at|until|vers|avant|before|après|apres|after|dès|des|[aà] partir d(?:e |')|jusque|jusqu(?:'|'? ?[aà]))\s*\d/
const HOURS_12 = 12 * 3_600_000

const toMs = (n: string, unit: string) => {
  const per = UNIT.find(([re]) => re.test(unit))![1]
  return Number(n.replace(',', '.')) * per
}

/** A whole line read as a new timer: its length, and its label of at most 3 words. Anything else is no timer. */
export function parseTimer(line: string): { ms: number; label?: string } | undefined {
  const typed = line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[’‘ʼ]/g, "'")
    .replace(GLUED, '$1 ')
    .replace(GLUED_DE, ' ')
    .replace(ONE_TIMER, 'un ')
    .replace(DUNE, "d'une")
  const { line: raw, article } = spell(typed.replace(MORE, ''))
  // Every duration has a digit once spelled numbers are read.
  if (!/\d/.test(raw)) return
  const folded = fold(raw)
  const never = [QUESTION, CONVERSION, NOT_A_TIMER, NOT_NOW]
  if (never.some((re) => re.test(folded)) || TIME_OF_DAY.test(raw.toLowerCase())) return
  const read = strip(prep(raw))
  if (NEGATION.test(read.text)) return
  const verb = SET.exec(read.text)?.[0].length ?? 0
  const wish = verb ? 0 : (WISH.exec(read.text)?.[0].length ?? 0)
  const rest = read.raw.slice(verb || wish)
  const m = DURATION.exec(read.text.slice(verb || wish))
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
  // Fillers are no part of it, and make the line a remark unless a timer is asked for.
  const around = [split(rest.slice(0, m.index).replace(/(^|\s)d'$/i, '')), split(rest.slice(m.index + m[0].length))]
  const filler = MORE.test(typed) || around.flat().some((w) => FILLER.has(fold(w)))
  const [before, after] = around.map((list) => list.filter((w) => !FILLER.has(fold(w))))
  const alone = !before.length && !after.length
  // A determiner before the number makes a noun phrase ('the 10 minute rule'), and so does a singular unit before a
  // noun ('5 minute journal'), unless a keyword or a verb asks for a timer.
  const unit = fold(hu ?? mu ?? su ?? '')
  const phrase =
    PHRASE.has((before.at(-1) ?? '').toLowerCase()) ||
    (!!after.length && /^(?:minute|hour|second)$/.test(unit) && Number((h ?? mn ?? sn ?? '').replace(',', '.')) > 1)
  // Right after a bare number, a slipped unit is no name: '10 sce' would start 10 min.
  const slip = bare !== undefined && nearUnit(after[0])
  const trim = (list: string[]) => {
    while (list.length && EDGE.has(list[0].toLowerCase())) list.shift()
    while (list.length && EDGE.has(list.at(-1)!.toLowerCase())) list.pop()
  }
  trim(before)
  trim(after)
  // Anywhere in front ('minuteur 10', 'pasta timer 12 min'), or behind in English ('10 minute timer').
  // Right after a verb, 'timer' slipped is still that keyword: 'set a tiemr for 10 minutes'.
  const at = before.findIndex((w, i) => isKeyword(w) || (!!verb && !i && nearly(w, ['timer'])))
  const keyword = at >= 0 ? before.splice(at, 1)[0] : isKeyword(after[0]) ? after.shift() : undefined
  // The particle of 'put a timer on' is no name.
  if (at >= 0 && fold(before[at] ?? '') === 'on') before.splice(at, 1)
  // Before a keyword, a slipped verb is no name either: 'lacne un minuteur de 10'.
  if (at > 0 && !verb && nearly(before[0], SETS)) before.shift()
  trim(before)
  trim(after)
  const label = [...before, ...after]
  const odd = (w: string) => /\d/.test(w) || !/\p{L}/u.test(w) || isKeyword(w) || SENTENCE.has(fold(w))
  if (label.length > 3 || label.some(odd) || slip) return
  // A name before the clock's 'Nh' or 'NhMM' is a time of day, as 'reveil 7h' or 'cours 8h30': an alarm read as a
  // countdown costs the most. Bare, or asked for, it is a timer.
  const clock = !!label.length && fold(hu ?? '') === 'h' && /^\d+$/.test(h ?? '')
  if ((article || phrase || clock || filler) && !keyword && !verb) return
  if (wish && !keyword) return
  // A bare number with any word is a name ('gpt 4', 'windows 11', '10 mon') unless a keyword says it is a timer.
  if (bare !== undefined && ((!alone && !keyword) || fold(keyword ?? '').startsWith('chrono'))) return
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
  // A timer that ended can be stopped, not paused.
  const running = (t: Timer) => t.left === undefined && t.endsAt > now
  const pool = timers.filter((t) => (kind === 'pause' ? running(t) : kind === 'resume' ? t.left !== undefined : true))
  const timer = soonest(pool, name)
  if (!timer) return
  const [verbWord, alone] = words[kind]
  return { kind, id: timer.id, label: timer.label ? `${verbWord} ${timer.label}` : alone }
}

// --- Apps ---

/**
 * How names compare: folded, punctuation dropped as the line drops it ('Battle.net' is 'battle net'), without
 * apostrophes or hyphens, each word without a plural s, or the x of -aux, -eux and -oux, unless kept. 'Plex' keeps
 * its x, so 'ple' on its way to 'please' is no Plex.
 */
export function key(name: string, plural = false): string {
  return fold(name)
    .replace(PUNCT, ' ')
    .replace(/['’]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && !plural ? w.replace(/s$|(?<=[aeo]u)x$/, '') : w))
    .join(' ')
}

// Hand-written aliases, French and English alike: any word of a group finds the app named by another.
const ALIASES = [
  ['parametres', 'settings', 'reglages', 'preferences', 'options'],
  ['explorateur de fichiers', 'file explorer', 'explorateur', 'explorer', 'fichiers', 'mes fichiers', 'files'],
  ['calculatrice', 'calculator', 'calc'],
  ['visual studio code', 'code', 'vscode', 'vs code'],
  ['invite de commandes', 'command prompt', 'cmd'],
  ['calendrier', 'calendar'],
  ['gestionnaire des taches', 'task manager', 'taskmgr'],
  ['panneau de configuration', 'control panel'],
  ['bloc-notes', 'notepad'],
  ['horloge', 'clock'],
  // Short forms as people text them, exact only.
  ['whatsapp', 'wtsp'],
  ['powerpoint', 'ppt'],
  ['microsoft edge', 'msedge'],
  // Its plural on its own, as people say it: 'ouvre mes mails'. 'codes' stays no Visual Studio Code.
  ['mail', 'mails'],
]
const GROUPS = new Map(ALIASES.flatMap((group) => group.map((a) => [key(a), group] as const)))
// Glue in a name: no shortening takes its letters, and no typo reaches the word after it, as 'porte' would 'La Poste'.
const GLUE = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'of', 'the', 'a', 'an', 'et', 'and'])
// The system's name, in many of its apps' names ('Sécurité Windows', 'Windows Terminal'): it names none of them alone.
const SHARED = new Set(['windows'])

// Three rows of the table below, kept between calls so a keystroke allocates nothing.
let rows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)]

// The letters a word holds, one bit each (folded together past 32): each one that only one side has costs a typo.
const letters = (w: string) => {
  let bits = 0
  for (let i = 0; i < w.length; i++) bits |= 1 << (w.charCodeAt(i) & 31)
  return bits
}
const ones = (bits: number) => {
  let n = 0
  for (; bits; bits &= bits - 1) n++
  return n
}

// Optimal string alignment: a wrong, missing or extra letter, or two swapped neighbors, is one typo. Past `max`, it
// stops early and says max + 1.
function typos(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (rows[0].length <= b.length) rows = rows.map(() => new Int32Array(b.length + 1))
  let [before, last, row] = rows
  for (let j = 0; j <= b.length; j++) last[j] = j
  for (let i = 1; i <= a.length; i++) {
    row[0] = i
    let low = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1)
      row[j] = d
      if (d < low) low = d
    }
    if (low > max) return max + 1
    const spare = before
    before = last
    last = row
    row = spare
  }
  return last[b.length]
}

// Letters in order, the way people shorten a name: from the start of a word, then dropping only vowels ('ntpd')
// or jumping to the next word ('vsc'), never over a whole one. So 'porte' never finds 'exPlORaTEur', 'timer' 'TIME
// doctoR', nor 'ame' 'AMd software adrenalin Edition'.
function shortens(query: string, name: string): boolean {
  let i = 0
  let consonant = true // skipped since the last letter kept: the first one starts a word
  let kept = false // a letter kept in this word
  for (let j = 0; j < name.length; j++) {
    const c = name[j]
    if (c === ' ') {
      if (i && !kept) return false
      kept = false
    }
    if (c === query[i] && (j === 0 || name[j - 1] === ' ' || !consonant)) {
      if (++i === query.length) return true
      consonant = false
      kept = true
    } else if (!'aeiouy '.includes(c)) consonant = true
  }
  return false
}

// The typos a word allows, by its own length, plural kept: none up to 4 letters, one from 5, two from 9.
const allows = (w: string) => (w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0)

interface Entry<A> {
  app: A
  // The name's key, then its aliases', plural kept, and the same with a space in front, for the start of a word.
  keys: string[]
  spaced: string[]
  // The keys without their glue, for shortenings: 'défi' is no 'DE FIchiers'.
  short: string[]
  // The words of its name in capitals, what the app is called: 'obs' for OBS Studio.
  called: string[]
}

interface Index<A> {
  entries: Entry<A>[]
  // Each key and each of its words from 5 letters, but the ones after glue, with its letters, by length: a typo is
  // at most 2 away.
  byLength: Map<number, [Entry<A>, string, number][]>
  // By the first letter of each word, where a prefix, a word start or a shortening starts.
  byInitial: Map<string, Entry<A>[]>
  // By the first and second letters of each key, where a typo of its start keeps one.
  byStart: Map<string, Entry<A>[]>
  // Exact keys, plurals folded: aliases first, then names, so an alias wins as the research ranks it.
  exact: Map<string, A>
  // The same keys, plural kept.
  plural: Set<string>
  // The hyphenated words of names, kept whole when the line is read.
  frozen: Set<string>
}

// Built once per list, so a keystroke only compares.
const INDEXES = new WeakMap<readonly App[], Index<App>>()

function indexOf<A extends App>(apps: readonly A[]): Index<A> {
  const known = INDEXES.get(apps) as Index<A> | undefined
  if (known) return known
  const index: Index<A> = {
    entries: [],
    byLength: new Map(),
    byInitial: new Map(),
    byStart: new Map(),
    exact: new Map(),
    plural: new Set(),
    frozen: new Set(),
  }
  const add = <K, V>(map: Map<K, V[]>, k: K, v: V) => {
    const list = map.get(k) ?? []
    if (list.at(-1) !== v) list.push(v)
    map.set(k, list)
  }
  const names = new Map<string, A>()
  for (const app of apps) {
    const folded = fold(app.name)
    const name = key(app.name)
    // Uninstallers never open from the bar, and a name seen twice is the first one.
    if (/\b(uninstall|desinstall)/.test(folded) || names.has(name)) continue
    names.set(name, app)
    const group = GROUPS.get(name)?.filter((a) => key(a, true) !== key(app.name, true)) ?? []
    for (const a of group) if (!index.exact.has(key(a))) index.exact.set(key(a), app)
    const keys = [app.name, ...group].map((a) => key(a, true))
    for (const k of keys) index.plural.add(k)
    const words = keys.map((k) => k.split(' '))
    const short = words.map((list) => list.filter((w) => !GLUE.has(w)).join(' '))
    const called = app.name.split(/\s+/).filter((w) => /^[A-Z\d]{2,}$/.test(w)).map((w) => w.toLowerCase())
    const entry = { app, keys, spaced: keys.map((k) => ' ' + k), short, called }
    index.entries.push(entry)
    const typo = new Set(words.flatMap((list, n) => [keys[n], ...list.filter((_, i) => !GLUE.has(list[i - 1]))]))
    // A plural kept beside its word allows that word's typos: 'mails' none, as 'mail', so 'emails' is no Mail.
    for (const w of typo)
      if (allows(w) && !typo.has(w.slice(0, -1))) add(index.byLength, w.length, [entry, w, letters(w)])
    for (const c of new Set(words.flatMap((list) => list.map((w) => w[0])))) add(index.byInitial, c, entry)
    for (const c of new Set(keys.flatMap((k) => [k[0], k[1]]))) add(index.byStart, c, entry)
    for (const w of folded.split(/\s+/)) if (w.includes('-')) index.frozen.add(w)
  }
  for (const [name, app] of names) if (!index.exact.has(name)) index.exact.set(name, app)
  INDEXES.set(apps, index)
  return index
}

// An exact name or alias. Its plural folds onto a whole name one way only: 'parametre' is Paramètres, but 'codes' is
// no Visual Studio Code, and 'note' is not Notes while it may still become Notepad.
function exactly<A extends App>(index: Index<A>, text: string): A | undefined {
  const typed = key(text, true)
  const app = index.exact.get(key(text))
  if (!app || index.plural.has(typed)) return app
  if (typed !== key(text)) return
  const goesOn = (k: string) => k.startsWith(typed) && k !== typed + 's' && k !== typed + 'x'
  return (index.byInitial.get(typed[0]) ?? []).some((e) => e.keys.some(goesOn)) ? undefined : app
}

/**
 * The tiers before typos, shared by findApp and a word alone: none for a missing app's alias, one letter, the
 * system's name or a common noun, then a prefix, then the start of a word, the shorter name first. What an app is
 * called in capitals wins ('obs' is OBS Studio, not Obsidian), then the shorter name when the others carry it ('ste'
 * is Steam, not Steam VR). Any other tie is no app, and its apps go into `tied` for Tab: at most 3, the shorter name
 * first, then alphabetical. The app, null for no app, or undefined when no name starts a word with the query.
 */
function starts<A extends App>(index: Index<A>, q: string, tied?: A[]): A | null | undefined {
  // No Calculator never opens Calendar.
  if (GROUPS.has(key(q))) return null
  // One letter is too little to act on, and the system's name is a word many of its apps share.
  if (q.length < 2 || SHARED.has(q)) return null
  // A word one plural letter short of a word in a name is a common noun, not that name: 'window' is no Windows
  // Terminal, 'game' no Epic Games Launcher, and no other app either. Plurals fold only onto a whole name, above.
  // A single word only: in 'epic game', 'epic' already names the app.
  const initial = index.byInitial.get(q[0]) ?? []
  const plurals = q.length > 2 && !q.includes(' ') ? [' ' + q + 's', ' ' + q + 'x'] : []
  if (initial.some((e) => e.spaced.some((w) => plurals.some((p) => w.endsWith(p) || w.includes(p + ' '))))) return null
  // It wins only when every name that starts a word with the query carries it: 'st' is neither Steam nor Microsoft
  // Store, so a half-typed name never opens its neighbor.
  const spaced = ' ' + q
  const hits = initial.filter((e) => e.spaced.some((w) => w.includes(spaced)))
  if (!hits.length) return
  const called = hits.filter((e) => e.called.includes(q))
  const pool = called.length ? called : hits
  const prefix = pool.filter((e) => e.keys.some((k) => k.startsWith(q)))
  const best = (prefix.length ? prefix : pool).reduce((a, b) => (b.app.name.length < a.app.name.length ? b : a))
  // Each way the others match goes through the best one's name: 'bloc notes' carries Notes, 'notepad' does not.
  const through = (w: string) => !w.includes(spaced) || best.keys.some((k) => w.includes(' ' + k))
  if (pool.every((e) => e === best || e.spaced.every(through))) return best.app
  const names = pool.map((e) => e.app).toSorted((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1))
  tied?.push(...names.slice(0, 3))
  return null
}

/**
 * The app a query names, by fixed tiers: an exact alias or name, a prefix, the start of a word, a typo, then a
 * shortening. A tie finds nothing, as does a known name whose app is missing; a tie of prefixes fills `tied`. Usage
 * never reorders it.
 */
export function findApp<A extends App>(query: string, apps: readonly A[], tied?: A[]): A | undefined {
  const index = indexOf(apps)
  const q = key(query, true)
  if (!q) return
  const named = exactly(index, query)
  if (named) return named
  const start = starts(index, q, tied)
  if (start !== undefined) return start ?? undefined
  // Typos and shortenings are for words: '10' is no typo of '11'.
  if (/\d/.test(q)) return
  const { byLength, byInitial, byStart } = index
  // Each word allows the typos its own length does, so 'timer' never finds 'Time' and 'teans' finds 'Teams'.
  // Against the name, its start, or a word.
  const near = new Map<Entry<A>, number>()
  const has = letters(q)
  const check = (e: Entry<A>, w: string, bits = letters(w)) => {
    // A typo keeps the first letter, or swaps it with the second: 'fridge' is no Bridge.
    if (w[0] !== q[0] && (w[0] !== q[1] || w[1] !== q[0])) return
    const max = allows(w)
    // Most names lack too many of the letters to be worth the table.
    let t = max && ones(has & ~bits) <= max && ones(bits & ~has) <= max ? typos(q, w, max) : Infinity
    // A slip counts against the word that holds it: 'ls poste' is no La Poste, as 'ls' allows none.
    if (t && t <= max && q.includes(' ')) {
      const [qs, ws] = [q.split(' '), w.split(' ')]
      if (qs.length === ws.length && qs.some((x, i) => typos(x, ws[i], allows(ws[i])) > allows(ws[i]))) t = Infinity
    }
    if (t <= max && t < (near.get(e) ?? Infinity)) near.set(e, t)
  }
  for (let n = q.length - 2; n <= q.length + 2; n++) for (const [e, w, bits] of byLength.get(n) ?? []) check(e, w, bits)
  // A name's start, when one of its first two letters is in place: a typo moves at most one.
  const [a, b] = q
  for (const e of new Set([...(byStart.get(a) ?? []), ...(byStart.get(b) ?? [])]))
    for (const k of e.keys)
      if (k.length > q.length && (k[0] === a || k[0] === b || k[1] === a || k[1] === b)) check(e, k.slice(0, q.length).trim())
  if (near.size) {
    const best = Math.min(...near.values())
    const found = [...near].filter(([, d]) => d === best)
    return found.length === 1 ? found[0][0].app : undefined
  }
  if (q.length < 3) return
  const short = (byInitial.get(q[0]) ?? []).filter((e) => e.short.some((k) => shortens(q, k)))
  return short.length === 1 ? short[0].app : undefined
}

// --- The time and the date ---

// "c'est" as said and as texted: "c' est", 'cest', 'c'. 'koi', 'kel' and 'lheure' too, as the answer only shows.
const CEST = "(?:c' est|cest|c)"
const QUOI = '(?:quoi|koi)'
const HEURE = "(?:l'? |l)?heure"
const ASKED = half(['est-il', 'est il', 'est t il', "est t' il", 'il est', "c' est", 'est-ce', 'est ce'])
const DAY = half(['sommes-nous', 'sommes nous', 'nous sommes', 'on est', 'est-on', 'est on', 'est-il', 'est il', "c' est"])
// Whole lines only, so 'quelle heure est-il à Tokyo' and 'time management tips' stay questions. Read with elisions
// split: "c' est", "l' heure". A trailing 'now' or 'là' adds nothing.
const TIME = new RegExp(
  `^(?:(?:il est |${CEST} )?(?:quel|kel)(?:le)? heure(?: (?:${ASKED}))?|` +
    `${CEST} ${QUOI} ${HEURE}|(?:(?:affiche|montre|donne|dis)(?: moi)? )?${HEURE}|` +
    `(?:t' as|tas|ta|tu as|vous avez|vs avez) ${HEURE}|` +
    "(?:what|wat|wut) time(?: is it| it is|'s it)|what(?:'s| is) the time|whats the time|" +
    '(?:(?:show|tell)(?: me)? )?(?:the |current )?time)(?: (?:now|right now|rn|maintenant|la))?$',
)
const DATE = new RegExp(
  `^(?:(?:on est |${CEST} )?quel jour(?: (?:${DAY}|est[- ]ce))?|` +
    `(?:on est|nous sommes) le combien|` +
    `(?:on est |${CEST} )?quelle (?:est la )?date(?: (?:sommes nous|on est|est[- ]on))?|` +
    `${CEST} ${QUOI} la date|(?:(?:affiche|montre|donne|dis)(?: moi)? )?(?:la )?date|` +
    "what day is it|what day is today|what(?:'s| is) the day|whats the day|what date is it|" +
    "what(?:'s| is) (?:the|today's) date|whats (?:the|todays) date|" +
    "(?:(?:show|tell)(?: me)? )?(?:the |today's |todays )?date)" +
    `(?: (?:${half(["d' aujourd'hui", "d' aujourdhui", "aujourd'hui", 'aujourdhui', 'ajd', 'today'])}))?$`,
)

// --- The battery ---

// Whole lines only, as for the time: 'batterie faible que faire' stays a question.
const BATTERY = /^(?:batterie|battery|battery level|autonomie|niveau de batterie)$/

// --- The clipboard history ---

// Whole lines only, as for the battery: 'presse-papiers', 'historique', 'clipboard history'. People type 'copies'
// too.
const CLIPBOARD =
  /^(?:presse|presse[- ]papiers?|historique(?: du presse[- ]papiers?)?|copies|clipboard(?: history)?)$/

// --- The screen capture ---

// Whole lines only, as for the battery: « capture », « pipette », 'color picker'. A screenshot is something else:
// 'capture d'écran' stays a question.
const CAPTURE = /^(?:capture|capturer|pipette|eyedropper|colou?r picker)$/

// --- The weather ---

// Whole lines only, as for the battery: 'météo', 'météo à Lyon', 'weather in Paris tomorrow', 'météo demain'. A city
// is letters only, at most 4 words, so 'weather in 10 minutes' stays a question. 'temps' is no weather word.
const DAYS = "demain|tomorrow|aujourd'hui|aujourdhui|today|maintenant|now"
const WEATHER = new RegExp(
  `^(?:meteo|weather)(?: (${DAYS}))?(?: (?:a|au|in|at|for|pour|de|sur))?(?: ([\\p{L}' .-]+?))??` +
    `(?: (?:pour |for )?(${DAYS}))?$`,
  'du',
)
// Words that make the line a question about the weather rather than a city's: 'weather forecast for next week',
// 'météo de la semaine', 'weather like in Rome'.
const NOT_CITY = new RegExp(
  '(?:^| )(?:forecast|previsions?|like|semaine|week|week-end|weekend|next|prochaine?s?|ce|cette|this|soir|' +
    'tonight|matin|morning|hier|yesterday|radar|app|appli|application)(?= |$)',
)

// --- The bar's own words, on their way ---

// The words that answer alone, folded, by what they ask. A timer needs a length, so 'minuteur' and 'timer' aren't here.
type Own = 'battery' | 'time' | 'date' | 'weather' | 'clipboard' | 'capture'
const OWN: [string, Own][] = [
  ['batterie', 'battery'],
  ['battery', 'battery'],
  ['autonomie', 'battery'],
  ['heure', 'time'],
  ['time', 'time'],
  ['date', 'date'],
  ['meteo', 'weather'],
  ['weather', 'weather'],
  ['presse-papiers', 'clipboard'],
  ['historique', 'clipboard'],
  ['copies', 'clipboard'],
  ['clipboard', 'clipboard'],
  ['capture', 'capture'],
  ['capturer', 'capture'],
  ['pipette', 'capture'],
  ['eyedropper', 'capture'],
]

/**
 * What a word alone on the line, 3 letters or more, asks for when it starts one of the bar's own words, and only
 * words of one kind: 'bat' and 'batte' are the battery, 'heu' the time, 'mét' and 'weat' the weather, 'pres' and
 * 'histo' the clipboard history, 'cap' and 'pip' the screen capture. Never inside a longer line, so 'batman' and 'time management' stay questions. `raw`
 * is the word as typed: the weather takes 4 letters, or 'mét' with its accent, as 'met' is French for « puts » ('met
 * un minuteur').
 */
export function own(text: string, raw = text): Own | undefined {
  if (text.length < 3 || text.includes(' ')) return
  const short = text.length < 4 && !/é/i.test(raw)
  const asks = new Set(
    OWN.filter(([word, what]) => word.startsWith(text) && !(short && what === 'weather')).map(([, what]) => what),
  )
  return asks.size === 1 ? [...asks][0] : undefined
}

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

// The verbs, as lemmas: each inflection a person types leads to one intent. A name compared or asked about is no
// address: 'chatgpt vs claude' and 'google est-il un monopole' go whole to the default target.
const BY_NAME = new RegExp(
  '^(?:(?:demande|demander|demandez|pose|poser|ask|tell)(?: (?:la|une|ma|the|a|my) question)?(?: (?:a|to))? )?' +
    '(claude|chatgpt|gpt|gemini|perplexity|google) (?!(?:vs|versus|contre|ou|or|est-il|is)(?: |$))(.+)$',
)
// The verdict's search words only: 'trouve' and 'find' mostly ask for help.
const SEARCH = /^(?:cherche|chercher|recherche|rechercher|search|look up)(?: moi)? (.+)$/
// Dropped after a verb: 'ouvre les paramètres', 'open the calculator', "lance l'explorateur".
// A lone 'l' or 'd' is the elision typed with a space: 'ouvre l appli discord'.
const DETS = "le|la|les|un|une|des|du|de la|mon|ma|mes|ton|ta|tes|the|a|an|my|l'|d'|l|d"
// After one of these the noun is a thing, not an app: 'lance un défi', 'start a fire'.
const INDEFINITE = new Set(['un', 'une', 'a', 'an'])
const PLURAL = new Set(['les', 'des', 'mes', 'tes'])
const PRONOUNS = new Set(['ca', 'cela', 'ceci', 'it', 'that', 'this', 'one'])
// The word for an app is no part of its name: "lance l'appli discord", 'open the spotify app'. Nor is the 'moi' of
// 'ouvre-moi discord'.
const NOUNS = 'app|appli|application|logiciel|programme'
// "l'appli" without its apostrophe too: 'lance lappli spotify'.
const LNOUNS = 'lapp|lappli|lapplication'
const NOUN = `(?:(?:${NOUNS}|${LNOUNS}) )?`
// Words still being typed name no app yet: 'ouvre me' may become 'ouvre mes réglages', 'lance le pr' 'lance le
// programme', and after a timer's verb, 'start a ti' 'start a timer'.
const TYPING = [...DETS.split('|'), ...NOUNS.split('|'), ...LNOUNS.split('|')]
const TIMING = [...KEYWORDS]
const OPEN = ['ouvre', 'ouvres', 'ouvrez', 'ouvrir', 'lance', 'lances', 'lancer', 'lancez', 'demarre', 'demarrer']
  .concat(['demarrez', 'open', 'launch', 'start'])
// A word alone opens the app it starts, never while it may still become one of the bar's own words or a question:
// 'what' is on its way to 'what time is it', 'regl' to 'règle un minuteur', 'clau' to 'claude …'. Folded. The
// stays-put test fails on a word of the bar left out.
const BARE = [...OPEN, ...SETS, ...KEYWORDS, ...ORDER, 'gpt', 'google', 'affiche', 'afficher', 'montre', 'montrer']
  .concat(['show', 'run', 'fire', 'boot', 'demande', 'demander', 'demandez', 'pose', 'poser', 'ask', 'tell'])
  .concat(['cherche', 'chercher', 'recherche', 'rechercher', 'search', 'look', 'pause', 'reprendre', 'resume', 'stop'])
  .concat(['annule', 'annuler', 'cancel', 'heure', 'heures', 'hour', 'hours', 'time', 'date', 'jour', 'today'])
  .concat(['aujourdhui', 'maintenant', 'quel', 'quelle', 'quels', 'quelles', 'quoi', 'comment', 'pourquoi', 'combien'])
  .concat(['quand', 'explique', 'expliquer', 'traduis', 'traduire', 'resumer', 'ecris', 'ecrire', 'aide', 'aider'])
  .concat(['donne', 'donner', 'peux', 'pourrais', 'what', 'whats', 'which', 'where', 'when', 'explain', 'translate'])
  .concat(['summarize', 'summarise', 'write', 'help', 'give', 'could', 'would', 'should', 'please'])
  .concat(['batterie', 'battery', 'autonomie', 'niveau', 'meteo', 'weather'])
  .concat(['presse', 'presse-papiers', 'historique', 'copies', 'clipboard', 'capture', 'capturer', 'pipette'])
  .concat(['eyedropper'])
// The first group opens what it names, or says no app aloud. 'montre', 'show' or 'run' takes an exact name: without
// one it is just a question, so 'show the ti' is no Time Doctor. "m'ouvrir" and 'mouvrir' are 'open for me', and
// 'open up', 'fire up' and 'boot up' a verb with its particle. 'show me' is 'montre-moi'. A trailing 'now' or 'ok'
// adds nothing, and leaves an exact name only.
const VERB = new RegExp(
  `^(?:m' |me |m)?(?:(${OPEN.join('|')}|(?:fire|boot)(?= up))(?: up)?|affiche|afficher|montre|montrer|show|run) ` +
    `(?:moi |me )?(?:(${DETS}) )?${NOUN}(.+?)(?: (?:app|appli|application))?` +
    `( (?:${NOW.join('|')}))?$`,
  'd',
)
// Words that say the name is the system's own, after an exact name only: 'paramètres de discord' stays a question.
const SYSTEM = /^(.+?) (?:du pc|de l' ?ordinateur|de mon pc|du systeme|de windows|windows)$/

// A slip on the verb ('lnace', 'ouvrz', 'opne') or no space after it ('ouvrediscord') opens only an exact name or
// alias, never a guess on both sides; glued, a whole word of one name too ('ouvrechrome'), never a part of one, so
// 'startup' and 'openai' open nothing. The verb keeps its first two letters or swaps them with the third: 'lunch',
// 'smart' and 'dance' are words of their own. Of the short verbs only 'open', the most typed, takes a slip. The 'moi'
// of 'ouvremoi discord' is no part of the name, as after 'ouvre-moi'.
function slipped<A extends App>(text: string, index: Index<A>): A | undefined {
  const space = text.indexOf(' ')
  const first = space < 0 ? text : text.slice(0, space)
  const found: (A | undefined)[] = []
  for (const v of OPEN) {
    if (first.length > v.length && first.startsWith(v)) {
      const rest = text.slice(v.length).replace(/^(?:moi|me) /, '')
      found.push(exactly(index, rest) ?? wordOf(index, rest))
    }
    const start = first[1] === v[1] || (first[1] === v[2] && first[2] === v[1])
    if (space < 0 || (v.length < 5 && v !== 'open') || first[0] !== v[0] || !start || typos(first, v, 1) > 1) continue
    const verb = VERB.exec(v + text.slice(space))
    if (verb && !thing(verb, index)) found.push(exactly(index, verb[3]) ?? wordOf(index, verb[3]))
  }
  const apps = new Set(found.filter((a) => a !== undefined))
  return apps.size === 1 ? [...apps][0] : undefined
}

// After a verb, a thing rather than an app: 'lance un défi', a pronoun ('ouvre ça', 'open one'), a particular
// one ('ouvre le fichier', 'the code') or the idiom 'start the clock'. 'ouvre mes photos' and 'ouvre code' stay apps.
function thing<A extends App>(verb: RegExpExecArray, index: Index<A>): boolean {
  const [, open, det, name] = verb
  if (INDEFINITE.has(det) || PRONOUNS.has(name) || (open === 'start' && name === 'clock')) return true
  if (!det || PLURAL.has(det)) return false
  // A determiner before 'code' names some code; a singular one before a word whose app is its plural, one file.
  const typed = key(name, true)
  return typed === 'code' || (!name.includes(' ') && !index.plural.has(typed) && index.plural.has(typed + 's'))
}

// The one app with this whole word in its name, glue and the system's name aside.
function wordOf<A extends App>(index: Index<A>, text: string): A | undefined {
  const w = key(text, true)
  if (w.length < 2 || w.includes(' ') || GLUE.has(w) || SHARED.has(w)) return
  const hits = (index.byInitial.get(w[0]) ?? []).filter((e) => e.spaced.some((k) => `${k} `.includes(` ${w} `)))
  return hits.length === 1 ? hits[0].app : undefined
}

// The one app called this in capitals: 'obs' for OBS Studio.
function capitals<A extends App>(index: Index<A>, w: string): A | undefined {
  const hits = (index.byInitial.get(w[0]) ?? []).filter((e) => e.called.includes(w))
  return hits.length === 1 ? hits[0].app : undefined
}

/**
 * What Enter can do with a line, the top guess first, then what Tab reaches: the apps that tied, the default
 * assistant, the others in the user's order, then the search engine. An empty line does nothing.
 */
export function choices<A extends App>(line: string, options: Options<A>): Choice<A>[] {
  const { lang, claudeApp, timers = [], now = Date.now(), locale, order = ORDER } = options
  const typed = line.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const index = indexOf(options.apps)
  const whole = prep(typed, index.frozen)
  const read = strip(whole)
  const text = read.text
  // The end of the line a rule matched, as typed, for a question.
  const rest = (match: string) => typed.slice(read.at[text.length - match.length])
  const open = (app: A): Choice<A> => ({ kind: 'app', app, label: `${WORDS[lang].open} ${app.name}` })
  const tied: A[] = []

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
    const named = exactly(index, whole.text)
    // The weather comes first: Windows' own weather app is called « Météo » or "Weather". Tab still reaches it.
    const sky = (city?: string, day: 0 | 1 = 0): Choice<A> => ({
      kind: 'weather',
      city,
      day,
      label: chip(city ?? options.city, day, lang),
    })
    const weather = WEATHER.exec(text)
    const place = weather?.[2] ?? ''
    if (weather && !NOT_CITY.test(place) && place.split(' ').length <= 4) {
      const [from, to] = weather.indices![2] ?? [0, 0]
      const city = place ? typed.slice(read.at[from], read.at[to - 1] + 1) : undefined
      const day = /^(?:demain|tomorrow)$/.test(weather[1] ?? weather[3] ?? '') ? 1 : 0
      if (named) tied.push(named)
      return [sky(city, day), typed]
    }
    if (named) return [open(named), typed]
    if (NEGATION.test(text)) return [ask(order[0], typed, claudeApp, lang), typed]
    // A tail still being typed holds what the line says without it: 'quelle heure st' and 'ouvre discord st' on
    // their way to 'stp'. A bare name keeps its politeness, so 'discord st' holds nothing.
    const tail = TAIL.exec(text)
    const cut = tail ? text.slice(0, tail.index) : ''
    const time = (): Choice<A> => ({ kind: 'clock', what: 'time', label: WORDS[lang].time(formatTime(new Date(now), locale)) })
    const date = (): Choice<A> => {
      const day = formatLongDate(new Date(now), locale)
      return { kind: 'clock', what: 'date', label: day[0].toUpperCase() + day.slice(1) }
    }
    const battery = (): Choice<A> => ({ kind: 'battery', label: answer(options.battery, lang) })
    const clipboard = (): Choice<A> => ({ kind: 'clipboard', label: WORDS[lang].clipboard })
    const capture = (): Choice<A> => ({ kind: 'capture', label: WORDS[lang].capture })
    if (TIME.test(text) || TIME.test(cut)) return [time(), typed]
    if (DATE.test(text) || DATE.test(cut)) return [date(), typed]
    if (BATTERY.test(text) || BATTERY.test(cut)) return [battery(), typed]
    if (CLIPBOARD.test(text) || CLIPBOARD.test(cut)) return [clipboard(), typed]
    if (CAPTURE.test(text) || CAPTURE.test(cut)) return [capture(), typed]
    // One of the bar's own words on its way comes first; an app the word also starts is one Tab away.
    const asked = own(text, read.raw)
    if (asked) {
      const app = starts(index, key(whole.text, true), tied)
      if (app) tied.unshift(app)
      const answers = { battery, time, date, clipboard, capture, weather: () => sky() }
      return [answers[asked](), typed]
    }
    const by = BY_NAME.exec(text)
    if (by) {
      const to: Target = by[1] === 'google' ? 'search' : by[1] === 'gpt' ? 'chatgpt' : (by[1] as Assistant)
      return [ask(to, rest(by[2]), claudeApp, lang), rest(by[2])]
    }
    const search = SEARCH.exec(text)
    if (search) return [ask('search', rest(search[1]), claudeApp, lang), rest(search[1])]
    const typing = (v: RegExpExecArray, words: string[]) => words.some((w) => w.startsWith(v[3]))
    const armed = (v: RegExpExecArray | null) =>
      v && !thing(v, index) && !typing(v, TYPING) && !(SET.test(text) && typing(v, TIMING)) ? v : undefined
    const found = VERB.exec(text)
    const verb = armed(found)
    if (verb) {
      const system = SYSTEM.exec(verb[3])
      const fuzzy = verb[1] && !verb[4]
      // After a determiner, 3 letters are a word on its way unless an app is called that: 'open the cal' and 'start
      // the car' open nothing, 'launch the obs app' opens OBS Studio.
      const brief = verb[2] && verb[3].length < 4
      // The whole line first, so 'open control p' may still become Control Panel. Before a tail, an exact name only,
      // as 'maintenant' typed whole asks for one: the chip never shows an app the finished line won't open.
      const held = tail && !verb[4] ? armed(VERB.exec(cut)) : undefined
      const app =
        (system && exactly(index, system[1])) ||
        (fuzzy && !brief ? findApp(verb[3], options.apps, tied) : exactly(index, verb[3])) ||
        (fuzzy && brief && capitals(index, verb[3])) ||
        (held && exactly(index, held[3]))
      if (app) return [open(app), typed]
      // Named as typed. 'lance un minuteur' is no missing app, just a question.
      const [from, to] = verb.indices![3]!
      const none = WORDS[lang].none(typed.slice(read.at[from], read.at[to - 1] + 1))
      if (verb[1] && !KEYWORDS.has(verb[3].split(' ')[0])) return [ask(order[0], typed, claudeApp, lang, none), typed]
    }
    const slip = found ? undefined : slipped(text, index)
    if (slip) return [open(slip), typed]
    // Last, a word alone of 4 letters or more that starts one app's name, read as typed, as an exact name is.
    const word = key(whole.text, true)
    const start = word.length > 3 && !whole.text.includes(' ') && !BARE.some((w) => w.startsWith(word))
    const alone = start && starts(index, word, tied)
    if (alone) return [open(alone), typed]
    return [ask(order[0], typed, claudeApp, lang), typed]
  })()

  const offers = top.kind === 'app' ? [] : tied.map(open)
  const all = [top, ...offers, ...[...order, 'search' as const].map((to) => ask<A>(to, question, claudeApp, lang))]
  const seen = new Set<string>()
  return all.filter((c) => {
    const id = c.kind === 'ask' ? c.to : `${c.kind}:${c.label}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
