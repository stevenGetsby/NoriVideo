import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const canvas: Canvas = {
  id: 'canvas-1', projectId: 'project-1', title: '喵导浏览器测试', viewport: { x: 0, y: 0, zoom: 1 },
  revision: 0, themeColor: null, visibility: 'workspace', forkedFromId: null,
  createdAt: '2026-11-22T00:00:00.000Z', updatedAt: '2026-11-22T00:00:00.000Z',
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    <main className="fos-app"><CanvasGraph mode={new URLSearchParams(location.search).has('story') ? 'story' : 'canvas'}
      lightGraph={new URLSearchParams(location.search).has('summary')}
      projectId={canvas.projectId} projectName={canvas.title} canvasId={canvas.id} canvases={[canvas]}
      onSelectCanvas={() => undefined} onCreateCanvas={() => undefined} onRenameCanvas={() => undefined} onDeleteCanvas={() => undefined} /></main>
  </NextIntlClientProvider></QueryClientProvider>,
)
