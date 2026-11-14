import { describe, expect, it } from 'vitest'
import { detectEngineFlags } from '@/lib/browser-engine'

const CHROME_UA = (v: number) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`
const EDGE_120_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
const FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const IE11_UA =
  'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; AS; rv:11.0) like Gecko'

describe('detectEngineFlags', () => {
  it('marks Chrome 127 as legacy without currentCSSZoom', () => {
    expect(detectEngineFlags(CHROME_UA(127), false)).toEqual({ zoomMode: 'legacy', engineVersion: '127' })
  })
  it('marks Chrome 127 with currentCSSZoom as not legacy but still records engineVersion', () => {
    expect(detectEngineFlags(CHROME_UA(127), true)).toEqual({ engineVersion: '127' })
  })
  it('leaves Chrome 128 alone', () => {
    expect(detectEngineFlags(CHROME_UA(128), false)).toEqual({})
    expect(detectEngineFlags(CHROME_UA(128), true)).toEqual({})
  })
  it('flags Chrome 109 (360 / QQ legacy 极速 mode)', () => {
    expect(detectEngineFlags(CHROME_UA(109), false)).toEqual({ zoomMode: 'legacy', engineVersion: '109' })
  })
  it('flags Edge 120', () => {
    expect(detectEngineFlags(EDGE_120_UA, false)).toEqual({ zoomMode: 'legacy', engineVersion: '120' })
  })
  it('ignores Firefox', () => {
    expect(detectEngineFlags(FIREFOX_UA, false)).toEqual({})
  })
  it('ignores Safari', () => {
    expect(detectEngineFlags(SAFARI_UA, false)).toEqual({})
  })
  it('flags IE 11 with engineVersion 0', () => {
    expect(detectEngineFlags(IE11_UA, false)).toEqual({ engineVersion: '0' })
  })
})
