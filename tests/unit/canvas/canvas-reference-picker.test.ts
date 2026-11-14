import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildCanvasReferencePickerItems,
  canvasReferenceMediaType,
  canvasReferenceOrderLabel,
  canvasReferencePickerTypes,
  canvasReferenceRemaining,
  mergePickedReferenceIds,
} from '@/features/canvas/canvas-reference-picker'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const source = (path: string) => readFileSync(path, 'utf8')

function node(id: string, type: string, data: Record<string, unknown> = {}): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, ...data } } as unknown as CanvasFlowNode
}

const limits = { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } }

describe('canvas reference picker helpers', () => {
  it('只提供模型能接收的媒体类型，上限为 0 的类型不出现', () => {
    expect(canvasReferencePickerTypes(null, limits)).toEqual([])
    expect(canvasReferencePickerTypes('all', limits)).toEqual(['image', 'video', 'audio'])
    expect(canvasReferencePickerTypes('all', { ...limits, audio: { max: 0 } })).toEqual(['image', 'video'])
    expect(canvasReferencePickerTypes('image', { ...limits, image: { max: 0 } })).toEqual([])
    expect(canvasReferencePickerTypes('audio', limits)).toEqual(['audio'])
    expect(canvasReferencePickerTypes('all', null)).toEqual(['image', 'video', 'audio'])
  })

  it('剩余额度按类型扣除已选引用，且不为负数', () => {
    const selected = [node('a', 'image'), node('b', 'image'), node('v', 'video'), node('t', 'text')]
    expect(canvasReferenceRemaining(limits, ['image', 'video', 'audio'], selected)).toEqual({ image: 7, video: 2, audio: 3 })
    expect(canvasReferenceRemaining({ ...limits, image: { max: 1 } }, ['image'], selected)).toEqual({ image: 0, video: 0, audio: 0 })
    expect(canvasReferenceRemaining(null, ['image'], [])).toEqual({ image: 9, video: 0, audio: 0 })
  })

  it('媒体类型优先取 data.mediaType，否则取节点类型', () => {
    expect(canvasReferenceMediaType(node('a', 'creative', { mediaType: 'video' }))).toBe('video')
    expect(canvasReferenceMediaType(node('b', 'audio'))).toBe('audio')
    expect(canvasReferenceMediaType(node('c', 'text'))).toBeNull()
    expect(canvasReferenceMediaType(node('d', 'group'))).toBeNull()
  })

  it('候选素材：新节点在前，排除生成节点、文字节点、无媒体地址和不允许的类型', () => {
    const nodes = [
      node('old-image', 'image', { title: '旧图', contentUrl: '/old.webp' }),
      node('gen', 'video', { title: '生成节点', videoUrl: '/gen.mp4' }),
      node('text', 'text', { title: '文案' }),
      node('pending', 'image', { title: '生成中' }),
      node('clip', 'video', { title: '镜头一', videoUrl: '/clip.mp4', posterUrl: '/clip.jpg' }),
      node('clip-no-poster', 'video', { title: '镜头二', contentUrl: '/clip2.mp4' }),
      node('voice', 'audio', { title: '旁白', audioUrl: '/voice.mp3' }),
      node('new-image', 'image', { title: '  ', imageUrl: '/new.webp' }),
    ]
    const items = buildCanvasReferencePickerItems({
      nodes,
      generatorNodeId: 'gen',
      allowedTypes: ['image', 'video'],
      selectedIds: [],
      wiredIds: new Set(),
      isCharacter: () => false,
    })
    expect(items.map((item) => item.id)).toEqual(['new-image', 'clip-no-poster', 'clip', 'old-image'])
    expect(items[0].title).toBe('未命名素材')
    const clip = items.find((item) => item.id === 'clip')!
    expect(clip).toMatchObject({ mediaType: 'video', preview: '/clip.jpg', videoSrc: '/clip.mp4' })
    const noPoster = items.find((item) => item.id === 'clip-no-poster')!
    expect(noPoster).toMatchObject({ preview: null, videoSrc: '/clip2.mp4' })
    expect(items.find((item) => item.id === 'old-image')).toMatchObject({ mediaType: 'image', preview: '/old.webp', videoSrc: null })
  })

  it('候选素材的媒体地址与服务端 materialUrl 一致，保证选中后可登记素材', () => {
    const nodes = [
      node('image-poster-only', 'image', { posterUrl: '/poster.webp' }),
      node('image-content-first', 'image', { contentUrl: '/content.webp', imageUrl: '/image.webp' }),
      node('video-image-only', 'video', { imageUrl: '/frame.webp' }),
      node('audio-content', 'audio', { contentUrl: '/audio.wav' }),
    ]
    const items = buildCanvasReferencePickerItems({
      nodes,
      generatorNodeId: 'gen',
      allowedTypes: ['image', 'video', 'audio'],
      selectedIds: [],
      wiredIds: new Set(),
      isCharacter: () => false,
    })
    expect(items.map((item) => item.id).sort()).toEqual(['audio-content', 'image-content-first', 'image-poster-only'])
    expect(items.find((item) => item.id === 'image-content-first')!.preview).toBe('/content.webp')
  })

  it('候选素材标记已引用、已连线和角色，角色标记只作用于图片', () => {
    const nodes = [
      node('a', 'image', { contentUrl: '/a.webp' }),
      node('b', 'image', { contentUrl: '/b.webp' }),
      node('c', 'image', { contentUrl: '/c.webp' }),
      node('d', 'video', { videoUrl: '/d.mp4' }),
    ]
    const items = buildCanvasReferencePickerItems({
      nodes,
      generatorNodeId: 'gen',
      allowedTypes: ['image', 'video'],
      selectedIds: ['a'],
      wiredIds: new Set(['a', 'b']),
      isCharacter: (item) => item.id === 'c' || item.id === 'd',
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId.a).toMatchObject({ referenced: true, wired: true, character: false })
    expect(byId.b).toMatchObject({ referenced: false, wired: true, character: false })
    expect(byId.c).toMatchObject({ referenced: false, wired: false, character: true })
    expect(byId.d.character).toBe(false)
  })

  it('首尾帧模式前两个选择显示首/尾，其余显示序号', () => {
    expect(canvasReferenceOrderLabel(0, true)).toBe('首')
    expect(canvasReferenceOrderLabel(1, true)).toBe('尾')
    expect(canvasReferenceOrderLabel(2, true)).toBe('3')
    expect(canvasReferenceOrderLabel(0, false)).toBe('1')
    expect(canvasReferenceOrderLabel(4, false)).toBe('5')
  })

  it('合并所选引用：追加在已有引用之后、去重并保持点选顺序', () => {
    expect(mergePickedReferenceIds(['a', 'b'], ['c', 'a', 'd', 'c'])).toEqual(['a', 'b', 'c', 'd'])
    expect(mergePickedReferenceIds([], ['x'])).toEqual(['x'])
    const current = ['a']
    mergePickedReferenceIds(current, ['b'])
    expect(current).toEqual(['a'])
  })
})

describe('canvas reference picker wiring', () => {
  const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
  const dialog = source('src/features/canvas/components/CanvasReferencePickerDialog.tsx')
  const css = source('src/features/canvas/canvas.css')

  it('加号弹出菜单：从画布选择 / 从素材库选择，素材库入口继续走原有回调', () => {
    expect(generator).toContain('<span>从画布选择</span>')
    expect(generator).toContain('<span>从素材库选择</span>')
    expect(generator).toContain('role="menuitem"')
    expect(generator).toContain("setReferenceMenuOpen(false); onAddReferences({ type: referencePickerType, maxSelected: referencePickerMax })")
    expect(generator).toContain('<CanvasReferencePickerDialog')
  })

  it('确认选择时按当前模型校验引用上限，并且不新建节点或连线', () => {
    const start = generator.indexOf('const confirmCanvasReferencePick')
    const body = generator.slice(start, generator.indexOf('useEffect(', start))
    expect(body).toContain('mergePickedReferenceIds(referenceNodeIds, pickedIds)')
    expect(body).toContain('referenceErrors(next, false)')
    expect(body).toContain('if (errors.length > 0) return errors[0]')
    expect(body).toContain('setReferenceNodeIds(next)')
    expect(body).not.toContain('onSelectLibraryMaterial')
    expect(body).not.toContain('onAddReferences')
  })

  it('只在菜单或对话框打开时扫描画布节点，避免大画布每次渲染都付出代价', () => {
    expect(generator).toContain('const canvasPickerActive = referenceMenuOpen || canvasPickerOpen')
    expect(generator).toContain('const canvasPickerItems = useMemo(() => canvasPickerActive')
    expect(generator).toContain('canvasPickerActive\n    ? buildCanvasReferencePickerItems')
  })

  it('切换节点时关闭引用菜单和选择对话框', () => {
    const rehydrate = generator.indexOf('hydratedInputRef.current = node.id')
    const slice = generator.slice(rehydrate, generator.indexOf('}, [node.id])', rehydrate))
    expect(slice).toContain('setReferenceMenuOpen(false)')
    expect(slice).toContain('setCanvasPickerOpen(false)')
  })

  it('对话框把键盘事件留在模态内：任何焦点下 Esc 只关闭自己，其余按键不触达画布快捷键', () => {
    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain("window.addEventListener('keydown', onKeyDown, true)")
    expect(dialog).toContain("if (event.key === 'Escape')")
    expect(dialog).toContain('if (event.isComposing) return')
    expect(dialog).toContain('event.preventDefault()')
    expect(dialog).toContain('event.stopPropagation()')
    expect(dialog).toContain('dialogRef.current?.contains(event.target)')
    expect(dialog).toContain('onKeyDown={(event) => event.stopPropagation()}')
    expect(dialog).toContain('onCompositionEnd')
  })

  it('已引用/已满的素材保持可聚焦（aria-disabled），避免焦点掉到 body 后快捷键落到画布', () => {
    expect(dialog).toContain('aria-disabled={item.referenced || limited}')
    expect(dialog).not.toContain('disabled={item.referenced}')
  })

  it('样式使用纯色并满足 32/28/40 控件尺寸', () => {
    const start = css.indexOf('.nori-canvas-reference-add-menu {')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start)
    expect(block).not.toMatch(/gradient\(/)
    expect(block).toMatch(/\.nori-canvas-reference-picker-search input \{[^}]*height: 32px/)
    expect(block).toMatch(/\.nori-canvas-reference-picker-types > button \{[^}]*height: 28px/)
    expect(block).toMatch(/\.nori-canvas-reference-picker > footer > button \{[^}]*height: 40px/)
    expect(block).toContain('.nori-canvas-reference-picker-tile.is-referenced')
    expect(block).toContain('.nori-canvas-reference-picker-order')
  })
})
