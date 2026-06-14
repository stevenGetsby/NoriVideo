import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FramePromptsDashboard } from '@/components/workspace/FramePromptsDashboard'

export default function PromptsPage() {
  return (
    <FrameFeatureHubPage
      activeKey="prompts"
      pageKey="prompts"
      icon="bookmark"
      primaryAction={{ href: { pathname: '/profile' }, labelKey: 'openPromptSettings', icon: 'settingsHexMinor' }}
    >
      <FramePromptsDashboard />
    </FrameFeatureHubPage>
  )
}
