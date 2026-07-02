import { FosVideoRepaintFlowClient } from '@/components/frameos/FosVideoRepaintFlowClient'

export default async function VideoRepaintSourceSettingsPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosVideoRepaintFlowClient taskId={taskId} stage="source_settings" />
}
