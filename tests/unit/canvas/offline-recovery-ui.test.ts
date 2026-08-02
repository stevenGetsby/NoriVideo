import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasConflictDialog, CanvasOfflineRecoveryDialog } from '@/features/canvas/components/CanvasDialogs'
import { createCanvasOfflineDraft } from '@/features/canvas/state/canvas-offline-store'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('canvas offline recovery UI', () => {
  it('does not expose a dead close control while conflict recovery is mandatory', () => {
    const markup = renderToStaticMarkup(React.createElement(CanvasConflictDialog, {
      loading: false,
      onLoadServer: vi.fn(),
      onMerge: vi.fn(),
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('多标签页冲突')
    expect(markup).not.toContain('title="关闭"')
  })

  it('requires an explicit local-or-server recovery choice', () => {
    const draft = createCanvasOfflineDraft({
      namespace: { accountId: 'account-1', projectId: 'project-1', canvasId: 'canvas-1' },
      document: {
        expectedRevision: 4,
        clientId: 'tab-1',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
      },
      updatedAt: Date.parse('2026-07-17T08:00:00.000Z'),
    })
    const markup = renderToStaticMarkup(React.createElement(CanvasOfflineRecoveryDialog, {
      draft,
      serverRevision: 9,
      loading: false,
      onRestoreLocal: vi.fn(),
      onUseServer: vi.fn(),
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('发现本地未同步版本')
    expect(markup).toContain('本地基于版本 4 · 服务器版本 9')
    expect(markup).toContain('使用服务器版本')
    expect(markup).toContain('恢复本地版本')
    expect(markup).not.toContain('title="关闭"')
  })

  it('locks editing while checking or choosing and restores graph refs before resaving', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const autosave = source('src/features/canvas/state/useCanvasAutosave.ts')
    const styles = source('src/features/canvas/canvas.css')

    expect(graph).toContain("accountId: session?.user?.id || ''")
    expect(graph).toContain('enabled: !readOnly')
    expect(graph).toContain("const offlineRecoveryBlocking = autosave.offlineRecoveryState !== 'none'")
    expect(graph).toContain('const writeLocked = readOnly || productionSyncing || offlineRecoveryBlocking')
    expect(graph).toContain('nodesRef.current = nextNodes')
    expect(graph).toContain('edgesRef.current = nextEdges')
    expect(graph).toContain('viewportRef.current = nextViewport')
    expect(graph).toContain('正在检查本地未同步版本')
    expect(autosave).toContain("choice: 'local'")
    expect(autosave).toContain("summaryRef.current = '恢复本地未同步版本'")
    expect(styles).toContain('.nori-canvas-save-state.is-offline')
    expect(styles).toContain('.nori-canvas-offline-recovery-meta')
  })
})
