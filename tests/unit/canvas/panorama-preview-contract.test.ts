import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCanvasPanoramaNodeData } from '@/features/canvas/types'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('canvas panorama preview contract', () => {
  it('recognizes explicit and legacy panorama nodes without treating every ultrawide image as one', () => {
    expect(isCanvasPanoramaNodeData({ processType: 'panorama_720' })).toBe(true)
    expect(isCanvasPanoramaNodeData({
      title: '旧场景 · 720全景',
      generation: { aspectRatio: '2:1' },
    })).toBe(true)
    expect(isCanvasPanoramaNodeData({
      title: '普通电影宽幅',
      generation: { aspectRatio: '21:9' },
    })).toBe(false)
  })

  it('keeps a persistent preview button on every completed panorama image', () => {
    const node = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    const dialog = readSource('src/features/canvas/components/CanvasPanoramaDialog.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(node).toContain('const canPreviewPanorama = Boolean(isPanorama && imageUrl')
    expect(node).toContain('className="nodrag nowheel nori-canvas-panorama-preview"')
    expect(node).toContain('aria-label="全景预览"')
    expect(node).toContain("editor.runNodeAction(id, 'panorama_preview')")
    expect(styles).toContain('.nori-canvas-panorama-preview {')
    expect(styles).toContain('.nori-canvas-panorama-preview:focus-visible')
    expect(dialog).toContain('const textureSrc = toCanvasTextureUrl(src) || src')
    expect(dialog).toContain('return createPortal(')
    expect(dialog).toContain('交互式全景加载失败，已显示平面预览')
    expect(dialog).toContain('setLoadAttempt((value) => value + 1)')
    expect(styles).toContain('.nori-canvas-panorama-overlay {')
  })

  it('submits and binds the explicit panorama type so reopening still exposes preview', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const route = readSource('src/app/api/frameos/toolbox/generate/route.ts')
    const binding = readSource('src/lib/canvas/toolbox-node-binding.ts')

    expect(graph).toContain('? CANVAS_PANORAMA_PROCESS_TYPE')
    expect(graph).toContain("processType: CANVAS_PANORAMA_PROCESS_TYPE")
    expect(route).toContain('const panorama = type === \'image\' && isCanvasPanoramaProcessType(processType)')
    expect(route).toContain('processType: canvasProcessType')
    expect(binding).toContain('...(input.processType ? { processType: input.processType } : {})')
  })
})
