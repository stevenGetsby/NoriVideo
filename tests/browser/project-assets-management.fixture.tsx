import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosProjectsClient } from '../../src/components/frameos/FosProjectsClient'
import { FosProjectHeader } from '../../src/components/frameos/FosProjectHeader'
import { FosAssetLibrary } from '../../src/components/frameos/views/FosAssetLibrary'
import { useFosProject } from '../../src/components/frameos/useFosProject'
import { FosToolbox } from '../../src/components/frameos/views/FosToolbox'
import { CreditOperationDialog } from '../../src/components/frameos/FosAccountManagementParts'
import { FosMaterialLibrary } from '../../src/components/frameos/views/FosMaterialLibrary'
import '../../src/styles/frameos-replica.css'

function HeaderFixture() {
  const project = useFosProject('project-1')
  return <main className="fos-app"><FosProjectHeader projectId="project-1" projectName={project.projectName} /><output data-testid="project-name">{project.projectName}</output></main>
}
const view = new URLSearchParams(location.search).get('view')
const creditTarget = {
  id: 'child', username: '长名称测试子账号', role: 'writer' as const, roleLabel: null,
  status: 'active' as const, permissions: [], isPlatformAdmin: false, isManager: false,
  parentAccountId: 'manager', workspaceOwnerId: 'manager', credits: { coins: 0, points: 1000 },
  dailyLimitPoints: null, createdAt: '', updatedAt: '', lastLoginAt: null,
}
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    {view === 'credit' ? <main className="fos-app"><CreditOperationDialog operation="reclaim" target={creditTarget}
      sourceBalancePoints={1000} saving={false} error="" onClose={() => {}} onSubmit={() => {}} /></main>
    : view === 'materials' ? <main className="fos-app"><FosMaterialLibrary /></main>
    : view === 'toolbox' ? <main className="fos-app"><FosToolbox /></main> : view === 'assets' ? <main className="fos-app"><FosAssetLibrary /></main> : view === 'header' ? <HeaderFixture /> : <FosProjectsClient />}
  </NextIntlClientProvider>,
)
