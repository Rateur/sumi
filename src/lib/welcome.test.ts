import { describe, expect, it } from 'vitest'
import { announce, keysOf } from './welcome'

describe('keysOf', () => {
  it('splits the shortcut into keycaps, with Shift in French as on the keyboard', () => {
    expect(keysOf('Win+Alt+S', 'fr')).toEqual(['Win', 'Alt', 'S'])
    expect(keysOf('Alt+Shift+S', 'fr')).toEqual(['Alt', 'Maj', 'S'])
    expect(keysOf('Alt+Shift+S', 'en')).toEqual(['Alt', 'Shift', 'S'])
  })

  it('has no keys without a shortcut', () => {
    expect(keysOf(undefined, 'en')).toBeUndefined()
  })
})

describe('announce', () => {
  it('spells the shortcut out', () => {
    expect(announce('Win+Alt+S', 'fr')).toBe('Bienvenue dans Sumi. Ouvrez la barre de commande avec Windows + Alt + S.')
    expect(announce('Alt+Shift+S', 'en')).toBe('Welcome to Sumi. Open the command bar with Alt + Shift + S.')
  })

  it('only welcomes without a shortcut', () => {
    expect(announce(undefined, 'fr')).toBe('Bienvenue dans Sumi.')
    expect(announce(undefined, 'en')).toBe('Welcome to Sumi.')
  })
})
