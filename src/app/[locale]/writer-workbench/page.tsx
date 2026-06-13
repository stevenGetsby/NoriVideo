import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameWriterWorkbenchDashboard } from '@/components/workspace/FrameWriterWorkbenchDashboard'

export default function WriterWorkbenchPage() {
  return (
    <FrameFeatureHubPage activeKey="writerWorkbench" pageKey="writerWorkbench" icon="fileText">
      <FrameWriterWorkbenchDashboard />
    </FrameFeatureHubPage>
  )
}
