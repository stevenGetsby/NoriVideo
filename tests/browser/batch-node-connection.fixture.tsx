import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import type { Canvas } from '../../src/features/canvas/types'
import { setFixtureSession } from './stubs/next-auth-react'
import '../../src/styles/frameos-replica.css'

if (new URLSearchParams(location.search).get('readonly') === '1') {
  setFixtureSession({ id: 'readonly', name: '只读', role: 'reviewer', permissions: ['read'] })
}
const canvas: Canvas = { id: 'canvas-1', projectId: 'project-1', title: '批量连接', viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' }
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
      <main className="fos-app"><CanvasGraph projectId="project-1" projectName="批量连接验证" canvasId="canvas-1" canvases={[canvas]}
        onSelectCanvas={() => {}} onCreateCanvas={() => {}} onRenameCanvas={() => {}} onDeleteCanvas={() => {}} /></main>
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
