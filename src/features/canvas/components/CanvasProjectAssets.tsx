'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useSession } from 'next-auth/react'
import Box from 'lucide-react/dist/esm/icons/box.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import Film from 'lucide-react/dist/esm/icons/film.js'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.js'
import ImageIcon from 'lucide-react/dist/esm/icons/image.js'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.js'
import Music2 from 'lucide-react/dist/esm/icons/music-2.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { MediaImage } from '@/components/media/MediaImage'
import type { FrameosMaterialItem, MaterialType } from '@/components/frameos/materials/contracts'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  FRAMEOS_ASSET_CATEGORIES,
  FRAMEOS_ASSET_CATEGORY_LABELS,
  frameosAssetCategoryFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import { CanvasMenuPortal } from './CanvasMenuPortal'

export const CANVAS_MATERIAL_DRAG_TYPE = 'application/x-nori-canvas-material'
export const CANVAS_WORKFLOW_DRAG_TYPE = 'application/x-nori-canvas-workflow'

export type CanvasWorkflowTemplate = {
  id: string
  projectId: string
  name: string
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  createdAt: string
  updatedAt: string
}

export type CanvasProjectAssetMenuState = {
  kind: 'material' | 'workflow'
  id: string
  x: number
  y: number
}

const FILTERS: Array<{ value: 'all' | MaterialType; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'model3d', label: '3D' },
]

function MaterialIcon({ type }: { type: MaterialType }) {
  const Icon = type === 'video' ? Film : type === 'audio' ? Music2 : type === 'model3d' ? Box : ImageIcon
  return <Icon />
}

export function CanvasProjectAssetContextMenu({
  state,
  canEditAssets,
  canEditWorkflows,
  deleteConfirmId,
  onRenameMaterial,
  onDeleteMaterial,
  onLoadWorkflow,
  onDeleteWorkflow,
}: {
  state: CanvasProjectAssetMenuState
  canEditAssets: boolean
  canEditWorkflows: boolean
  deleteConfirmId: string | null
  onRenameMaterial: () => void
  onDeleteMaterial: () => void
  onLoadWorkflow: () => void
  onDeleteWorkflow: () => void
}) {
  if (state.kind === 'material' && !canEditAssets) return null
  if (state.kind === 'workflow' && !canEditWorkflows) return null
  return (
    <CanvasMenuPortal>
      <div
        className="nori-canvas-context-menu"
        data-canvas-project-assets-menu
        role="menu"
        aria-label={state.kind === 'material' ? '本地资产操作' : '工作流操作'}
        style={{ left: state.x, top: state.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {state.kind === 'material' ? <>
          <button type="button" role="menuitem" onClick={onRenameMaterial}><Pencil /><span>重命名</span></button>
          <i />
          <button type="button" role="menuitem" className="is-danger" onClick={onDeleteMaterial}><Trash2 /><span>{deleteConfirmId === state.id ? '确认删除资产' : '删除资产'}</span></button>
        </> : <>
          <button type="button" role="menuitem" onClick={onLoadWorkflow}><GitBranch /><span>加载到画布中央</span></button>
          <i />
          <button type="button" role="menuitem" className="is-danger" onClick={onDeleteWorkflow}><Trash2 /><span>{deleteConfirmId === state.id ? '确认删除工作流' : '删除工作流'}</span></button>
        </>}
      </div>
    </CanvasMenuPortal>
  )
}

export function CanvasProjectAssets({
  projectId,
  onInsert,
  onInsertWorkflow,
  onClose,
  refreshKey = 0,
}: {
  projectId: string
  onInsert: (material: FrameosMaterialItem) => void
  onInsertWorkflow: (template: CanvasWorkflowTemplate) => void
  onClose: () => void
  refreshKey?: number
}) {
  const { data: session } = useSession()
  const canEditAssets = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])
  const canEditWorkflows = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['canvasWrite'])
  const [materials, setMaterials] = useState<FrameosMaterialItem[]>([])
  const [templates, setTemplates] = useState<CanvasWorkflowTemplate[]>([])
  const [section, setSection] = useState<'assets' | 'workflows'>('assets')
  const [filter, setFilter] = useState<'all' | MaterialType>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | FrameosAssetCategory>('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<CanvasProjectAssetMenuState | null>(null)

  const load = useCallback(async (sync = false) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ projectId, available: '1', limit: '500' })
      if (sync) params.set('sync', '1')
      const response = await apiFetch(`/api/frameos/materials?${params}`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载项目资产失败'))
      const payload = await response.json() as { materials?: FrameosMaterialItem[] }
      setMaterials(Array.isArray(payload.materials) ? payload.materials : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载项目资产失败')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/canvas/templates`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载工作流失败'))
      const payload = await response.json() as { templates?: CanvasWorkflowTemplate[] }
      setTemplates(Array.isArray(payload.templates) ? payload.templates : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载工作流失败')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load(true) }, [load])
  useEffect(() => { if (section === 'workflows') void loadTemplates() }, [loadTemplates, refreshKey, section])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (contextMenu) {
        event.preventDefault()
        setContextMenu(null)
        setDeleteConfirmId(null)
      } else if (deleteConfirmId) {
        setDeleteConfirmId(null)
      } else if (renamingId) {
        setRenamingId(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [contextMenu, deleteConfirmId, onClose, renamingId])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-canvas-project-assets-menu]')) return
      setContextMenu(null)
      setDeleteConfirmId(null)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [contextMenu])

  const openContextMenu = (event: ReactMouseEvent, kind: CanvasProjectAssetMenuState['kind'], id: string) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 164
    const menuHeight = 78
    setDeleteConfirmId(null)
    setContextMenu({
      kind,
      id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }

  const startMaterialRename = (material: FrameosMaterialItem) => {
    if (!canEditAssets || material.source !== 'upload') return
    setContextMenu(null)
    setDeleteConfirmId(null)
    setRenamingId(material.id)
    setRenameValue(material.title || '未命名素材')
  }

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return materials.filter((material) => (
      (filter === 'all' || material.type === filter)
      && (projectFilter === 'all' || material.projectId === projectFilter)
      && (categoryFilter === 'all' || frameosAssetCategoryFromMetadata(material.metadata) === categoryFilter)
      && (!keyword || `${material.title || ''} ${material.projectName || ''}`.toLowerCase().includes(keyword))
    ))
  }, [categoryFilter, filter, materials, projectFilter, query])

  const materialProjects = useMemo(() => Array.from(new Map(materials.map((material) => [
    material.projectId,
    { id: material.projectId, name: material.projectName || '项目素材' },
  ])).values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')), [materials])

  const visibleTemplates = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return templates.filter((template) => !keyword || template.name.toLowerCase().includes(keyword))
  }, [query, templates])

  const renameTemplate = async (templateId: string) => {
    const name = renameValue.replace(/\s+/g, ' ').trim()
    if (!name) return
    const response = await apiFetch(`/api/projects/${projectId}/canvas/templates/${templateId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    if (!response.ok) { setError(await readApiErrorMessage(response, '重命名工作流失败')); return }
    setTemplates((current) => current.map((item) => item.id === templateId ? { ...item, name } : item))
    setRenamingId(null)
  }

  const deleteTemplate = async (templateId: string) => {
    if (deleteConfirmId !== templateId) { setDeleteConfirmId(templateId); return }
    const response = await apiFetch(`/api/projects/${projectId}/canvas/templates/${templateId}`, { method: 'DELETE' })
    if (!response.ok) { setError(await readApiErrorMessage(response, '删除工作流失败')); return }
    setTemplates((current) => current.filter((item) => item.id !== templateId))
    setDeleteConfirmId(null)
    setContextMenu(null)
  }

  const renameMaterial = async (materialId: string) => {
    if (!canEditAssets) return
    const title = renameValue.replace(/\s+/g, ' ').trim()
    if (!title) return
    const response = await apiFetch(`/api/frameos/materials/${materialId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    if (!response.ok) { setError(await readApiErrorMessage(response, '重命名素材失败')); return }
    setMaterials((current) => current.map((item) => item.id === materialId ? { ...item, title } : item))
    setRenamingId(null)
  }

  const updateMaterialCategory = async (material: FrameosMaterialItem, assetCategory: FrameosAssetCategory) => {
    if (!canEditAssets || frameosAssetCategoryFromMetadata(material.metadata) === assetCategory) return
    const response = await apiFetch(`/api/frameos/materials/${material.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetCategory }),
    })
    if (!response.ok) {
      setError(await readApiErrorMessage(response, '更新资产归类失败'))
      return
    }
    const payload = await response.json() as { material?: FrameosMaterialItem }
    if (!payload.material) return
    setMaterials((current) => current.map((item) => item.id === material.id
      ? { ...item, ...payload.material, url: payload.material?.resultUrl || payload.material?.storageKey || item.url }
      : item))
  }

  const deleteMaterial = async (materialId: string) => {
    if (!canEditAssets) return
    if (deleteConfirmId !== materialId) { setDeleteConfirmId(materialId); return }
    const response = await apiFetch(`/api/frameos/materials/${materialId}`, { method: 'DELETE' })
    if (!response.ok) { setError(await readApiErrorMessage(response, '删除素材失败')); return }
    setMaterials((current) => current.filter((item) => item.id !== materialId))
    setDeleteConfirmId(null)
    setContextMenu(null)
    if (renamingId === materialId) setRenamingId(null)
  }

  return (
    <aside className="nori-canvas-project-assets" onPointerDown={(event) => event.stopPropagation()}>
      <header><span><strong>{section === 'assets' ? '项目资产' : '工作流模板'}</strong><small>{section === 'assets' ? `${materials.length} 项可用素材` : `${templates.length} 个可复用工作流`}</small></span><button type="button" title="关闭" onClick={onClose}><X /></button></header>
      <div className="nori-canvas-project-assets-sections"><button type="button" className={section === 'assets' ? 'is-active' : ''} onClick={() => { setContextMenu(null); setDeleteConfirmId(null); setSection('assets'); setQuery(''); void load() }}><Boxes />项目资产</button><button type="button" className={section === 'workflows' ? 'is-active' : ''} onClick={() => { setContextMenu(null); setDeleteConfirmId(null); setSection('workflows'); setQuery('') }}><GitBranch />工作流</button></div>
      <div className="nori-canvas-project-assets-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={section === 'assets' ? '搜索资产…' : '搜索工作流…'} /><button type="button" title="刷新" disabled={loading} onClick={() => void (section === 'assets' ? load(true) : loadTemplates())}><RefreshCw className={loading ? 'animate-spin' : ''} /></button></div>
      {section === 'assets' ? <div className="nori-canvas-project-assets-tabs">{FILTERS.map((item) => <button type="button" key={item.value} className={filter === item.value ? 'is-active' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div> : null}
      {section === 'assets' && materialProjects.length > 1 ? <label className="nori-canvas-project-assets-project"><span>来源项目</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">全部可读项目</option>{materialProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : null}
      {section === 'assets' ? <div className="nori-canvas-project-assets-tabs" aria-label="资产归类"><button type="button" className={categoryFilter === 'all' ? 'is-active' : ''} onClick={() => setCategoryFilter('all')}>全部归类</button>{FRAMEOS_ASSET_CATEGORIES.map((category) => <button type="button" key={category} className={categoryFilter === category ? 'is-active' : ''} onClick={() => setCategoryFilter(category)}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</button>)}</div> : null}
      <div className="nori-canvas-project-assets-list">
        {loading ? <div className="nori-canvas-project-assets-state"><LoaderCircle className="animate-spin" />{section === 'assets' ? '正在整理项目资产…' : '正在加载工作流…'}</div> : null}
        {!loading && error ? <div className="nori-canvas-project-assets-state is-error"><span>{error}</span><button type="button" onClick={() => void (section === 'assets' ? load() : loadTemplates())}>重试</button></div> : null}
        {!loading && !error && section === 'assets' && visible.length === 0 ? <div className="nori-canvas-project-assets-state"><ImageIcon />暂无匹配资产</div> : null}
        {!loading && !error && section === 'assets' ? visible.map((material) => {
          const src = toDisplayImageUrl(material.url)
          return (
            <article
              key={material.id}
              draggable
              title="拖到画布，或双击添加到视口中央"
              onDragStartCapture={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData(CANVAS_MATERIAL_DRAG_TYPE, JSON.stringify(material))
                event.dataTransfer.setData('text/plain', material.title || '项目资产')
              }}
              onDoubleClick={() => onInsert(material)}
              onContextMenu={(event) => {
                if (material.source === 'upload' && canEditAssets) openContextMenu(event, 'material', material.id)
              }}
            >
              <div className="nori-canvas-project-assets-thumb">
                {src && material.type === 'image' ? <MediaImage src={src} alt={material.title || '项目资产'} fill sizes="120px" draggable={false} style={{ objectFit: 'cover' }} /> : <MaterialIcon type={material.type} />}
                <span>{material.type === 'model3d' ? '3D' : material.type.toUpperCase()}</span>
              </div>
              <div>{canEditAssets && renamingId === material.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void renameMaterial(material.id)} onKeyDown={(event) => { if (event.key === 'Enter') void renameMaterial(material.id); if (event.key === 'Escape') setRenamingId(null) }} onDoubleClick={(event) => event.stopPropagation()} /> : <strong>{material.title || '未命名素材'}</strong>}<small>{material.projectName} · {material.source === 'production' ? '项目制作' : material.source === 'creative' ? '资产生成' : material.source === 'toolbox' ? '工具箱生成' : '本地上传'}</small>{canEditAssets ? <select className="nori-canvas-project-assets-category" aria-label={`${material.title || '未命名素材'}资产归类`} value={frameosAssetCategoryFromMetadata(material.metadata)} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void updateMaterialCategory(material, event.target.value as FrameosAssetCategory) }}>{FRAMEOS_ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select> : <small>{FRAMEOS_ASSET_CATEGORY_LABELS[frameosAssetCategoryFromMetadata(material.metadata)]}</small>}</div>
              {material.source === 'upload' && canEditAssets ? <div className="nori-canvas-workflow-actions"><button type="button" title="重命名" onClick={(event) => { event.stopPropagation(); startMaterialRename(material) }}><Pencil /></button><button type="button" className={deleteConfirmId === material.id ? 'is-confirm' : ''} title={deleteConfirmId === material.id ? '再次点击确认删除' : '删除本地上传'} onClick={(event) => { event.stopPropagation(); void deleteMaterial(material.id) }}>{deleteConfirmId === material.id ? <span>确认</span> : <Trash2 />}</button><button type="button" onClick={(event) => { event.stopPropagation(); onInsert(material) }}>添加</button></div> : <button type="button" onClick={() => onInsert(material)}>添加</button>}
            </article>
          )
        }) : null}
        {!loading && !error && section === 'workflows' && visibleTemplates.length === 0 ? <div className="nori-canvas-project-assets-state"><GitBranch />暂无工作流模板<br /><small>选中一个组，点击“保存工作流”创建</small></div> : null}
        {!loading && !error && section === 'workflows' ? visibleTemplates.map((template) => <article
          key={template.id}
          className="is-workflow"
          draggable
          title="拖到画布，或双击加载到视口中央"
          onDragStartCapture={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(CANVAS_WORKFLOW_DRAG_TYPE, JSON.stringify(template)); event.dataTransfer.setData('text/plain', template.name) }}
          onDoubleClick={() => onInsertWorkflow(template)}
          onContextMenu={(event) => { if (canEditWorkflows) openContextMenu(event, 'workflow', template.id) }}
        >
          <div className="nori-canvas-project-assets-thumb"><GitBranch /><span>FLOW</span></div>
          <div>{renamingId === template.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void renameTemplate(template.id)} onKeyDown={(event) => { if (event.key === 'Enter') void renameTemplate(template.id); if (event.key === 'Escape') setRenamingId(null) }} onDoubleClick={(event) => event.stopPropagation()} /> : <strong>{template.name}</strong>}<small>{template.nodes.length} 个节点 · {template.edges.length} 条连线</small></div>
          <div className="nori-canvas-workflow-actions"><button type="button" title="重命名" onClick={(event) => { event.stopPropagation(); setRenamingId(template.id); setRenameValue(template.name) }}><Pencil /></button><button type="button" className={deleteConfirmId === template.id ? 'is-confirm' : ''} title={deleteConfirmId === template.id ? '再次点击确认删除' : '删除'} onClick={(event) => { event.stopPropagation(); void deleteTemplate(template.id) }}>{deleteConfirmId === template.id ? <span>确认</span> : <Trash2 />}</button><button type="button" onClick={() => onInsertWorkflow(template)}>加载</button></div>
        </article>) : null}
      </div>
      <footer>{section === 'assets' ? '拖拽资产到画布任意位置，可重复使用且不会修改原资产。' : '拖拽工作流到任意位置；加载后生成独立副本。'}</footer>
      {contextMenu ? <CanvasProjectAssetContextMenu
        state={contextMenu}
        canEditAssets={canEditAssets}
        canEditWorkflows={canEditWorkflows}
        deleteConfirmId={deleteConfirmId}
        onRenameMaterial={() => {
          const material = materials.find((item) => item.id === contextMenu.id)
          if (material) startMaterialRename(material)
        }}
        onDeleteMaterial={() => { void deleteMaterial(contextMenu.id) }}
        onLoadWorkflow={() => {
          const template = templates.find((item) => item.id === contextMenu.id)
          if (!template) return
          setContextMenu(null)
          setDeleteConfirmId(null)
          onInsertWorkflow(template)
        }}
        onDeleteWorkflow={() => { void deleteTemplate(contextMenu.id) }}
      /> : null}
    </aside>
  )
}
