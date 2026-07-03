import { FosVideoRepaintFlowClient } from '@/components/frameos/FosVideoRepaintFlowClient'

export default async function VideoRepaintEpisodeAlignmentPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosVideoRepaintFlowClient taskId={taskId} stage="episode_alignment" />
}
