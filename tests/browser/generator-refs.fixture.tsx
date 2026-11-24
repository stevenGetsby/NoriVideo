import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { CanvasGenerator } from '../../src/features/canvas/components/CanvasGenerator'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'
import '@xyflow/react/dist/style.css'
import '../../src/features/canvas/canvas.css'

const params = new URLSearchParams(location.search)
const mediaType = (params.get('type') || 'video') as 'image' | 'video' | 'audio'
const inputMode = (params.get('mode') || 'text') as 'text' | 'image' | 'firstlastframe'
const withThumbs = params.get('refs') === '1'
const withVoice = params.get('voice') === '1'
const withStale = params.get('stale') === '1'
const initialZoom = Number(params.get('zoom') || '1') || 1
const panelWidth = Number(params.get('panelWidth') || '420') || 420
const superresolve = params.get('superresolve') as '720p' | '1080p' | '4k' | null

function node(id: string, type: string, data: Record<string, unknown>): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as CanvasFlowNode
}

function Fixture() {
  const [added, setAdded] = useState<string>('none')
  const [workspaceElement, setWorkspaceElement] = useState<HTMLDivElement | null>(null)
  const referenceImage = node('img-1', 'image', {
    title: '苏晚卿',
    mediaType: 'image',
    contentUrl: '/placeholder.png',
    sourceMetadata: withVoice ? { assetCategory: 'character', voiceMaterialId: 'audio-1' } : null,
  })
  const missingVoiceImage = node('img-2', 'image', {
    title: '顾北辰',
    mediaType: 'image',
    contentUrl: '/placeholder.png',
    sourceMetadata: { assetCategory: 'character' },
  })
  const generator = node('gen-1', mediaType === 'image' ? 'image' : mediaType === 'audio' ? 'audio' : 'video', {
    title: '视频生成',
    mediaType,
    generation: {
      inputMode,
      parameters: superresolve ? { superresolveTarget: superresolve } : undefined,
      ...(withStale
        ? { referenceNodeIds: ['deleted-reference'] }
        : withThumbs ? { referenceNodeIds: withVoice ? ['img-1', 'img-2'] : ['img-1'] } : {}),
    },
  })

  return (
    <>
      <main className="fos-app">
        <div ref={setWorkspaceElement} className="nori-canvas-workspace" style={{ position: 'relative', width: '100vw', height: '100vh', ...(params.get('zoom') ? { zoom: 'var(--nori-interface-scale, 1.2)' } : {}) }}>
          <ReactFlowProvider>
            <ReactFlow nodes={[{ ...generator, position: { x: 40, y: 24 }, width: 320, height: 120 }]} edges={[]} defaultViewport={{ x: 0, y: 0, zoom: initialZoom }} minZoom={0.05} maxZoom={8} proOptions={{ hideAttribution: true }}>
              {workspaceElement ? (
              <CanvasGenerator
                projectId="project-1"
                node={generator}
                incomingNodes={[]}
                referenceNodes={withThumbs ? [referenceImage, ...(withVoice ? [missingVoiceImage] : []), generator] : [generator]}
                onDraftChange={() => undefined}
                onGenerate={async () => undefined}
                onReplace={() => undefined}
                onClose={() => undefined}
                onFocus={() => undefined}
                onAddReferences={(request) => setAdded(JSON.stringify(request))}
                onSelectLibraryMaterial={() => null}
                injectedReferenceNodeIds={[]}
                panelWidth={panelWidth}
                onPanelWidthChange={() => undefined}
                viewportLayerTarget={workspaceElement}
              />
              ) : null}
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </main>
      <output data-testid="added-request" style={{ position: 'fixed', left: 8, bottom: 8, color: '#fff', zIndex: 9999 }}>{added}</output>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
