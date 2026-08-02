import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Seedance toolbox and canvas interaction surface', () => {
  it('loads only toolbox-owned history and renders actionable failure details', () => {
    const toolbox = source('src/components/frameos/views/FosToolbox.tsx')

    expect(toolbox).toContain('&source=toolbox&limit=80')
    expect(toolbox).toContain('失败原因')
    expect(toolbox).toContain('selectedFailureCode')
    expect(toolbox).toContain('任务 ID：')
    expect(toolbox).toContain('onClick={() => setSelectedId(asset.id)}')
    expect(toolbox).toContain('<video src={src} controls playsInline')
    expect(toolbox).toContain('仅展示当前项目的工具箱任务')
    expect(toolbox).toContain('在项目素材库查看')
    expect(toolbox).toContain('initialProjectId={projectId}')
    expect(toolbox).toContain('initialMaterialId={focusedMaterialId}')
  })

  it('keeps mention highlight glyph metrics aligned with the real textarea caret', () => {
    const sharedCss = source('src/styles/frameos-replica.css')
    const canvasCss = source('src/features/canvas/canvas.css')
    const sharedRule = sharedCss.match(/\.mention-prompt-highlight__asset\s*\{([^}]+)\}/)?.[1] || ''
    const canvasRule = canvasCss.match(/\.nori-canvas-generator-prompt \.mention-prompt-highlight__asset\s*\{([^}]+)\}/)?.[1] || ''

    expect(sharedRule).toContain('font-weight: inherit')
    expect(canvasRule).toContain('font-weight: inherit')
    expect(sharedRule).not.toMatch(/font-weight:\s*(600|700)/)
    expect(canvasRule).not.toMatch(/font-weight:\s*(600|700)/)
  })

  it('shows mentioned unconnected references and persists hover enlargement preference', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')

    expect(generator).toContain('referenceNodeIds.flatMap((id) => {')
    expect(generator).toContain('return [...visibleIncomingNodes, ...selected]')
    expect(generator).toContain("window.localStorage.getItem('nori.canvas.auto-reference-preview')")
    expect(generator).toContain("window.localStorage.setItem('nori.canvas.auto-reference-preview'")
    expect(generator).toContain('nori-canvas-generator-ref-preview')
    expect(generator).toContain('<video src={hoveredReferenceUrl} muted autoPlay loop playsInline')
    expect(generator).toContain("type === 'video' && strict ? validateVideoReferenceMediaCombination")
  })

  it('prevents marquee selection while wiring and increases magnetic hit areas', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const help = source('src/features/canvas/components/CanvasHelpPanel.tsx')

    expect(graph).toContain('selectionOnDrag={!connectionActive}')
    expect(graph).toContain('connectionRadius={64}')
    expect(graph).toContain('reconnectRadius={64}')
    expect(graph).toContain('paneClickDistance={8}')
    expect(graph).toContain('findCanvasNodeIdsIntersectingRect')
    expect(graph).toContain('findSvgEdgeIdsIntersectingRect')
    expect(graph).toContain('window.requestAnimationFrame(() => selectElementsCoveredByRect')
    expect(help).toContain("['框选连线', '空白处拖框穿过连线']")
    expect(help).toContain("['连接节点', '靠近端口自动吸附']")
  })
})
