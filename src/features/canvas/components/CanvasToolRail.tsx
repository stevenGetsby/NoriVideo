'use client'

import type { CSSProperties } from 'react'
import {
  ChevronDown,
  OrganizeLayoutIcon,
  CircleHelp,
  Focus,
  FolderOpen,
  ImageIcon,
  Map,
  Minus,
  Plus,
  Rows3,
  Upload,
  Video,
  Box,
  Boxes,
  Clapperboard,
  ListVideo,
  Type,
} from '@/components/ui/icons'
import type { StoryNodeType } from '@/lib/interactive/types'
import { CANVAS_ADD_NODE_ITEMS, type CanvasNodeMenuType } from '../editor-types'
import { STORY_NODE_HUES, STORY_NODE_ICONS } from '../story/StoryCanvasContext'
import type { CanvasOrganizeMode } from '../actions/layout'
import { CanvasOrganizeMenu, canvasOrganizeOption } from './CanvasOrganizeMenu'

const ICONS = { text: Type, image: ImageIcon, video: Video, box3d: Box, studio3d: Clapperboard, playlist: ListVideo, video_edit: Video }

function canvasControlTitle(label: string, disabled: boolean) {
  return disabled ? `${label} · 请先创建画布` : label
}

export function CanvasAddPanel({ storyItems, onAddNode, onUpload }: {
  storyItems?: ReadonlyArray<{ type: StoryNodeType; label: string; description: string }>
  onAddNode: (type: CanvasNodeMenuType) => void
  onUpload: () => void
}) {
  return (
    <div className="nori-canvas-add-panel">
      {storyItems?.length ? <>
        <div>剧情节点</div>
        <ul className="is-story">
          {storyItems.map((item) => {
            const Icon = STORY_NODE_ICONS[item.type]
            return <li key={item.type} style={{ '--story-hue': STORY_NODE_HUES[item.type] } as CSSProperties}><button type="button" onClick={() => onAddNode(item.type)}><Icon /><span>{item.label}<small>{item.description}</small></span></button></li>
          })}
        </ul>
      </> : null}
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
        {editable ? <button type="button" className={`nori-canvas-project-assets-rail-action${assetsOpen ? ' is-open' : ''}`} title="作品资产" onClick={onToggleAssets}><Boxes /></button> : null}
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
  organizeMode: CanvasOrganizeMode
  organizeOpen: boolean
  canOrganize: boolean
  disabled?: boolean
  onToggleMinimap: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onResetViewport: () => void
  onToggleOrganize: () => void
  onOrganize: (mode: CanvasOrganizeMode) => void
}) {
  const organizeLabel = canvasOrganizeOption(organizeMode).label
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
          <button type="button" className="nori-canvas-organize-primary" title={canvasControlTitle(`一键整理 · ${organizeLabel}`, disabled)} disabled={disabled} onClick={() => onOrganize(organizeMode)}><OrganizeLayoutIcon kind={organizeMode} /><em>一键整理</em></button>
          <button type="button" className={organizeOpen ? 'is-active' : ''} title={canvasControlTitle('选择整理方式', disabled)} aria-haspopup="menu" aria-expanded={organizeOpen} disabled={disabled} onClick={onToggleOrganize}><ChevronDown /></button>
        </div>
      </> : null}
      {canOrganize && organizeOpen && !disabled ? <CanvasOrganizeMenu mode={organizeMode} onOrganize={onOrganize} onResetViewport={onResetViewport} /> : null}
    </div>
  )
}
