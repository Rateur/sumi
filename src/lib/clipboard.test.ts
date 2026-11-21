import { describe, expect, it } from 'vitest'
import { count, matching, preview, quiet, rows } from './clipboard'
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
