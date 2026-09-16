'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react'
import { Clapperboard, FolderOpen, GitBranch, ImageIcon, Music2, Sparkles, Upload } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MentionPromptEditor, type MentionPromptAsset } from '@/components/frameos/materials/MentionPromptEditor'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { useCanvasEditor } from '../CanvasEditorContext'
import type { CanvasFlowNode, CanvasFlowNodeData } from '../editor-types'
import { CANVAS_REPLACE_CONTENT_EVENT } from './CreativeNode'

export const CANVAS_VIDEO_EDIT_MATERIAL_EVENT = 'nori:canvas-video-edit-material'
export const CANVAS_VIDEO_EDIT_SUBMIT_EVENT = 'nori:canvas-video-edit-submit'
export const CANVAS_VIDEO_EDIT_REFERENCE_EVENT = 'nori:canvas-video-edit-reference'

function formatMilliseconds(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--:--.--'
  const totalSeconds = Math.max(0, value / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const centiseconds = Math.floor((totalSeconds % 1) * 100)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function sourceUrlFor(data: CanvasFlowNodeData, incoming: CanvasFlowNode | null): string | null {
  const raw = incoming
    ? incoming.data.videoUrl || incoming.data.contentUrl
    : data.videoUrl || data.contentUrl
  return toDisplayImageUrl(raw || null)
}

function sourceLabel(data: CanvasFlowNodeData, incoming: CanvasFlowNode | null) {
  if (incoming) return `已接入：${incoming.data.title || '视频节点'}`
  if (data.videoEdit?.sourceKind === 'material') return '素材库视频'
  if (data.videoEdit?.sourceKind === 'upload') return '本地视频'
  return '尚未选择源视频'
}

export function VideoEditNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useCanvasEditor()
  const { generationAllowed } = useAccountBalance()
  const graphNodes = useStore((state) => state.nodes) as CanvasFlowNode[]
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragFrameRef = useRef<{ role: 'start' | 'end' | 'playhead'; frameMs: number } | null>(null)
  const editConfig = data.videoEdit || { sourceKind: 'none' as const, generateAudio: true }
  const incoming = useMemo(
    () => editConfig.sourceKind === 'node' && editConfig.sourceNodeId
      ? graphNodes.find((node) => node.id === editConfig.sourceNodeId) || null
      : null,
    [editConfig.sourceKind, editConfig.sourceNodeId, graphNodes],
  )
  const sourceUrl = sourceUrlFor(data, incoming)
  const references = Array.isArray(editConfig.references) ? editConfig.references : []
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [generateAudio, setGenerateAudio] = useState(editConfig.generateAudio !== false)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [dragRole, setDragRole] = useState<'start' | 'end' | 'playhead' | null>(null)
  const [draftFrameMs, setDraftFrameMs] = useState<number | null>(null)
  const running = data.__server?.status === 'RUNNING'
  const startMs = editConfig.startMs ?? null
  const endMs = editConfig.endMs ?? null
  const canSubmit = generationAllowed
    && !editor.readOnly
    && !running
    && Boolean(sourceUrl)
    && Boolean(prompt.trim())
    && typeof startMs === 'number'
    && typeof endMs === 'number'
    && endMs - startMs >= 4_000

  useEffect(() => {
    setPrompt(data.prompt || '')
  }, [data.prompt])
  useEffect(() => {
    setGenerateAudio(editConfig.generateAudio !== false)
  }, [editConfig.generateAudio])

  const mentionAssets = useMemo<MentionPromptAsset[]>(() => {
    const assets = graphNodes
      .filter((node) => node.type === 'image' || node.type === 'audio')
      .map((node) => ({
        id: node.id,
        name: node.data.title || (node.type === 'image' ? '图片素材' : '音频素材'),
        imageUrl: node.data.imageUrl || node.data.contentUrl || null,
        mediaType: node.type as 'image' | 'audio',
      }))
    for (const reference of references) {
      if (assets.some((asset) => asset.id === reference.id)) continue
      assets.push({
        id: reference.id,
        name: reference.title,
        imageUrl: reference.previewUrl || null,
        mediaType: reference.type === 'audio' ? 'audio' : 'image',
      })
    }
    return assets
  }, [graphNodes, references])

  const selectMentionAsset = (asset: MentionPromptAsset) => {
    if (references.some((reference) => reference.id === asset.id)) return
    const sourceNode = graphNodes.find((node) => node.id === asset.id)
    const type = asset.mediaType === 'audio' ? 'audio' : 'image'
    editor.updateNodeData(id, {
      videoEdit: {
        ...editConfig,
        references: [
          ...references,
          {
            id: asset.id || crypto.randomUUID(),
            title: asset.name,
            type,
            previewUrl: asset.imageUrl || null,
            url: sourceNode?.data.contentUrl || sourceNode?.data.imageUrl || sourceNode?.data.audioUrl || asset.imageUrl || null,
            materialId: sourceNode?.data.materialId || null,
          },
        ],
      },
    })
  }

  const removeReference = (referenceId: string) => {
    editor.updateNodeData(id, {
      videoEdit: {
        ...editConfig,
        references: references.filter((reference) => reference.id !== referenceId),
      },
    })
  }

  const openReferencePicker = (type: 'image' | 'audio') => {
    window.dispatchEvent(new CustomEvent(CANVAS_VIDEO_EDIT_REFERENCE_EVENT, { detail: { nodeId: id, type } }))
  }

  const setFrame = (field: 'startMs' | 'endMs') => {
    const video = videoRef.current
    if (!video) return
    const value = Math.max(0, Math.round(video.currentTime * 1_000))
    editor.updateNodeData(id, { videoEdit: { ...editConfig, [field]: value } })
  }

  const submit = () => {
    if (!canSubmit || startMs === null || endMs === null) return
    const nextPrompt = prompt.trim()
    editor.updateNodeData(id, {
      prompt: nextPrompt,
      videoEdit: { ...editConfig, startMs, endMs, generateAudio },
    })
    window.dispatchEvent(new CustomEvent(CANVAS_VIDEO_EDIT_SUBMIT_EVENT, {
      detail: { nodeId: id, prompt: nextPrompt, startMs, endMs, generateAudio },
    }))
  }

  const ratio = (value: number | null | undefined) => durationMs > 0 && typeof value === 'number'
    ? Math.max(0, Math.min(1, value / durationMs))
    : 0
  const displayStartMs = dragRole === 'start' && draftFrameMs !== null ? draftFrameMs : startMs
  const displayEndMs = dragRole === 'end' && draftFrameMs !== null ? draftFrameMs : endMs
  const startRatio = ratio(displayStartMs)
  const endRatio = ratio(displayEndMs)
  const currentRatio = ratio(currentMs)

  const frameAtClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track || durationMs <= 0) return null
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return null
    const nextRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(nextRatio * durationMs)
  }

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!sourceUrl || running || editor.readOnly) return
    const target = event.target as HTMLElement
    const role = target.dataset.role as 'start' | 'end' | 'playhead' | undefined
    if (role !== 'start' && role !== 'end' && role !== 'playhead') {
      const frameMs = frameAtClientX(event.clientX)
      if (frameMs !== null && videoRef.current) {
        videoRef.current.currentTime = frameMs / 1_000
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const frameMs = frameAtClientX(event.clientX)
    if (frameMs === null) return
    dragFrameRef.current = { role, frameMs }
    setDragRole(role)
    setDraftFrameMs(frameMs)
    trackRef.current?.setPointerCapture?.(event.pointerId)
    if (role === 'playhead' && videoRef.current) {
      videoRef.current.currentTime = frameMs / 1_000
    }
  }

  const handleTimelinePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragFrameRef.current
    if (!drag) return
    const frameMs = frameAtClientX(event.clientX)
    if (frameMs === null) return
    let nextFrameMs = frameMs
    if (drag.role === 'start' && typeof endMs === 'number') {
      nextFrameMs = Math.min(frameMs, Math.max(0, endMs - 34))
    }
    if (drag.role === 'end' && typeof startMs === 'number') {
      nextFrameMs = Math.max(frameMs, startMs + 34)
    }
    dragFrameRef.current = { role: drag.role, frameMs: nextFrameMs }
    setDraftFrameMs(nextFrameMs)
    if (drag.role === 'playhead' && videoRef.current) {
      videoRef.current.currentTime = nextFrameMs / 1_000
    }
  }

  const handleTimelinePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragFrameRef.current
    if (!drag) return
    dragFrameRef.current = null
    setDragRole(null)
    setDraftFrameMs(null)
    if (trackRef.current?.hasPointerCapture(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId)
    }
    if (drag.role === 'start' || drag.role === 'end') {
      editor.updateNodeData(id, {
        videoEdit: {
          ...editConfig,
          [drag.role === 'start' ? 'startMs' : 'endMs']: drag.frameMs,
        },
      })
    }
  }

  const clearIncoming = () => {
    editor.updateNodeData(id, {
      videoEdit: { ...editConfig, sourceKind: 'none', sourceNodeId: null },
    })
  }

  return (
    <article className={`nori-canvas-node nori-canvas-video-edit-node${selected ? ' is-selected' : ''}${running ? ' is-running' : ''}`}>
      <NodeResizer isVisible={selected && !editor.readOnly} minWidth={420} minHeight={360} lineClassName="nori-canvas-resize-line" handleClassName="nori-canvas-resize-handle" />

      <header className="nori-canvas-video-edit-header">
        <span className="nori-canvas-video-edit-title"><Clapperboard />视频编辑</span>
        <span className="nori-canvas-video-edit-source-state">{sourceLabel(data, incoming)}</span>
      </header>

      <div className="nori-canvas-video-edit-source-actions nodrag">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(CANVAS_REPLACE_CONTENT_EVENT, { detail: { nodeId: id } }))}><Upload />上传</button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(CANVAS_VIDEO_EDIT_MATERIAL_EVENT, { detail: { nodeId: id } }))}><FolderOpen />素材库</button>
        <span><GitBranch />连接视频节点</span>
      </div>

      {incoming ? (
        <div className="nori-canvas-video-edit-incoming nodrag">
          <span>{incoming.data.title || '视频节点'}</span>
          <button type="button" onClick={clearIncoming}>断开</button>
        </div>
      ) : null}

      <div className="nori-canvas-video-edit-references nodrag">
        <button type="button" disabled={running || editor.readOnly} onClick={() => openReferencePicker('image')}><ImageIcon />参考图</button>
        <button type="button" disabled={running || editor.readOnly} onClick={() => openReferencePicker('audio')}><Music2 />参考音频</button>
        {references.map((reference) => (
          <span key={reference.id} title={reference.title}>
            {reference.type === 'audio' ? <Music2 /> : <ImageIcon />}
            <b>{reference.title}</b>
            <button type="button" aria-label={`移除参考素材 ${reference.title}`} onClick={() => removeReference(reference.id)}>×</button>
          </span>
        ))}
      </div>

      <div className="nori-canvas-video-edit-preview">
        {sourceUrl
          ? <video
              ref={videoRef}
              src={sourceUrl}
              controls
              playsInline
              preload="auto"
              poster={data.posterUrl ? toDisplayImageUrl(data.posterUrl) || undefined : undefined}
              className="nodrag nowheel"
              style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'auto', background: '#000' }}
              onClick={(event) => event.stopPropagation()}
              onLoadedMetadata={(event) => setDurationMs(Math.max(0, Math.round(event.currentTarget.duration * 1_000)))}
              onTimeUpdate={(event) => setCurrentMs(Math.max(0, Math.round(event.currentTarget.currentTime * 1_000)))}
            />
          : <span>请上传视频、选择素材库视频，或从画布视频节点连线接入。</span>}
      </div>

      <div className="nori-canvas-video-edit-timeline nodrag">
        <div
          ref={trackRef}
          className={`nori-canvas-video-edit-track${dragRole ? ' is-dragging' : ''}`}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
        >
          <i className="nori-canvas-video-edit-range" style={{ left: `${startRatio * 100}%`, width: `${Math.max(0, endRatio - startRatio) * 100}%` }} />
          <em data-role="start" className="nori-canvas-video-edit-marker is-start" style={{ left: `${startRatio * 100}%` }} />
          <em data-role="end" className="nori-canvas-video-edit-marker is-end" style={{ left: `${endRatio * 100}%` }} />
          <b data-role="playhead" className="nori-canvas-video-edit-playhead" style={{ left: `${currentRatio * 100}%` }} />
        </div>
        <div className="nori-canvas-video-edit-time-row">
          <button type="button" disabled={!sourceUrl || running} onClick={() => setFrame('startMs')}>设为起始</button>
          <span>起始 {formatMilliseconds(startMs)}</span>
          <button type="button" disabled={!sourceUrl || running} onClick={() => setFrame('endMs')}>设为结束</button>
          <span>结束 {formatMilliseconds(endMs)}</span>
        </div>
      </div>

      <div className="nori-canvas-video-edit-mention-wrap nodrag nowheel">
        <MentionPromptEditor
          className="nori-canvas-video-edit-mention-editor"
          value={prompt}
          assets={mentionAssets}
          onChange={setPrompt}
          onSelectAsset={selectMentionAsset}
          readOnly={running || editor.readOnly}
          minHeight={52}
          placeholder="描述这段视频要怎么改，输入 @ 引用参考素材"
          hint="输入 @ 可选择参考图或参考音频；也可以先用上方按钮从素材库添加。"
          menuLabel="选择参考素材"
        />
      </div>

      <div className="nori-canvas-video-edit-footer nodrag">
        <label><input type="checkbox" checked={generateAudio} disabled={running || editor.readOnly} onChange={(event) => setGenerateAudio(event.target.checked)} /><span>同步生成声音</span></label>
        <button type="button" className="is-primary" disabled={!canSubmit} title={!generationAllowed ? '积分不足，无法生成' : undefined} onClick={submit}><Sparkles />{running ? '编辑中…' : !generationAllowed ? '积分不足' : '开始编辑'}</button>
      </div>

      {data.progress && running ? (
        <div className="nori-canvas-video-edit-progress nodrag">
          <span>处理中 {Math.round(Number(data.progress))}%</span>
          <i><b style={{ width: `${Math.min(100, Math.max(0, Number(data.progress)))}%` }} /></i>
        </div>
      ) : null}
      {data.errorMessage && !running ? <div className="nori-canvas-video-edit-error nodrag">{data.errorMessage}</div> : null}

      <Handle type="source" position={Position.Left} id="input" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      <Handle type="source" position={Position.Right} id="output" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
    </article>
  )
}
