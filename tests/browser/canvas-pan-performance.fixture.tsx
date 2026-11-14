import React, { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const canvas: Canvas = {
  id: 'canvas-1', projectId: 'project-1', title: '拖动性能',
  viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, themeColor: null,
  visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
}

// Commit counts are only recorded by development/profiling React builds.
const commits: number[] = []
;(window as unknown as { __reactCommits: number[] }).__reactCommits = commits

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
      <main className="fos-app">
        <Profiler id="canvas" onRender={(_id, _phase, actualDuration) => { commits.push(actualDuration) }}>
          <CanvasGraph
            projectId="project-1" projectName="拖动性能验证" canvasId="canvas-1" canvases={[canvas]}
            onSelectCanvas={() => {}} onCreateCanvas={() => {}} onRenameCanvas={() => {}} onDeleteCanvas={() => {}}
          />
        </Profiler>
      </main>
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
