import { beforeAll, describe, expect, it, vi } from 'vitest'

let songParams: typeof import('./demo').songParams
const site = 'https://sumi.example'
const isColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

beforeAll(async () => {
  // demo.ts reads the page's location when it loads.
  vi.stubGlobal('location', { search: '', origin: site, href: `${site}/` })
  ;({ songParams } = await import('./demo'))
})

describe('songParams', () => {
  it('ignores the song on a page nobody trusts, like a shared link', () => {
    expect(songParams('?title=Urgent&artist=Call%20this%20number', site, isColor, false)).toEqual({})
  })

  it('keeps a song with a cover from the site and a real colour', () => {
    const search = '?title=Intro&artist=The%20xx&art=/covers/intro.jpg&color=%23F472B6'
    expect(songParams(search, site, isColor, true)).toEqual({
      title: 'Intro',
      artist: 'The xx',
      art: '/covers/intro.jpg',
      color: '#F472B6',
    })
  })

  it('drops a cover from another site', () => {
    expect(songParams('?art=https://evil.example/x.png', site, isColor, true)).toEqual({})
    expect(songParams('?art=//evil.example/x.png', site, isColor, true)).toEqual({})
  })

  it('drops a colour that is not one', () => {
    expect(songParams('?color=url(https://evil.example/x)', site, isColor, true)).toEqual({})
  })

  it('ignores other params', () => {
    expect(songParams('?show=music&foo=bar', site, isColor, true)).toEqual({})
  })
})
