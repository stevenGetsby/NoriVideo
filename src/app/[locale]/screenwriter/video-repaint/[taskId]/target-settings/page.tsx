import { FosVideoRepaintFlowClient } from '@/components/frameos/FosVideoRepaintFlowClient'

export default async function VideoRepaintTargetSettingsPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosVideoRepaintFlowClient taskId={taskId} stage="target_settings" />
}
