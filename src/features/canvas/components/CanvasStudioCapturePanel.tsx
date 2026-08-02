'use client'

import Image from 'next/image'
import CameraIcon from 'lucide-react/dist/esm/icons/camera.js'
import Images from 'lucide-react/dist/esm/icons/images.js'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { CanvasStudioCapture } from '../studio-types'

type Props = {
  captures: CanvasStudioCapture[]
  readOnly: boolean
  capturing: boolean
  sending: boolean
  activeCameraId?: string | null
  compact?: boolean
  onCaptureCurrent: () => void
  onCaptureAll: () => void
  onDelete: (id: string) => void
  onClear: () => void
  onSendAll: () => void
}

export function CanvasStudioCapturePanel({
  captures,
  readOnly,
  capturing,
  sending,
  activeCameraId = null,
  compact = false,
  onCaptureCurrent,
  onCaptureAll,
  onDelete,
  onClear,
  onSendAll,
}: Props) {
  const captureGroups = Array.from(captures.reduce((groups, capture) => {
    const key = capture.cameraId || `unbound:${capture.cameraName || 'director'}`
    const current = groups.get(key)
    if (current) current.captures.push(capture)
    else groups.set(key, { key, cameraId: capture.cameraId, cameraName: capture.cameraName || '未绑定机位', captures: [capture] })
    return groups
  }, new Map<string, { key: string; cameraId: string | null; cameraName: string; captures: CanvasStudioCapture[] }>()).values())

  return <div className={`nori-canvas-studio-captures${compact ? ' is-compact' : ''}`}>
    {!readOnly ? <div className="nori-canvas-studio-capture-create">
      <button type="button" className="is-primary" disabled={capturing || sending} onClick={onCaptureCurrent}>{capturing ? <LoaderCircle className="animate-spin" /> : <CameraIcon />}当前机位截图</button>
      <button type="button" disabled={capturing || sending} onClick={onCaptureAll}><Images />全部机位截图</button>
    </div> : null}
    {captures.length === 0 ? <div className="nori-canvas-studio-capture-empty"><Images /><strong>暂无机位截图</strong><span>{readOnly ? '当前场景还没有截图记录' : '可截取当前机位，或一次截取全部可见机位'}</span></div> : <div className="nori-canvas-studio-capture-list">
      {captureGroups.map((group) => <section key={group.key} className={`nori-canvas-studio-capture-group${group.cameraId && group.cameraId === activeCameraId ? ' is-active' : ''}`}>
        <header><span><CameraIcon />{group.cameraName}</span><small>{group.captures.length} 张</small></header>
        {group.captures.map((capture) => {
          const imageUrl = toDisplayImageUrl(capture.url) || capture.url
          return <article key={capture.id}>
            <div className="nori-canvas-studio-capture-image">
              <Image src={imageUrl} alt={capture.title} fill sizes="240px" unoptimized />
              {!readOnly ? <button type="button" title="删除" aria-label={`删除 ${capture.title}`} onClick={() => onDelete(capture.id)}><X /></button> : null}
              {capture.sentAt ? <b>已发送</b> : null}
              <span>{capture.cameraName}</span>
            </div>
          </article>
        })}
      </section>)}
    </div>}
    {!readOnly && captures.length > 0 ? <div className="nori-canvas-studio-capture-actions">
      <button type="button" disabled={capturing || sending} onClick={onClear}><Trash2 />全部清空</button>
      <button type="button" className="is-primary" disabled={capturing || sending} onClick={onSendAll}>{sending ? <LoaderCircle className="animate-spin" /> : <Send />}发送到画布</button>
    </div> : null}
  </div>
}
