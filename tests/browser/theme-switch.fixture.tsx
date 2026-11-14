import React from 'react'
import { createRoot } from 'react-dom/client'
import { AccountModal } from '../../src/components/frameos/FosShellModals'
import { CanvasChrome } from '../../src/features/canvas/components/CanvasChrome'
import { FosAuthShell } from '../../src/components/frameos/FosAuthShell'
import { useNoriTheme } from '../../src/lib/theme/useNoriTheme'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/canvas.css'

const canvas = { id: 'canvas-theme', projectId: 'project-theme', title: '主题验证', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace' as const, forkedFromId: null, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }

function Fixture() {
  const { preference, resolved } = useNoriTheme()
  return <main className="fos-app" data-testid="theme-preference" data-preference={preference} data-resolved={resolved}>
    <AccountModal account="theme-test" onLogout={() => undefined} onClose={() => undefined} />
    <CanvasChrome projectId="project-theme" projectName="主题验证" canvases={[canvas]} activeCanvas={canvas} saveState="saved" canUndo={false} canRedo={false} onSelectCanvas={() => undefined} onCreateCanvas={() => undefined} onRenameCanvas={() => undefined} onDeleteCanvas={() => undefined} onUndo={() => undefined} onRedo={() => undefined} onRetrySave={() => undefined} onOpenRevisions={() => undefined} syncingProduction={false} canSyncProduction={false} readOnly={false} onOpenProjectAssets={() => undefined} onSyncProduction={() => undefined} />
    <section className="nori-force-dark" data-testid="forced-dark-preview" style={{ position: 'absolute', left: 0, top: 0 }}><span style={{ color: 'rgb(var(--nori-text-1))', backgroundColor: 'rgb(var(--nori-bg-3))' }}>媒体预览保持深色</span></section>
    <section className="nori-auth nori-force-dark" data-testid="forced-dark-login" style={{ position: 'absolute', left: 0, top: 40 }}><span>登录页保持深色</span></section>
    <div style={{ position: 'absolute', left: 0, top: 80 }}><FosAuthShell title="登录验证" subtitle="始终深色" footer={null}><span>账号登录</span></FosAuthShell></div>
  </main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
