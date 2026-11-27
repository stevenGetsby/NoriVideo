import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_CLIPBOARD_MIME,
  collectCanvasClipboardText,
  hasCanvasClipboardMime,
  isCanvasClipboardMimeAvailable,
  parseCanvasClipboardDocument,
  persistCanvasClipboard,
  readPersistedCanvasClipboard,
  readPersistedCanvasClipboardText,
  resolveCanvasClipboardPasteSource,
  writeCanvasClipboard,
} from '../../../src/features/canvas/clipboard'

const base = {
  hasSystemCanvas: false,
  hasSystemMedia: false,
  systemTextReadable: true,
  systemText: '',
  hasInternalCanvas: false,
  internalCopyText: null,
} as const

describe('infinite canvas clipboard priority', () => {
  it('recognises the dedicated canvas format ahead of everything else on the clipboard', () => {
    expect(hasCanvasClipboardMime(['text/plain', CANVAS_CLIPBOARD_MIME])).toBe(true)
    expect(hasCanvasClipboardMime(['text/plain'])).toBe(false)
    expect(isCanvasClipboardMimeAvailable([CANVAS_CLIPBOARD_MIME])).toBe(false)
    expect(resolveCanvasClipboardPasteSource({
      ...base, hasSystemCanvas: true, hasSystemMedia: true, systemText: '剪贴板里的正文', hasInternalCanvas: true,
    })).toBe('system-canvas')
  })

  it('pastes a Finder/system image instead of a previously copied canvas node', () => {
    expect(isCanvasClipboardMimeAvailable(['image/png'])).toBe(true)
    expect(resolveCanvasClipboardPasteSource({
      ...base, hasSystemMedia: true, systemTextReadable: false, hasInternalCanvas: true,
    })).toBe('system-media')
  })

  it('keeps ordinary system text ahead of stale internal nodes', () => {
    expect(resolveCanvasClipboardPasteSource({
      ...base, systemText: '来自系统剪贴板的新文本', hasInternalCanvas: true,
    })).toBe('system-text')
  })

  it.each([
    { label: '系统文本读取失败', systemTextReadable: false, systemText: '被忽略的不可读内容' },
    { label: '系统剪贴板为空', systemTextReadable: true, systemText: '   ' },
  ])('$label时才回退到内部节点剪贴板', ({ systemTextReadable, systemText }) => {
    expect(resolveCanvasClipboardPasteSource({
      ...base, systemTextReadable, systemText, hasInternalCanvas: true,
    })).toBe('internal-canvas')
  })

  it('treats the plain text of a copy that could not store the canvas format as that copy, not as new text', () => {
    expect(resolveCanvasClipboardPasteSource({
      ...base, systemText: '  正文\n', hasInternalCanvas: true, internalCopyText: '正文',
    })).toBe('internal-canvas')
    expect(resolveCanvasClipboardPasteSource({
      ...base, systemText: '别处复制的文字', hasInternalCanvas: true, internalCopyText: '正文',
    })).toBe('system-text')
    expect(resolveCanvasClipboardPasteSource({
      ...base, systemText: '正文', hasInternalCanvas: true, internalCopyText: null,
    })).toBe('system-text')
    expect(resolveCanvasClipboardPasteSource({ ...base })).toBe('none')
  })

  it('wires the shared priority resolver into both media and node paste paths', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const mediaPasteStart = source.indexOf('const pasteFromSystem')
    const mediaPasteEnd = source.indexOf('const selectedNodes = nodes.filter', mediaPasteStart)
    const mediaPaste = source.slice(mediaPasteStart, mediaPasteEnd)

    expect(source.slice(source.indexOf('const paste = useCallback'), source.indexOf('const handleGenerate')))
      .toContain('resolveCanvasClipboardPasteSource')
    expect(mediaPaste).toContain('resolveCanvasClipboardPasteSource')
    expect(mediaPaste).toContain('hasCanvasClipboardMime(item.types)')
    expect(mediaPaste.indexOf("source === 'system-media'")).toBeLessThan(mediaPaste.indexOf('await paste(position'))
  })

  it('copies through the dedicated writer instead of dumping JSON into the text flavour', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const copy = source.slice(source.indexOf('const copySelection'), source.indexOf('const refreshClipboardAvailability'))
    expect(copy).toContain('writeCanvasClipboard(JSON.stringify(payload), plainText)')
    expect(copy).not.toContain('writeText(')
    expect(copy).not.toMatch(/\bNORI_CANVAS\b/)
  })
})

describe('canvas clipboard text flavour', () => {
  it('carries only the body of copied text nodes', () => {
    expect(collectCanvasClipboardText([
      { type: 'text', data: { text: ' 第一段 ' } },
      { type: 'image', data: { mediaType: 'image', text: '不应出现', prompt: 'a cat' } },
      { type: 'note', data: { text: '第二段' } },
      { type: 'video', data: { mediaType: 'text', text: '按 mediaType 判断的文本' } },
      { type: 'text', data: { text: '   ' } },
      { type: 'text', data: null },
    ])).toBe('第一段\n\n第二段\n\n按 mediaType 判断的文本')
    expect(collectCanvasClipboardText([{ type: 'image', data: { mediaType: 'image' } }])).toBe('')
  })

  it('never serialises node data into the plain-text flavour', () => {
    const text = collectCanvasClipboardText([{ type: 'text', data: { text: '正文', prompt: 'p', generation: { modelKey: 'm' } } }])
    expect(text).toBe('正文')
    expect(text).not.toContain('{')
  })
})

describe('canvas clipboard document parsing', () => {
  const node = { id: 'n1', type: 'text', position: { x: 10, y: 20 }, data: { text: 'hi' } }

  it('accepts a well-formed document and defaults missing wires', () => {
    expect(parseCanvasClipboardDocument(JSON.stringify({ nodes: [node], edges: [{ id: 'e1' }] })))
      .toEqual({ nodes: [node], edges: [{ id: 'e1' }] })
    expect(parseCanvasClipboardDocument(JSON.stringify({ nodes: [node] }))?.edges).toEqual([])
  })

  it.each([
    ['not json', 'NORI_CANVAS:{"nodes":[]}'],
    ['null', 'null'],
    ['no nodes', JSON.stringify({ nodes: [] })],
    ['nodes not an array', JSON.stringify({ nodes: { id: 'n1' } })],
    ['node without id', JSON.stringify({ nodes: [{ position: { x: 1, y: 1 } }] })],
    ['node without position', JSON.stringify({ nodes: [{ id: 'n1' }] })],
    ['non-finite position', JSON.stringify({ nodes: [{ id: 'n1', position: { x: 'a', y: 1 } }] })],
    ['null node', JSON.stringify({ nodes: [null] })],
  ])('rejects %s', (_label, raw) => {
    expect(parseCanvasClipboardDocument(raw)).toBeNull()
  })
})

describe('canvas clipboard session fallback', () => {
  it('restores a copied document and its text identity after navigation', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const document = { nodes: [{ id: 'scene', position: { x: 1, y: 2 }, data: { text: '正文' } }], edges: [] }

    persistCanvasClipboard(document, '正文', storage)

    expect(readPersistedCanvasClipboard(storage)).toEqual(document)
    expect(readPersistedCanvasClipboardText(storage)).toBe('正文')
    expect(resolveCanvasClipboardPasteSource({ ...base, systemText: '正文', hasInternalCanvas: true, internalCopyText: '正文' })).toBe('internal-canvas')
  })

  it('does not retain oversized clipboard documents', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    persistCanvasClipboard({ nodes: [{ id: 'big', position: { x: 0, y: 0 }, text: 'x'.repeat(1_000_001) }], edges: [] }, null, storage)
    expect(readPersistedCanvasClipboard(storage)).toBeNull()
  })
})

describe('canvas clipboard writer', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem')

  class FakeClipboardItem {
    readonly entries: Record<string, Blob>
    constructor(entries: Record<string, Blob>) { this.entries = entries }
  }

  function install(clipboard: unknown) {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true })
    Object.defineProperty(globalThis, 'ClipboardItem', { value: FakeClipboardItem, configurable: true })
  }

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
    if (originalItem) Object.defineProperty(globalThis, 'ClipboardItem', originalItem)
    else Reflect.deleteProperty(globalThis, 'ClipboardItem')
  })

  it('stores the JSON under the dedicated format and only the body under text/plain', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    install({ write, writeText })

    await expect(writeCanvasClipboard('{"nodes":[]}', '正文')).resolves.toEqual({ canvasFormat: true })

    const item = write.mock.calls[0][0][0] as FakeClipboardItem
    expect(Object.keys(item.entries).sort()).toEqual([CANVAS_CLIPBOARD_MIME, 'text/plain'].sort())
    expect(await item.entries[CANVAS_CLIPBOARD_MIME].text()).toBe('{"nodes":[]}')
    expect(item.entries[CANVAS_CLIPBOARD_MIME].type).toBe(CANVAS_CLIPBOARD_MIME)
    expect(await item.entries['text/plain'].text()).toBe('正文')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('leaves text/plain out when the copy has no body text', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    install({ write, writeText: vi.fn() })

    await writeCanvasClipboard('{"nodes":[]}', '')

    expect(Object.keys((write.mock.calls[0][0][0] as FakeClipboardItem).entries)).toEqual([CANVAS_CLIPBOARD_MIME])
  })

  it('falls back to plain text and reports it when the browser rejects the custom format', async () => {
    const write = vi.fn().mockRejectedValue(new TypeError('unsupported type'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    install({ write, writeText })

    await expect(writeCanvasClipboard('{"nodes":[]}', '正文')).resolves.toEqual({ canvasFormat: false })
    expect(writeText).toHaveBeenCalledWith('正文')
  })

  it('does not throw when the clipboard is unavailable or fully denied', async () => {
    install(undefined)
    await expect(writeCanvasClipboard('{}', 'x')).resolves.toEqual({ canvasFormat: false })

    install({ write: vi.fn().mockRejectedValue(new Error('denied')), writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    await expect(writeCanvasClipboard('{}', 'x')).resolves.toEqual({ canvasFormat: false })
  })
})
