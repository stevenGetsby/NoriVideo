import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isCanvasClipboardMimeAvailable,
  resolveCanvasClipboardPasteSource,
} from '../../../src/features/canvas/clipboard'

describe('infinite canvas clipboard priority', () => {
  it('pastes a Finder/system image instead of a previously copied canvas node', () => {
    expect(isCanvasClipboardMimeAvailable(['image/png'])).toBe(true)
    expect(resolveCanvasClipboardPasteSource({
      hasSystemMedia: true,
      systemTextReadable: false,
      systemText: '',
      hasInternalCanvas: true,
    })).toBe('system-media')
  })

  it('keeps both system canvas data and ordinary system text ahead of stale internal nodes', () => {
    expect(resolveCanvasClipboardPasteSource({
      hasSystemMedia: false,
      systemTextReadable: true,
      systemText: 'NORI_CANVAS:{"nodes":[{"id":"fresh"}]}',
      hasInternalCanvas: true,
    })).toBe('system-canvas')

    expect(resolveCanvasClipboardPasteSource({
      hasSystemMedia: false,
      systemTextReadable: true,
      systemText: '来自系统剪贴板的新文本',
      hasInternalCanvas: true,
    })).toBe('system-text')
  })

  it.each([
    { label: '系统文本读取失败', systemTextReadable: false, systemText: '被忽略的不可读内容' },
    { label: '系统剪贴板为空', systemTextReadable: true, systemText: '   ' },
  ])('$label时才回退到内部节点剪贴板', ({ systemTextReadable, systemText }) => {
    expect(resolveCanvasClipboardPasteSource({
      hasSystemMedia: false,
      systemTextReadable,
      systemText,
      hasInternalCanvas: true,
    })).toBe('internal-canvas')
  })

  it('wires the shared priority resolver into both media and node paste paths', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const mediaPasteStart = source.indexOf('const pasteFromSystem')
    const mediaPasteEnd = source.indexOf('const selectedNodes = nodes.filter', mediaPasteStart)
    const mediaPaste = source.slice(mediaPasteStart, mediaPasteEnd)

    expect(source.slice(source.indexOf('const paste = useCallback'), source.indexOf('const handleGenerate')))
      .toContain('resolveCanvasClipboardPasteSource')
    expect(mediaPaste).toContain('resolveCanvasClipboardPasteSource')
    expect(mediaPaste.indexOf("source === 'system-media'")).toBeLessThan(mediaPaste.indexOf('await paste(position)'))
  })
})
