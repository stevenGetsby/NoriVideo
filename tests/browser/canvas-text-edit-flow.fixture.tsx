import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
Object.assign(window, { __canvasQueryClient: client })
const canvas: Canvas = {
  id: 'canvas-1', projectId: 'project-1', title: '文本编辑验证', revision: 0,
  viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null,
  createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
      <main className="fos-app"><CanvasGraph
        mode="canvas" projectId="project-1" projectName="文本编辑验证" canvasId="canvas-1" canvases={[canvas]}
        onSelectCanvas={() => undefined} onCreateCanvas={() => undefined} onRenameCanvas={() => undefined} onDeleteCanvas={() => undefined}
      /></main>
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
