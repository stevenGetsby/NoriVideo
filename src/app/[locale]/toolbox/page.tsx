import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameToolboxDashboard } from '@/components/workspace/FrameToolboxDashboard'

export default function ToolboxPage() {
  return (
    <FrameFeatureHubPage
      activeKey="toolbox"
      pageKey="toolbox"
      icon="settingsHexMinor"
      primaryAction={{ href: { pathname: '/service-records' }, labelKey: 'openServiceRecords', icon: 'receipt' }}
    >
      <FrameToolboxDashboard />
    </FrameFeatureHubPage>
  )
}
