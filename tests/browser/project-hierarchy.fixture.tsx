import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosProjectsClient } from '@/components/frameos/FosProjectsClient'
import { FosProjectHeader } from '@/components/frameos/FosProjectHeader'
import { FosShell } from '@/components/frameos/FosShell'
import { CanvasChrome } from '@/features/canvas/components/CanvasChrome'
import type { Canvas } from '@/features/canvas/types'
import '@/styles/frameos-replica.css'
import '@/features/canvas/canvas.css'

const noop = () => undefined
const canvas: Canvas = {
  id: 'canvas-a', projectId: 'leaf-a', title: '测试画布', themeColor: null,
  viewport: null, revision: 1, visibility: 'private', forkedFromId: null,
  createdAt: '', updatedAt: '',
}
const projectOptions = [
  { id: 'leaf-a', name: '作品 A', workId: 'parent-a', workName: '项目甲' },
  { id: 'leaf-b', name: '作品 B', workId: 'parent-a', workName: '项目甲' },
  { id: 'leaf-c', name: '作品 C', workId: 'parent-b', workName: '项目乙' },
]
const view = new URLSearchParams(location.search).get('view')
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    {view === 'canvas' ? <FosShell activeKey="canvas" canvasShell><div className="nori-canvas-workspace">
      <CanvasChrome projectId="leaf-a" projectName="作品 A" canvases={[canvas]} activeCanvas={canvas}
        saveState="saved" canUndo={false} canRedo={false}
        onSelectCanvas={noop} onCreateCanvas={noop} onRenameCanvas={noop} onDeleteCanvas={noop}
        projectOptions={projectOptions} onSelectProject={noop} canvasHomeHref="/canvas"
        createProjectHref="/projects?create_work=1&parent_project_id=parent-a"
        onUndo={noop} onRedo={noop} onRetrySave={noop} onOpenRevisions={noop}
        syncingProduction={false} canSyncProduction={false} readOnly={false}
        onOpenProjectAssets={noop} onSyncProduction={noop} />
    </div></FosShell> : view === 'header' ? <main className="fos-app">
      <FosProjectHeader projectId="leaf-a" projectName="作品 A" parentProjectName="项目甲" />
    </main> : <FosProjectsClient />}
  </NextIntlClientProvider>,
)
