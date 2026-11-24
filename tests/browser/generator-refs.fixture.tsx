import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { CanvasGenerator } from '../../src/features/canvas/components/CanvasGenerator'
import { CanvasNodeVideo } from '../../src/features/canvas/nodes/CanvasNodeVideo'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'
import '@xyflow/react/dist/style.css'
import '../../src/features/canvas/canvas.css'

const params = new URLSearchParams(location.search)
const mediaType = (params.get('type') || 'video') as 'image' | 'video' | 'audio'
const inputMode = (params.get('mode') || 'text') as 'text' | 'image' | 'firstlastframe'
const withThumbs = params.get('refs') === '1'
const withVoice = params.get('voice') === '1'
const withStale = params.get('stale') === '1'
const withVoiceToggle = params.get('voicetoggle') === '1'
const superresolve = params.get('superresolve') as '720p' | '1080p' | '4k' | null
const withPicker = params.get('picker') === '1'
const withPickerMedia = params.get('pickermedia') === '1'
const withWired = params.get('wired') === '1'

// The browser test reads what the generator reported without re-rendering the fixture.
declare global {
  interface Window {
    __fixture: { drafts: Array<Record<string, unknown>>; closeCalls: number }
  }
}
window.__fixture = { drafts: [], closeCalls: 0 }

function node(id: string, type: string, data: Record<string, unknown>): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as CanvasFlowNode
}

const swatch = (hex: string) => `/swatch-${hex}.svg`

// Canvas order is oldest first; the picker lists the last node first.
const pickerImage2 = node('pick-img-2', 'image', { title: '城市夜景', mediaType: 'image', contentUrl: swatch('4c5dd6') })
const pickerNodes: CanvasFlowNode[] = withPicker ? [
  ...(withPickerMedia ? [
    node('pick-aud-1', 'audio', { title: '旁白录音', mediaType: 'audio', audioUrl: '/voice.mp3' }),
    node('pick-vid-1', 'video', { title: '镜头一 海边', mediaType: 'video', videoUrl: '/test-video.mp4', posterUrl: swatch('2f7d6d') }),
    node('pick-vid-2', 'video', { title: '镜头二 无封面', mediaType: 'video', videoUrl: '/test-video.mp4' }),
  ] : []),
  node('pick-pending', 'image', { title: '生成中的图', mediaType: 'image' }),
  node('pick-txt-1', 'text', { title: '分镜文案', mediaType: 'text', prompt: '一段文案不是素材' }),
  node('pick-img-1', 'image', { title: '海边日落', mediaType: 'image', contentUrl: swatch('e8743b') }),
  pickerImage2,
  node('pick-img-3', 'image', { title: '林间小屋', mediaType: 'image', contentUrl: swatch('2f9e6f'), sourceMetadata: { assetCategory: 'character' } }),
] : []

function Fixture() {
  const [added, setAdded] = useState<string>('none')
  const [refreshed, setRefreshed] = useState(false)
  const [voiceDetached, setVoiceDetached] = useState(false)
  const [toggleCalls, setToggleCalls] = useState<string[]>([])
  const referenceImage = node('img-1', 'image', {
    title: '苏晚卿',
    mediaType: 'image',
    contentUrl: swatch('b4478f'),
    voiceDetached,
    sourceMetadata: withVoice ? { assetCategory: 'character', voiceMaterialId: 'audio-1' } : null,
  })
  const missingVoiceImage = node('img-2', 'image', {
    title: '顾北辰',
    mediaType: 'image',
    contentUrl: swatch('3d8fb5'),
    sourceMetadata: { assetCategory: 'character' },
  })
  const generator = node('gen-1', mediaType === 'image' ? 'image' : mediaType === 'audio' ? 'audio' : 'video', {
    title: '视频生成',
    mediaType,
    prompt: params.get('refresh') ? '正在编辑的草稿' : '',
    progress: refreshed ? 68 : 45,
    generation: {
      inputMode,
      parameters: superresolve ? { superresolveTarget: superresolve } : undefined,
      ...(withStale
        ? { referenceNodeIds: ['deleted-reference'] }
        : withThumbs
          ? { referenceNodeIds: withVoice ? ['img-1', 'img-2'] : ['img-1'] }
          : withWired ? { referenceNodeIds: [] } : {}),
    },
  })
  if (params.get('video')) {
    return <div style={{ position: 'relative', width: 640, height: 360 }}><CanvasNodeVideo src="/test-video.mp4" /></div>
  }

  return (
    <>
      <main className="fos-app">
        <div className="nori-canvas-workspace">
          <CanvasGenerator
            projectId="project-1"
            node={generator}
            incomingNodes={withWired ? [pickerImage2] : []}
            referenceNodes={[...pickerNodes, ...(withThumbs ? [referenceImage, ...(withVoice ? [missingVoiceImage] : [])] : []), generator]}
            onDraftChange={(patch) => { window.__fixture.drafts.push(patch) }}
            onGenerate={async () => undefined}
            onReplace={() => undefined}
            onClose={() => { window.__fixture.closeCalls += 1 }}
            onFocus={() => undefined}
            onAddReferences={(request) => setAdded(JSON.stringify(request))}
            onSelectLibraryMaterial={() => null}
            onToggleReferenceVoice={withVoiceToggle ? (nodeId) => { setToggleCalls((current) => [...current, nodeId]); setVoiceDetached((current) => !current) } : undefined}
            injectedReferenceNodeIds={[]}
            panelWidth={420}
            onPanelWidthChange={() => undefined}
          />
        </div>
      </main>
      <output data-testid="voice-toggle-calls" style={{ position: 'fixed', left: 8, bottom: 32, color: '#fff', zIndex: 9999 }}>{toggleCalls.join(',')}</output>
      <output data-testid="added-request" style={{ position: 'fixed', left: 8, bottom: 8, color: '#fff', zIndex: 9999 }}>{added}</output>
      {params.get('refresh') ? <button data-testid="refresh-task" style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 9999 }} onClick={() => setRefreshed(true)}>模拟任务刷新</button> : null}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<ReactFlowProvider><Fixture /></ReactFlowProvider>)
