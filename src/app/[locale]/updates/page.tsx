import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameUpdatesDashboard } from '@/components/workspace/FrameUpdatesDashboard'

export default function UpdatesPage() {
  return (
    <FrameFeatureHubPage
      activeKey="updates"
      pageKey="updates"
      icon="arrowDownCircle"
      primaryAction={{ href: { pathname: '/toolbox' }, labelKey: 'openDiagnostics', icon: 'clipboardCheck' }}
    >
      <FrameUpdatesDashboard />
    </FrameFeatureHubPage>
  )
}
