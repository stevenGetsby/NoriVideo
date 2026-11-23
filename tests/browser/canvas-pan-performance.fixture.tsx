import React, { Profiler, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const makeCanvas = (id: string, title: string): Canvas => ({
  id, projectId: 'project-1', title,
  viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, themeColor: null,
  visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
})
const canvases = [makeCanvas('canvas-1', '拖动性能'), makeCanvas('canvas-2', '切换对照')]

// Commit counts are only recorded by development/profiling React builds.
const commits: number[] = []
const globals = window as unknown as {
  __reactCommits: number[]
  __noriPerf: { switchCanvas: (canvasId: string) => void }
}
globals.__reactCommits = commits

function Harness() {
  const [canvasId, setCanvasId] = useState('canvas-1')
  useEffect(() => { globals.__noriPerf = { switchCanvas: setCanvasId } }, [])
  return (
    <main className="fos-app">
      <Profiler id="canvas" onRender={(_id, _phase, actualDuration) => { commits.push(actualDuration) }}>
        <CanvasGraph
          mode="canvas"
          lightGraph={new URL(window.location.href).searchParams.get('summary') !== '0'}
          projectId="project-1" projectName="拖动性能验证" canvasId={canvasId} canvases={canvases}
          onSelectCanvas={setCanvasId} onCreateCanvas={() => {}} onRenameCanvas={() => {}} onDeleteCanvas={() => {}}
        />
      </Profiler>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
      <Harness />
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
