import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameTeamDashboard } from '@/components/workspace/FrameTeamDashboard'

export default function TeamPage() {
  return (
    <FrameFeatureHubPage
      activeKey="team"
      pageKey="team"
      icon="userRoundCog"
      primaryAction={{ href: { pathname: '/projects' }, labelKey: 'openProjects', icon: 'monitor' }}
    >
      <FrameTeamDashboard />
    </FrameFeatureHubPage>
  )
}
