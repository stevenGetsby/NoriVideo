import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import CanvasGraph from '../../src/features/canvas/CanvasGraph'
import { FosAccountManagementClient } from '../../src/components/frameos/FosAccountManagementClient'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'
import { CanvasBoundariesFixture } from './canvas-boundaries.fixture'
import { useAccountBalance } from '../../src/hooks/common/useAccountBalance'
import { setFixtureSession } from './stubs/next-auth-react'

function SharedWalletFixture() {
  const balance = useAccountBalance()
  return <section>
    <output data-testid="wallet-points">{balance.points}</output>
    <output data-testid="wallet-scope">{balance.walletScope}</output>
    <output data-testid="wallet-status">{balance.generationDisabledReason || '可以生成'}</output>
    <button data-testid="generate" disabled={!balance.generationAllowed}>生成</button>
    <button onClick={() => void balance.refreshBalance()}>刷新额度</button>
    <button onClick={() => setFixtureSession({
      id: 'child-2', name: '另一子账号', role: 'storyboard', permissions: ['canvasWrite'],
      workspaceOwnerId: 'manager-2', pointCredits: 0,
    })}>切换子账号</button>
  </section>
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const canvas: Canvas = {
  id: 'canvas-1', projectId: 'project-1', title: '交互回归',
  viewport: { x: 0, y: 0, zoom: 1 }, revision: 0, themeColor: null,
  visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    {new URLSearchParams(location.search).get('view') === 'billing' ? <SharedWalletFixture />
      : new URLSearchParams(location.search).get('view') === 'dialogs' ? <CanvasBoundariesFixture /> : new URLSearchParams(location.search).get('view') === 'accounts'
      ? <FosAccountManagementClient />
      : <main className="fos-app"><CanvasGraph
        projectId="project-1" projectName="浏览器交互验证" canvasId="canvas-1" canvases={[canvas]} focusNodeId="gen-1"
        onSelectCanvas={() => {}} onCreateCanvas={() => {}} onRenameCanvas={() => {}} onDeleteCanvas={() => {}}
      /></main>}
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
