import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasGenerator } from '../../src/features/canvas/components/CanvasGenerator'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'
import '@xyflow/react/dist/style.css'
import '../../src/features/canvas/canvas.css'

const params = new URLSearchParams(location.search)
const mediaType = (params.get('type') || 'video') as 'image' | 'video' | 'audio'
const inputMode = (params.get('mode') || 'text') as 'text' | 'image' | 'firstlastframe'
const withThumbs = params.get('refs') === '1'

function node(id: string, type: string, data: Record<string, unknown>): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as CanvasFlowNode
}

function Fixture() {
  const [added, setAdded] = useState<string>('none')
  const referenceImage = node('img-1', 'image', {
    title: '角色参考图', mediaType: 'image', contentUrl: '/placeholder.png',
  })
  const generator = node('gen-1', mediaType === 'image' ? 'image' : mediaType === 'audio' ? 'audio' : 'video', {
    title: '视频生成',
    mediaType,
    generation: {
      inputMode,
      ...(withThumbs ? { referenceNodeIds: ['img-1'] } : {}),
    },
  })

  return (
    <>
      <main className="fos-app" style={{ height: '100vh' }}>
        <div className="nori-canvas-workspace" style={{ height: '100vh' }}>
          <CanvasGenerator
            projectId="project-1"
            node={generator}
            incomingNodes={[]}
            referenceNodes={withThumbs ? [referenceImage, generator] : [generator]}
            onDraftChange={() => undefined}
            onGenerate={async () => undefined}
            onReplace={() => undefined}
            onClose={() => undefined}
            onFocus={() => undefined}
            onAddReferences={(request) => setAdded(JSON.stringify(request))}
            injectedReferenceNodeIds={[]}
            anchor={null}
            panelWidth={420}
            onPanelWidthChange={() => undefined}
          />
        </div>
      </main>
      <output data-testid="added-request" style={{ position: 'fixed', left: 8, bottom: 8, color: '#fff', zIndex: 9999 }}>{added}</output>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
