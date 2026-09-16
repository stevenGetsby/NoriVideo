'use client'

import {
  ChevronDown,
  CircleHelp,
  Focus,
  FolderOpen,
  Grid2X2,
  ImageIcon,
  LayoutGrid,
  ListTree,
  Map,
  Minus,
  Plus,
  Rows3,
  RotateCcw,
  Upload,
  Video,
  Box,
  Boxes,
  Clapperboard,
  ListVideo,
  Type,
} from '@/components/ui/icons'
import { CANVAS_ADD_NODE_ITEMS, type CanvasNodeMenuType } from '../editor-types'

const ICONS = { text: Type, image: ImageIcon, video: Video, box3d: Box, studio3d: Clapperboard, playlist: ListVideo, video_edit: Video }

function canvasControlTitle(label: string, disabled: boolean) {
  return disabled ? `${label} · 请先创建画布` : label
}

export function CanvasAddPanel({ onAddNode, onUpload }: { onAddNode: (type: CanvasNodeMenuType) => void; onUpload: () => void }) {
  return (
    <div className="nori-canvas-add-panel">
      <div>添加节点</div>
      <ul>
        {CANVAS_ADD_NODE_ITEMS.map((item) => {
          const Icon = ICONS[item.icon]
          return <li key={item.type}><button type="button" onClick={() => onAddNode(item.type)}><Icon /><span>{item.label}<small>{item.description}</small></span></button></li>
        })}
        <li className="is-disabled" title="音频节点暂不支持新建，请通过下方“上传文件”添加"><button type="button" disabled><Rows3 /><span>音频<small>请通过上传文件添加</small></span></button></li>
      </ul>
      <div>添加资源</div>
      <button type="button" className="nori-canvas-add-upload" onClick={onUpload}><Upload /><span>上传文件</span></button>
    </div>
  )
}

export function CanvasToolRail({ editable, disabled = false, addOpen, assetsOpen, onToggleAdd, onToggleAssets, onOpenLibrary, onUpload, onHelp }: { editable: boolean; disabled?: boolean; addOpen: boolean; assetsOpen: boolean; onToggleAdd: () => void; onToggleAssets: () => void; onOpenLibrary: () => void; onUpload: () => void; onHelp: () => void }) {
  return (
    <div className={`nori-canvas-tool-rail${disabled ? ' is-disabled' : ''}`} aria-label="画布工具栏">
      {editable || disabled ? <>
        <button type="button" className={addOpen ? 'is-primary is-open' : 'is-primary'} title={canvasControlTitle('添加节点', disabled)} disabled={disabled} onClick={onToggleAdd}><Plus /></button>
        <i />
        {editable ? <button type="button" className={`nori-canvas-project-assets-rail-action${assetsOpen ? ' is-open' : ''}`} title="项目资产" onClick={onToggleAssets}><Boxes /></button> : null}
        <button type="button" title={canvasControlTitle('从素材库选择', disabled)} disabled={disabled} onClick={onOpenLibrary}><FolderOpen /></button>
        <button type="button" title={canvasControlTitle('本地上传', disabled)} disabled={disabled} onClick={onUpload}><Upload /></button>
        <i />
      </> : null}
      <button type="button" title={canvasControlTitle('帮助', disabled)} disabled={disabled} onClick={onHelp}><CircleHelp /></button>
    </div>
  )
}

export function CanvasViewportControls({
  minimapVisible,
  zoom,
  organizeMode,
  organizeOpen,
  canOrganize,
  disabled = false,
  onToggleMinimap,
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetViewport,
  onToggleOrganize,
  onOrganize,
}: {
  minimapVisible: boolean
  zoom: number
  organizeMode: 'grid' | 'horizontal' | 'vertical'
  organizeOpen: boolean
  canOrganize: boolean
  disabled?: boolean
  onToggleMinimap: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onResetViewport: () => void
  onToggleOrganize: () => void
  onOrganize: (mode: 'grid' | 'horizontal' | 'vertical') => void
}) {
  const OrganizeIcon = organizeMode === 'horizontal' ? ListTree : organizeMode === 'vertical' ? Rows3 : LayoutGrid
  const organizeLabel = organizeMode === 'horizontal' ? '按连线横向' : organizeMode === 'vertical' ? '按连线纵向' : '网格整理'
  return (
    <div className={`nori-canvas-viewport-controls${disabled ? ' is-disabled' : ''}`} aria-label="画布视图控制">
      <button type="button" className={minimapVisible ? 'is-active' : ''} title={canvasControlTitle('画布小地图', disabled)} disabled={disabled} onClick={onToggleMinimap}><Map /></button>
      <span />
      <button type="button" title={canvasControlTitle('缩小', disabled)} disabled={disabled} onClick={onZoomOut}><Minus /></button>
      <b>{Math.round(zoom * 100)}%</b>
      <button type="button" title={canvasControlTitle('放大', disabled)} disabled={disabled} onClick={onZoomIn}><Plus /></button>
      <button type="button" title={canvasControlTitle('适应画布', disabled)} disabled={disabled} onClick={onFitView}><Focus /></button>
      {canOrganize ? <>
        <span />
        <div className="nori-canvas-organize-controls">
          <button type="button" className="nori-canvas-organize-primary" title={canvasControlTitle(`一键整理 · ${organizeLabel}`, disabled)} disabled={disabled} onClick={() => onOrganize(organizeMode)}><OrganizeIcon /><em>一键整理</em></button>
          <button type="button" className={organizeOpen ? 'is-active' : ''} title={canvasControlTitle('选择整理方式', disabled)} disabled={disabled} onClick={onToggleOrganize}><ChevronDown /></button>
        </div>
      </> : null}
      {canOrganize && organizeOpen && !disabled ? (
        <div className="nori-canvas-organize-menu">
          <button type="button" className={organizeMode === 'grid' ? 'is-active' : ''} onClick={() => onOrganize('grid')}><Grid2X2 /><span>网格整理<small>保持相对位置去重叠对齐</small></span></button>
          <button type="button" className={organizeMode === 'horizontal' ? 'is-active' : ''} onClick={() => onOrganize('horizontal')}><ListTree /><span>按连线横向<small>沿连线从左到右分层</small></span></button>
          <button type="button" className={organizeMode === 'vertical' ? 'is-active' : ''} onClick={() => onOrganize('vertical')}><Rows3 /><span>按连线纵向<small>沿连线从上到下分层</small></span></button>
          <i />
          <button type="button" title="重置视图" onClick={onResetViewport}><RotateCcw /><span>重置视图<small>回到画布原点与 100% 缩放</small></span></button>
        </div>
      ) : null}
    </div>
  )
}
