import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameMaterialDashboard } from '@/components/workspace/FrameMaterialDashboard'

export default function MaterialPage() {
  return (
    <FrameFeatureHubPage activeKey="materialLibrary" pageKey="material" icon="package">
      <FrameMaterialDashboard />
    </FrameFeatureHubPage>
  )
}
