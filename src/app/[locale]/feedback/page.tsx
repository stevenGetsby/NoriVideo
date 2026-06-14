import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameFeedbackDashboard } from '@/components/workspace/FrameFeedbackDashboard'

export default function FeedbackPage() {
  return (
    <FrameFeatureHubPage
      activeKey="feedback"
      pageKey="feedback"
      icon="infoCircle"
      primaryAction={{ href: { pathname: '/service-records' }, labelKey: 'openServiceRecords', icon: 'receipt' }}
    >
      <FrameFeedbackDashboard />
    </FrameFeatureHubPage>
  )
}
