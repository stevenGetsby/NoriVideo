import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameServiceRecordsDashboard } from '@/components/workspace/FrameServiceRecordsDashboard'

export default function ServiceRecordsPage() {
  return (
    <FrameFeatureHubPage activeKey="serviceRecords" pageKey="serviceRecords" icon="receipt">
      <FrameServiceRecordsDashboard />
    </FrameFeatureHubPage>
  )
}
