import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameSeedanceDashboard } from '@/components/workspace/FrameSeedanceDashboard'

export default function SeedancePage() {
  return (
    <FrameFeatureHubPage
      activeKey="seedance"
      pageKey="seedance"
      icon="film"
      primaryAction={{ href: { pathname: '/video-enhance' }, labelKey: 'openVideoEnhance', icon: 'video' }}
    >
      <FrameSeedanceDashboard />
    </FrameFeatureHubPage>
  )
}
