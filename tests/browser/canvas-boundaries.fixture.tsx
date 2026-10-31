import React, { useState } from 'react'
import { CanvasViewportLayer } from '../../src/features/canvas/components/CanvasViewportLayer'
import { CanvasHistoryDialog, CanvasRevisionDialog } from '../../src/features/canvas/components/CanvasDialogs'
import { CanvasImageEditDialog } from '../../src/features/canvas/components/CanvasImageEditDialog'
import { CanvasImageOperationDialog } from '../../src/features/canvas/components/CanvasImageOperationDialog'
import { CanvasVideoOperationDialog } from '../../src/features/canvas/components/CanvasVideoOperationDialog'
import { CanvasAssetLibraryDialog } from '../../src/features/canvas/components/CanvasAssetLibraryDialog'
import { CanvasWorkflowDialog } from '../../src/features/canvas/components/CanvasWorkflowDialog'
import { CanvasManagementDialog } from '../../src/features/canvas/components/CanvasManagementDialog'
import { CanvasMediaPreviewDialog } from '../../src/features/canvas/components/CanvasMediaPreviewDialog'
import { CanvasModel3DDialog } from '../../src/features/canvas/components/CanvasModel3D'
import { CanvasStudio3DDialog } from '../../src/features/canvas/components/CanvasStudio3D'
import { CanvasPanoramaDialog } from '../../src/features/canvas/components/CanvasPanoramaDialog'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'

export function CanvasBoundariesFixture() {
  const [open, setOpen] = useState(true)
  const kind = new URLSearchParams(location.search).get('kind') || 'history'
  const close = () => setOpen(false)
  const longTitle = '很长的中文素材与画布名称以及没有空格的EnglishIdentifier'.repeat(4)
  const imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#36517d"/></svg>')
  const node: CanvasFlowNode = {
    id: 'stress-node', type: kind.startsWith('video') ? 'video' : 'image', position: { x: 0, y: 0 },
    data: {
      title: longTitle, mediaType: kind.startsWith('video') ? 'video' : 'image',
      imageUrl, contentUrl: kind.startsWith('video') ? 'images/ui.mp4' : imageUrl,
      history: Array.from({ length: 8 }, (_, index) => ({
        id: `h-${index}`, status: 'ready', createdAt: '2026-10-08T00:00:00.000Z', url: imageUrl,
        prompt: '完整提示词不能三行截断，也要显示长长的连续英文字符。'.repeat(20),
        modelKey: longTitle, actualCostPoints: 20,
      })),
    },
  }
  const canvas = { id: 'canvas-1', projectId: 'project-1', title: longTitle, nodeCount: 999, themeColor: null, viewport: null, revision: 1, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }
  let content: React.ReactNode
  const operation = { projectId: 'project-1', canvasId: 'canvas-1', node, onClose: close, onSubmit: async () => close(), onRecover: async () => {}, isTaskMaterialized: () => false }
  if (kind === 'history') content = <CanvasHistoryDialog node={node} onClose={close} onUse={close} />
  else if (kind === 'revisions') content = <CanvasRevisionDialog revisions={Array.from({ length: 20 }, (_, i) => ({ id: `r-${i}`, revision: i, clientId: null, changeSummary: longTitle, createdAt: '2026-10-08T00:00:00.000Z' }))} currentRevision={1} loading={false} restoringId={null} canRestore error={null} onReload={() => {}} onRestore={close} onClose={close} />
  else if (kind === 'asset') content = <CanvasAssetLibraryDialog initialTitle={longTitle} imageUrl={imageUrl} onConfirm={async () => close()} onClose={close} />
  else if (kind === 'workflow') content = <CanvasWorkflowDialog initialName={longTitle} onConfirm={async () => close()} onClose={close} />
  else if (kind === 'management') content = <CanvasManagementDialog intent={{ type: 'delete', canvas }} busy={false} error={null} onSubmit={close} onClose={close} />
  else if (kind === 'image-edit') content = <CanvasImageEditDialog node={node} onSubmit={async () => close()} onClose={close} />
  else if (kind === 'image-grid') content = <CanvasImageOperationDialog {...operation} mode="grid_split" />
  else if (kind === 'image-focus') content = <CanvasImageOperationDialog {...operation} mode="lens_focus" />
  else if (kind === 'image-upscale') content = <CanvasImageOperationDialog {...operation} mode="superresolve" />
  else if (kind === 'video-upscale') content = <CanvasVideoOperationDialog {...operation} mode="video_superresolve" />
  else if (kind === 'video-subtitles') content = <CanvasVideoOperationDialog {...operation} mode="subtitle_erase" />
  else if (kind === 'model3d') content = <CanvasModel3DDialog src="/sample.glb" title={longTitle} onClose={close} />
  else if (kind === 'studio') content = <CanvasStudio3DDialog projectId="project-1" canvasId="canvas-1" node={{ ...node, type: 'studio_3d', data: { title: longTitle } }} incomingNodes={[]} readOnly={false} onSummaryChange={() => {}} onStageCaptures={async () => ({ captures: [], failed: 0 })} onSendCaptures={async () => ({ sentIds: [], created: 0, failed: 0 })} onClose={close} />
  else if (kind === 'panorama') content = <CanvasPanoramaDialog src={imageUrl} title={longTitle} readOnly={false} onCapture={async () => ({ created: 0, failed: 0, errors: [] })} onClose={close} />
  else content = <CanvasMediaPreviewDialog node={{ ...node, type: kind === 'video-preview' ? 'video' : 'image' }} readOnly={kind === 'video-preview-readonly'} onCaptureFrame={kind.startsWith('video-preview') ? async (file) => {
    if (new URLSearchParams(location.search).get('capture-fail') === '1') throw new Error('模拟关键帧上传失败')
    if (file.type !== 'image/jpeg' || file.size === 0) throw new Error('关键帧 JPEG 无效')
    close()
  } : undefined} onClose={close} />
  return <main className="fos-app">
    <div style={{ transform: 'translate(900px, 800px) scale(1.5)', height: '100%' }}>
      <CanvasViewportLayer>{open ? content : <output data-testid="dialog-closed">已关闭</output>}</CanvasViewportLayer>
    </div>
  </main>
}
