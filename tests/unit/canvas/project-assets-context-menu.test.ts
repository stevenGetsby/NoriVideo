import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CanvasProjectAssetContextMenu,
  type CanvasProjectAssetMenuState,
} from '@/features/canvas/components/CanvasProjectAssets'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const handlers = {
  onRenameMaterial: vi.fn(),
  onDeleteMaterial: vi.fn(),
  onLoadWorkflow: vi.fn(),
  onDeleteWorkflow: vi.fn(),
}

function renderMenu(
  state: CanvasProjectAssetMenuState,
  options: { canEditAssets?: boolean; canEditWorkflows?: boolean; deleteConfirmId?: string | null } = {},
) {
  return renderToStaticMarkup(React.createElement(CanvasProjectAssetContextMenu, {
    state,
    canEditAssets: options.canEditAssets ?? true,
    canEditWorkflows: options.canEditWorkflows ?? true,
    deleteConfirmId: options.deleteConfirmId ?? null,
    ...handlers,
  }))
}

describe('canvas project asset context menus', () => {
  it('shows rename and confirmed deletion only to asset editors', () => {
    const state = { kind: 'material', id: 'material-1', x: 120, y: 80 } as const
    const menu = renderMenu(state)
    expect(menu).toContain('aria-label="本地资产操作"')
    expect(menu).toContain('重命名')
    expect(menu).toContain('删除资产')
    expect(menu).not.toContain('加载到画布中央')
    expect(renderMenu(state, { canEditAssets: false })).toBe('')
    expect(renderMenu(state, { deleteConfirmId: 'material-1' })).toContain('确认删除资产')
  })

  it('loads workflows into the viewport center and confirms deletion', () => {
    const state = { kind: 'workflow', id: 'workflow-1', x: 120, y: 80 } as const
    const menu = renderMenu(state)
    expect(menu).toContain('aria-label="工作流操作"')
    expect(menu).toContain('加载到画布中央')
    expect(menu).toContain('删除工作流')
    expect(menu).not.toContain('重命名')
    expect(renderMenu(state, { canEditWorkflows: false })).toBe('')
    expect(renderMenu(state, { deleteConfirmId: 'workflow-1' })).toContain('确认删除工作流')
  })

  it('opens only for local uploads, clamps to the viewport, and closes before the panel on Escape', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/components/CanvasProjectAssets.tsx'), 'utf8')
    expect(source).toContain("material.source === 'upload' && canEditAssets")
    expect(source).toContain("openContextMenu(event, 'workflow', template.id)")
    expect(source).toContain('Math.min(event.clientX, window.innerWidth - menuWidth - 8)')
    expect(source).toContain("if (event.key !== 'Escape') return")
    expect(source.indexOf('if (contextMenu)')).toBeLessThan(source.indexOf('onClose()'))
    expect(source).toContain("target.closest('[data-canvas-project-assets-menu]')")
  })

  it('lists readable projects and makes image, video, audio, and 3D assets draggable', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/components/CanvasProjectAssets.tsx'), 'utf8')
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    expect(source).toContain("available: '1'")
    expect(source).toContain('来源作品')
    expect(source).toContain('<article')
    expect(source).toContain('draggable')
    expect(source).toContain("event.dataTransfer.setData(CANVAS_MATERIAL_DRAG_TYPE, JSON.stringify(material))")
    expect(graph).toContain("['image', 'video', 'audio', 'model3d']")
  })
})
