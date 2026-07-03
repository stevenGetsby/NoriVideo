import { FosScriptRepaintFlowClient } from '@/components/frameos/FosScriptRepaintFlowClient'

export default async function ScriptRepaintEpisodeRepaintPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosScriptRepaintFlowClient taskId={taskId} stage="episode_repaint" />
}
