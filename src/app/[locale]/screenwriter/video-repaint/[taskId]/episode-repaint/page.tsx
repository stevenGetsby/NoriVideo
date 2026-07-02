import { FosVideoRepaintFlowClient } from '@/components/frameos/FosVideoRepaintFlowClient'

export default async function VideoRepaintEpisodeRepaintPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosVideoRepaintFlowClient taskId={taskId} stage="episode_repaint" />
}
