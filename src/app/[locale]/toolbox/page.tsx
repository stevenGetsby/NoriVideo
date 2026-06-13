import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameToolboxDashboard } from '@/components/workspace/FrameToolboxDashboard'

export default function ToolboxPage() {
  return (
    <FrameFeatureHubPage activeKey="toolbox" pageKey="toolbox" icon="settingsHexMinor">
      <FrameToolboxDashboard />
    </FrameFeatureHubPage>
  )
}
