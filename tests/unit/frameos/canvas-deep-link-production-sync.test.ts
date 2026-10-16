import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('canvas deep links and production sync contracts', () => {
  it('resolves /canvas/:canvasId and forwards the canvas id into the workspace', () => {
    const page = readSource('src/app/[locale]/workflow/[projectId]/workbench-premium2/[[...segments]]/page.tsx')
    const workflow = readSource('src/components/frameos/FosWorkflowClient.tsx')

    expect(page).toContain("if (segments[0] === 'canvas' && segments[1]) return { view: 'canvas', focus: segments[1] }")
    expect(workflow).toContain("initialCanvasId={focus && focus !== 'canvas' ? focus : undefined}")
  })

  it('prefers a valid initial canvas id and keeps canvas switches reflected in the URL', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const selectionStart = workspace.indexOf('const selectCanvas = useCallback')
    const loadStart = workspace.indexOf('const load = useCallback')
    const loadEnd = workspace.indexOf('useEffect(() => { void load() }, [load])', loadStart)
    const selection = workspace.slice(selectionStart, loadStart)
    const load = workspace.slice(loadStart, loadEnd)

    expect(selectionStart).toBeGreaterThan(-1)
    expect(loadStart).toBeGreaterThan(selectionStart)
    expect(loadEnd).toBeGreaterThan(loadStart)
    expect(selection).toContain('window.localStorage.setItem(`nori-canvas-active:${projectId}`, canvasId)')
    expect(selection).toContain('try {')
    expect(selection).toContain('Canvas selection must remain usable when storage is blocked')
    expect(workspace).toContain('const canvasRouteBase = routeBase || `/workflow/${projectId}/workbench-premium2/canvas`')
    expect(selection).toContain('router.replace(`${canvasRouteBase}/${canvasId}`)')

    const initialChoice = load.indexOf('list.some((canvas) => canvas.id === initialCanvasId)')
    const rememberedChoice = load.indexOf('list.some((canvas) => canvas.id === remembered)')
    const firstCanvasFallback = load.indexOf("list[0]?.id || ''")
    expect(initialChoice).toBeGreaterThan(-1)
    expect(rememberedChoice).toBeGreaterThan(initialChoice)
    expect(firstCanvasFallback).toBeGreaterThan(rememberedChoice)
    expect(load).toContain('if (nextId) selectCanvas(nextId, initialCanvasId !== nextId)')
    expect(workspace).toContain('onSelectCanvas={selectCanvas}')
  })

  it('allows deleting the final canvas and returns the project to onboarding', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')
    const deleteStart = workspace.indexOf('const deleteCanvas = async () => {')
    const deleteEnd = workspace.indexOf('if (loading)', deleteStart)
    const implementation = workspace.slice(deleteStart, deleteEnd)

    expect(implementation).not.toContain('canvases.length <= 1')
    expect(implementation).toContain("setActiveId('')")
    expect(implementation).toContain('window.localStorage.removeItem(`nori-canvas-active:${projectId}`)')
    expect(implementation).toContain('The route transition is the source of truth; storage is optional')
    expect(implementation).toContain('router.replace(canvasRouteBase)')
    expect(chrome).not.toContain('disabled={canvases.length <= 1}')
    expect(chrome).toContain("canvases.length === 1 ? '删除后回到画布创建引导'")
  })

  it('shows the project sync action and disables it for read-only canvas users', () => {
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const syncButtonStart = chrome.indexOf('<button type="button" className="nori-canvas-sync-button"')
    const syncButtonEnd = chrome.indexOf('</button>', syncButtonStart)
    const syncButton = chrome.slice(syncButtonStart, syncButtonEnd)

    expect(syncButtonStart).toBeGreaterThan(-1)
    expect(syncButtonEnd).toBeGreaterThan(syncButtonStart)
    expect(syncButton).toContain("disabled={!canSyncProduction || syncingProduction}")
    expect(syncButton).toContain('onClick={() => { onSyncProduction(); setMenu(null) }}')
    expect(syncButton).toContain("syncingProduction ? '同步中' : '同步作品'")
    expect(graph).toContain("import { canEditInfiniteCanvas } from './permissions'")
    expect(graph).toContain('const readOnly = !canEditInfiniteCanvas(session?.user)')
    expect(graph).toContain('canSyncProduction={!readOnly}')
  })

  it('posts to production-sync and replaces the editor graph with the response', () => {
    const api = readSource('src/features/canvas/api/client.ts')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const syncStart = graph.indexOf('const syncProduction = useCallback')
    const syncEnd = graph.indexOf('const ensureNodeCapacity', syncStart)
    const implementation = graph.slice(syncStart, syncEnd)

    expect(api).toContain('`/api/projects/${projectId}/canvas/${canvasId}/production-sync`')
    expect(api).toContain("method: 'POST'")
    expect(api).toContain('body: JSON.stringify(input)')
    expect(syncStart).toBeGreaterThan(-1)
    expect(syncEnd).toBeGreaterThan(syncStart)
    expect(implementation.indexOf('await prepareProductionSync()')).toBeLessThan(
      implementation.indexOf('await canvasApi.syncProduction(projectId, initialGraph.canvas.id, syncInput)'),
    )
    expect(implementation).toContain('await acceptProductionSyncRevision(syncInput.expectedRevision, graph.canvas.revision)')
    expect(implementation).toContain('const syncedNodes = graph.nodes.map(canvasNodeToFlow)')
    expect(implementation).toContain('const syncedEdges = graph.edges.map(canvasEdgeToFlow)')
    expect(implementation).toContain('setNodes(syncedNodes)')
    expect(implementation).toContain('setEdges(syncedEdges)')
    expect(implementation).toContain('canvasRef.current = graph.canvas')
    expect(implementation).toContain('onCanvasUpdated?.(graph.canvas)')
  })

  it('freezes all canvas write interaction while a production sync is in flight', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(graph).toContain('const writeLocked = readOnly || productionSyncing')
    expect(graph).toMatch(/if \(productionSyncing \|\| offlineRecoveryBlocking\) \{\s+if \(shouldBlockCanvasShortcutWhileLocked\(event\)\) event\.preventDefault\(\)/)
    expect(graph).toContain('nodesDraggable={!writeLocked}')
    expect(graph).toContain('nodesConnectable={!writeLocked}')
    expect(graph).toContain('className="nori-canvas-sync-lock"')
    expect(styles).toContain('.nori-canvas-sync-lock {')
    expect(styles).toContain('z-index: 200;')
    expect(styles).toContain('cursor: wait;')
  })
})
