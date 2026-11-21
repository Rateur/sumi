import { describe, expect, it } from 'vitest'
import {
  actionsOf,
  codeOf,
  colourOf,
  count,
  folderOf,
  formOf,
  formatted,
  kindOf,
  linkParts,
  matching,
  middle,
  preview,
  quiet,
  rows,
  searchKey,
  shown,
  untracked,
  type Kind,
} from './clipboard'
import { fold } from './intent'

describe('preview', () => {
  it('puts the text on one line, from its first letter', () => {
    expect(preview('\n\n  Réunion jeudi\n  14 h,\tsalle Lumière  \n')).toBe('Réunion jeudi 14 h, salle Lumière')
  })

  it('cuts a long text on a whole character', () => {
    expect(preview('a'.repeat(70_000))).toHaveLength(400)
    expect(preview('a'.repeat(399) + '🙂')).toBe('a'.repeat(399))
  })
})

describe('matching', () => {
  const items = ['Réunion jeudi 14 h', 'https://github.com/Rateur/sumi', 'Merci pour le retour']
  const keys = items.map(fold)

  it('keeps every item while nothing is typed', () => {
    expect(matching(items, keys, '  ')).toEqual(items)
  })

  it('ignores accents and case, newest first', () => {
    expect(matching(items, keys, 'REUNION')).toEqual(['Réunion jeudi 14 h'])
    expect(matching(items, keys, ' r')).toEqual(items)
    expect(matching(items, keys, 'xyz')).toEqual([])
  })
})

describe('the list', () => {
  it('shows up to five rows, and never none', () => {
    expect(rows(12, 12, '', 'fr')).toBe(5)
    expect(rows(3, 12, 'ré', 'fr')).toBe(3)
    expect(rows(0, 12, 'xyz', 'fr')).toBe(1)
  })

  it('says where what you copy goes while the history is new', () => {
    expect(quiet(0, 0, '', 'fr')).toBe('Ce que vous copiez s’affichera ici.')
    expect(rows(0, 0, '', 'fr')).toBe(1)
    expect(rows(1, 1, '', 'en')).toBe(2)
    expect(quiet(2, 2, '', 'fr')).toBeUndefined()
  })

  it('says when nothing holds what is typed', () => {
    expect(quiet(0, 12, ' xyz ', 'fr')).toBe('Rien ne contient « xyz »')
    expect(quiet(0, 1, 'xyz', 'en')).toBe('Nothing contains "xyz"')
    expect(quiet(1, 1, 'r', 'fr')).toBeUndefined()
  })

  it('counts the items, then the matches', () => {
    expect(count(12, 12, '', 'fr')).toBe('12 éléments')
    expect(count(1, 1, '', 'fr')).toBe('1 élément')
    expect(count(0, 0, '', 'fr')).toBe('0 élément')
    expect(count(2, 12, 'ré', 'fr')).toBe('2 sur 12')
    expect(count(1, 1, '', 'en')).toBe('1 item')
    expect(count(0, 0, '', 'en')).toBe('0 items')
    expect(count(2, 12, 'ré', 'en')).toBe('2 of 12')
  })
})

describe('types', () => {
  const none = new Set<string>()
  const cases: [string, Kind][] = [
    ['https://github.com/Rateur/sumi/pull/94', 'link'],
    ['  HTTP://example.com\n', 'link'],
    ['https://example.com/a b', 'text'],
    ['https:///nothing', 'text'],
    ['ftp://example.com', 'text'],
    ['javascript:alert(1)', 'text'],
    ['file:///C:/Windows', 'text'],
    ['www.example.com', 'text'],
    ['#1E90FF', 'colour'],
    ['#fff', 'colour'],
    ['rgb(30, 144, 255)', 'colour'],
    ['rgb(30 144 255)', 'colour'],
    ['hsl(210, 100%, 56%)', 'colour'],
    ['hsl(210deg 100% 56%)', 'colour'],
    ['rgb(300, 0, 0)', 'text'],
    ['hsl(400, 10%, 10%)', 'text'],
    ['#12345', 'text'],
    ['#GGG', 'text'],
    ['camille.martin@exemple.fr', 'mail'],
    ['a+b_c-d@sub.example.co.uk', 'mail'],
    ['camille@exemple', 'text'],
    ['a@b.c', 'text'],
    ['.a@exemple.fr', 'text'],
    ['a..b@exemple.fr', 'text'],
    ['a@-exemple.fr', 'text'],
    ['a?subject=x@exemple.fr', 'text'],
    ['a%40b@exemple.fr', 'text'],
    ['josé@exemple.fr', 'text'],
    ['Écrivez à a@b.fr', 'text'],
    ['const total = items.reduce(\n  (somme, i) => somme + i.prix,\n  0,\n)', 'code'],
    ['def f(x):\n    return x + 1', 'code'],
    ['{\n  "a": 1\n}', 'code'],
    ['<ul>\n  <li>a</li>\n</ul>', 'code'],
    ['let a = 1;\nlet b = 2;', 'code'],
    ['4 rue de la République,\n69002 Lyon', 'text'],
    ['Courses :\n  - lait\n  - pain', 'text'],
    ['if (x) {', 'text'],
    ['Réunion jeudi 14 h, salle Lumière', 'text'],
    ['C:\\Users\\Valentin\\rapport.pdf', 'text'],
  ]

  it.each(cases)('reads %j as %s', (text, kind) => {
    expect(kindOf(text, none)).toBe(kind)
  })

  it('takes a path from Rust only, which saw it on this PC', () => {
    const path = 'C:\\Users\\Valentin\\rapport.pdf'
    expect(kindOf(path, new Set([path]))).toBe('path')
  })
})

describe('actions', () => {
  it("starts each cycle with Enter's own", () => {
    expect(actionsOf('Bonjour', 'text')).toEqual(['paste'])
    expect(actionsOf('https://example.com', 'link')).toEqual(['paste', 'open'])
    expect(actionsOf('https://example.com/?utm_source=x', 'link')).toEqual(['paste', 'open', 'clean'])
    expect(actionsOf('C:\\a.pdf', 'path')).toEqual(['paste', 'folder'])
    expect(actionsOf('a@exemple.fr', 'mail')).toEqual(['paste', 'write'])
    expect(actionsOf('a {\n}', 'code')).toEqual(['plain'])
  })

  it('turns a colour from the way it was copied', () => {
    expect(actionsOf('#1E90FF', 'colour')).toEqual(['hex', 'rgb', 'hsl'])
    expect(actionsOf('rgb(30, 144, 255)', 'colour')).toEqual(['rgb', 'hsl', 'hex'])
    expect(actionsOf('hsl(210, 100%, 56%)', 'colour')).toEqual(['hsl', 'hex', 'rgb'])
  })

  it('pastes the item itself unless the action makes something else of it', () => {
    expect(formOf('#1e90ff', 'hex')).toBeUndefined()
    expect(formOf('#1e90ff', 'rgb')).toBe('rgb(30, 144, 255)')
    expect(formOf('#1e90ff', 'hsl')).toBe('hsl(210, 100%, 56%)')
    expect(formOf('rgb(30 144 255)', 'hex')).toBe('#1E90FF')
    expect(formOf(' https://a.fr/?utm_source=x \n', 'clean')).toBe('https://a.fr/')
    for (const action of ['paste', 'plain', 'open', 'folder', 'write'] as const) {
      expect(formOf('x', action)).toBeUndefined()
    }
  })
})

describe('colours', () => {
  it('reads every way a colour is written', () => {
    expect(colourOf('#1E90FF')).toEqual({ rgb: [30, 144, 255], format: 'hex' })
    expect(colourOf(' #abc ')).toEqual({ rgb: [170, 187, 204], format: 'hex' })
    expect(colourOf('RGB( 30 , 144 , 255 )')).toEqual({ rgb: [30, 144, 255], format: 'rgb' })
    expect(colourOf('hsl(0, 100%, 50%)')).toEqual({ rgb: [255, 0, 0], format: 'hsl' })
    expect(colourOf('hsl(120.5, 50.5%, 50%)')?.format).toBe('hsl')
  })

  it('writes each format as the list shows it', () => {
    expect(formatted([30, 144, 255], 'hex')).toBe('#1E90FF')
    expect(formatted([30, 144, 255], 'rgb')).toBe('rgb(30, 144, 255)')
    expect(formatted([30, 144, 255], 'hsl')).toBe('hsl(210, 100%, 56%)')
    expect(formatted([0, 0, 0], 'hsl')).toBe('hsl(0, 0%, 0%)')
    expect(formatted([255, 255, 255], 'hsl')).toBe('hsl(0, 0%, 100%)')
  })

  it('shows a colour as it was copied in its own format', () => {
    expect(shown('#1e90ff\n', 'hex')).toBe('#1e90ff')
    expect(shown('#1e90ff', 'rgb')).toBe('rgb(30, 144, 255)')
    expect(shown('#123', 'hex')).toBe('#123')
  })

  const sample = Array.from({ length: 2000 }, (_, i): [number, number, number] => [
    (i * 37) % 256,
    (i * 101) % 256,
    (i * 13) % 256,
  ])

  it('comes back through HEX and RGB exactly', () => {
    for (const rgb of sample) {
      expect(colourOf(formatted(rgb, 'hex'))?.rgb).toEqual(rgb)
      expect(colourOf(formatted(rgb, 'rgb'))?.rgb).toEqual(rgb)
    }
  })

  // Whole degrees and percents hold fewer colours than RGB: a channel may come back 5 off, never more.
  it('comes back through HSL within its rounding, and exactly for pure colours', () => {
    for (const rgb of sample) {
      const back = colourOf(formatted(rgb, 'hsl'))?.rgb ?? []
      expect(back).toHaveLength(3)
      back.forEach((c, k) => expect(Math.abs(c - rgb[k])).toBeLessThanOrEqual(5))
    }
    for (const hex of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF']) {
      const hsl = formatted(colourOf(hex)?.rgb ?? [0, 0, 0], 'hsl')
      expect(formatted(colourOf(hsl)?.rgb ?? [0, 0, 0], 'hex')).toBe(hex)
    }
  })
})

describe('links', () => {
  it('takes the trackers out, and only them', () => {
    expect(untracked('https://example.com/inscription?utm_source=newsletter&utm_medium=email')).toBe(
      'https://example.com/inscription',
    )
    expect(untracked('https://a.fr/p?id=5&utm_source=x&fbclid=y&page=2#top')).toBe('https://a.fr/p?id=5&page=2#top')
    expect(untracked('https://a.fr/?gclid=1&msclkid=2&mc_eid=3&UTM_TERM=4')).toBe('https://a.fr/')
    expect(untracked('https://a.fr/?q=utm_source&utmost=1')).toBe('https://a.fr/?q=utm_source&utmost=1')
    expect(untracked('https://a.fr/#/route?utm_source=x')).toBe('https://a.fr/#/route?utm_source=x')
    expect(untracked('https://a.fr/p')).toBe('https://a.fr/p')
    expect(untracked('https://a.fr/?a=1&&b=2&fbclid=3')).toBe('https://a.fr/?a=1&b=2')
  })

  it('cuts the line into the domain, the path and the query, trackers marked', () => {
    expect(linkParts('https://www.github.com/Rateur/sumi/pull/94')).toEqual({
      domain: 'github.com',
      rest: [{ text: '/Rateur/sumi/pull/94', tracker: false }],
    })
    expect(linkParts('https://a.fr/p?id=5&utm_source=x#top')).toEqual({
      domain: 'a.fr',
      rest: [
        { text: '/p', tracker: false },
        { text: '?id=5', tracker: false },
        { text: '&utm_source=x', tracker: true },
        { text: '#top', tracker: false },
      ],
    })
    expect(linkParts('https://a.fr')).toEqual({ domain: 'a.fr', rest: [] })
  })
})

describe('paths and code', () => {
  it('cuts a long path in the middle', () => {
    expect(middle('C:\\Users\\Valentin\\Documents\\Sumi\\rapport-0.9.pdf')).toBe(
      'C:\\Users\\…\\Sumi\\rapport-0.9.pdf',
    )
    expect(middle('"D:\\Photos\\2026\\Lyon"')).toBe('D:\\Photos\\2026\\Lyon')
    expect(middle('C:/a/b/c/d/e')).toBe('C:/a/…/d/e')
  })

  it('names the folder Explorer opens', () => {
    expect(folderOf('C:\\Users\\Valentin\\Documents\\Sumi\\rapport-0.9.pdf')).toBe('Sumi')
    expect(folderOf('D:\\Photos\\2026\\Lyon\\')).toBe('2026')
    expect(folderOf('"C:\\a.txt"')).toBe('C:')
  })

  it('shows code by its first line and its length', () => {
    expect(codeOf('\nconst a = {\n  b: 1,\n}\n')).toEqual({ first: 'const a = {', lines: 3 })
  })
})

describe('search', () => {
  const items = [
    'https://github.com/Rateur/sumi',
    '#1E90FF',
    'camille@exemple.fr',
    'C:\\Users\\Valentin\\rapport.pdf',
    'if (a) {\n  b()\n}',
    'Merci pour le retour',
  ]
  const paths = new Set([items[3]])
  const keys = (lang: 'fr' | 'en') => items.map((text) => searchKey(text, kindOf(text, paths), lang))

  it("finds an item by its type's name, in the island's language", () => {
    expect(matching(items, keys('fr'), 'couleur')).toEqual(['#1E90FF'])
    expect(matching(items, keys('fr'), 'lien')).toEqual([items[0]])
    expect(matching(items, keys('fr'), 'dossier')).toEqual([items[3]])
    expect(matching(items, keys('fr'), 'e-mail')).toEqual([items[2]])
    expect(matching(items, keys('fr'), 'CODE')).toEqual([items[4]])
    expect(matching(items, keys('en'), 'color')).toEqual(['#1E90FF'])
    expect(matching(items, keys('en'), 'colour')).toEqual(['#1E90FF'])
    expect(matching(items, keys('en'), 'link')).toEqual([items[0]])
    expect(matching(items, keys('en'), 'folder')).toEqual([items[3]])
    expect(matching(items, keys('en'), 'email')).toEqual([items[2]])
    expect(matching(items, keys('en'), 'couleur')).toEqual([])
  })

  it('finds a colour in every format', () => {
    expect(matching(items, keys('fr'), 'rgb(30, 144')).toEqual(['#1E90FF'])
    expect(matching(items, keys('fr'), 'hsl(210')).toEqual(['#1E90FF'])
  })

  it('gives plain text no word of its own', () => {
    expect(searchKey('Merci', 'text', 'fr')).toBe('merci ')
  })
})
