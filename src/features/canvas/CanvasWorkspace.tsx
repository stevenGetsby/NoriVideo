'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import CanvasGraph from './CanvasGraph'
import { canvasApi } from './api/client'
import { EmptyCanvasChrome, EmptyCanvasSurfaceControls } from './components/EmptyCanvasChrome'
import { CanvasManagementDialog, type CanvasManagementIntent } from './components/CanvasManagementDialog'
import { canEditInfiniteCanvas } from './permissions'
import type { Canvas, CanvasProjectOption } from './types'
import './canvas.css'

export function CanvasWorkspace({
  projectId,
  projectName,
  initialCanvasId,
  initialNodeId,
  routeBase,
  projectOptions,
  onSelectProject,
  canvasHomeHref,
  createProjectHref,
}: {
  projectId: string
  projectName: string
  initialCanvasId?: string
  initialNodeId?: string
  routeBase?: string
  projectOptions?: CanvasProjectOption[]
  onSelectProject?: (projectId: string) => void
  canvasHomeHref?: string
  createProjectHref?: string
}) {
  const router = useRouter()
  const { data: session } = useSession()
  const canEdit = canEditInfiniteCanvas(session?.user)
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [managementIntent, setManagementIntent] = useState<CanvasManagementIntent | null>(null)
  const [managementBusy, setManagementBusy] = useState(false)
  const [managementError, setManagementError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRouteBase = routeBase || `/workflow/${projectId}/workbench-premium2/canvas`

  const selectCanvas = useCallback((canvasId: string, navigate = true) => {
    setActiveId(canvasId)
    try {
      window.localStorage.setItem(`nori-canvas-active:${projectId}`, canvasId)
    } catch {
      // Canvas selection must remain usable when storage is blocked by the
      // browser, an embedded WebView policy, or private browsing settings.
    }
    if (navigate) router.replace(`${canvasRouteBase}/${canvasId}`)
  }, [canvasRouteBase, projectId, router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await canvasApi.list(projectId)
      setCanvases(list)
      const storageKey = `nori-canvas-active:${projectId}`
      let remembered: string | null = null
      try {
        remembered = window.localStorage.getItem(storageKey)
      } catch {
        // Fall back to the requested or first canvas when storage is blocked.
      }
      const nextId = list.some((canvas) => canvas.id === initialCanvasId)
        ? initialCanvasId!
        : list.some((canvas) => canvas.id === remembered)
          ? remembered!
          : list[0]?.id || ''
      if (nextId) selectCanvas(nextId, initialCanvasId !== nextId)
      else setActiveId('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载画布失败')
    } finally {
      setLoading(false)
    }
  }, [initialCanvasId, projectId, selectCanvas])

  useEffect(() => { void load() }, [load])

  const closeManagementDialog = useCallback(() => {
    if (managementBusy) return
    setManagementIntent(null)
    setManagementError(null)
  }, [managementBusy])

  const requestCreateCanvas = () => {
    if (!canEdit || managementBusy) return
    setManagementError(null)
    setManagementIntent({ type: 'create', defaultTitle: `画布 ${canvases.length + 1}` })
  }

  const createCanvas = async (title: string) => {
    if (!canEdit || managementBusy) return
    setManagementBusy(true)
    setManagementError(null)
    try {
      const created = await canvasApi.create(projectId, { title })
      setCanvases((current) => [created, ...current])
      setManagementIntent(null)
      selectCanvas(created.id)
    } catch (createError) {
      setManagementError(createError instanceof Error ? createError.message : '创建画布失败')
    } finally {
      setManagementBusy(false)
    }
  }

  const activeCanvas = canvases.find((canvas) => canvas.id === activeId) || null
  const requestRenameCanvas = () => {
    if (!canEdit || !activeCanvas || managementBusy) return
    setManagementError(null)
    setManagementIntent({ type: 'rename', canvas: activeCanvas })
  }

  const renameCanvas = async (title: string) => {
    if (!canEdit || !activeCanvas || managementBusy) return
    setManagementBusy(true)
    setManagementError(null)
    try {
      const updated = await canvasApi.patch(projectId, activeCanvas.id, { title })
      setCanvases((current) => current.map((canvas) => canvas.id === updated.id ? { ...updated, nodeCount: canvas.nodeCount } : canvas))
      setManagementIntent(null)
    } catch (renameError) {
      setManagementError(renameError instanceof Error ? renameError.message : '重命名画布失败')
    } finally {
      setManagementBusy(false)
    }
  }

  const requestDeleteCanvas = () => {
    if (!canEdit || !activeCanvas || managementBusy) return
    setManagementError(null)
    setManagementIntent({ type: 'delete', canvas: activeCanvas })
  }

  const deleteCanvas = async () => {
    if (!canEdit || !activeCanvas || managementBusy) return
    setManagementBusy(true)
    setManagementError(null)
    try {
      await canvasApi.remove(projectId, activeCanvas.id)
      const remaining = canvases.filter((canvas) => canvas.id !== activeCanvas.id)
      setCanvases(remaining)
      setManagementIntent(null)
      if (remaining[0]) {
        selectCanvas(remaining[0].id)
      } else {
        setActiveId('')
        try {
          window.localStorage.removeItem(`nori-canvas-active:${projectId}`)
        } catch {
          // The route transition is the source of truth; storage is optional.
        }
        router.replace(canvasRouteBase)
      }
    } catch (deleteError) {
      setManagementError(deleteError instanceof Error ? deleteError.message : '删除画布失败')
    } finally {
      setManagementBusy(false)
    }
  }

  const submitManagementDialog = async (title?: string) => {
    if (!managementIntent) return
    if (managementIntent.type === 'create' && title) await createCanvas(title)
    else if (managementIntent.type === 'rename' && title) await renameCanvas(title)
    else if (managementIntent.type === 'delete') await deleteCanvas()
  }

  if (loading) return <div className="nori-canvas-loading"><AppIcon name="loader" className="animate-spin" />正在加载无限画布…</div>
  if (error && canvases.length === 0) return <div className="nori-canvas-loading is-error"><span>{error}</span><button type="button" onClick={() => void load()}><AppIcon name="refresh" />重试加载</button></div>
  if (!activeCanvas) {
    return (
      <>
        <div className={`nori-canvas-workspace nori-canvas-onboarding nori-canvas-empty-shell${canEdit ? '' : ' is-readonly'}`} data-testid="empty-canvas-shell">
          <div className="nori-canvas-empty-grid" aria-hidden="true" />
          <EmptyCanvasChrome
            projectId={projectId}
            projectName={projectName}
            projectOptions={projectOptions}
            onSelectProject={onSelectProject}
            canvasHomeHref={canvasHomeHref}
          />
          <EmptyCanvasSurfaceControls />
          <section className="nori-canvas-onboarding-card" aria-labelledby="empty-canvas-title">
            <i><AppIcon name={canEdit ? 'clapperboard' : 'lock'} /></i>
            {!canEdit ? <span className="nori-canvas-onboarding-access"><AppIcon name="lock" />只读账号</span> : null}
            <h1 id="empty-canvas-title">{canEdit ? '创建第一张画布' : '暂无可查看的画布'}</h1>
            <p>{canEdit ? '把文本、图片、视频和项目素材自由连接成可执行的创作工作流。' : '当前账号拥有查看权限，但项目还没有画布。请联系管理账号或分镜师创建。'}</p>
            {canEdit ? <button type="button" disabled={managementBusy} onClick={requestCreateCanvas}><AppIcon name="plus" />创建第一张画布</button> : null}
            {error ? <small>{error}</small> : null}
          </section>
        </div>
        <CanvasManagementDialog intent={managementIntent} busy={managementBusy} error={managementError} onClose={closeManagementDialog} onSubmit={submitManagementDialog} />
      </>
    )
  }

  return (
    <>
      <CanvasGraph
        projectId={projectId}
        projectName={projectName}
        canvasId={activeCanvas.id}
        focusNodeId={initialNodeId}
        canvases={canvases}
        onSelectCanvas={selectCanvas}
        onCreateCanvas={requestCreateCanvas}
        onRenameCanvas={requestRenameCanvas}
        onDeleteCanvas={requestDeleteCanvas}
        projectOptions={projectOptions}
        onSelectProject={onSelectProject}
        canvasHomeHref={canvasHomeHref}
        createProjectHref={createProjectHref}
        onCanvasUpdated={(updated) => setCanvases((current) => current.map((canvas) => canvas.id === updated.id ? { ...updated, nodeCount: updated.nodeCount ?? canvas.nodeCount } : canvas))}
      />
      <CanvasManagementDialog intent={managementIntent} busy={managementBusy} error={managementError} onClose={closeManagementDialog} onSubmit={submitManagementDialog} />
    </>
  )
}
