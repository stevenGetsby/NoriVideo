import { FrameFeatureHubPage } from '@/components/workspace/FrameFeatureHubPage'
import { FrameWriterRedrawDashboard } from '@/components/workspace/FrameWriterRedrawDashboard'

interface WriterRedrawPageProps {
  params: Promise<{ scriptId: string }>
}

export default async function WriterRedrawPage({ params }: WriterRedrawPageProps) {
  const { scriptId } = await params
  return (
    <FrameFeatureHubPage activeKey="writerWorkbench" pageKey="writerRedraw" icon="wandOff">
      <FrameWriterRedrawDashboard scriptId={scriptId} />
    </FrameFeatureHubPage>
  )
}
