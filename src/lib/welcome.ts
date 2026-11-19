import type { Lang } from './intent'

/** What the welcome says, on the island and to a screen reader. */
export const WORDS = {
  fr: {
    hello: 'Bonjour',
    bar: 'Barre de commande',
    shift: 'Maj',
    welcome: 'Bienvenue dans Sumi.',
    open: 'Ouvrez la barre de commande avec',
  },
  en: {
    hello: 'Hello',
    bar: 'Command bar',
    shift: 'Shift',
    welcome: 'Welcome to Sumi.',
    open: 'Open the command bar with',
  },
} satisfies Record<Lang, Record<string, string>>

/** The keycaps for the shortcut Rust registered, as `Win+Alt+S`, in the reader's language. None without a shortcut. */
export function keysOf(shortcut: string | undefined, lang: Lang): string[] | undefined {
  return shortcut?.split('+').map((key) => (key === 'Shift' ? WORDS[lang].shift : key))
}

/** The sentence a screen reader hears once: the welcome, and the shortcut spelled out. */
export function announce(shortcut: string | undefined, lang: Lang): string {
  const keys = keysOf(shortcut, lang)?.map((key) => (key === 'Win' ? 'Windows' : key))
  return keys ? `${WORDS[lang].welcome} ${WORDS[lang].open} ${keys.join(' + ')}.` : WORDS[lang].welcome
}
