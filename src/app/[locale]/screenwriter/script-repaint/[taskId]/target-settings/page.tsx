import { FosScriptRepaintFlowClient } from '@/components/frameos/FosScriptRepaintFlowClient'

export default async function ScriptRepaintTargetSettingsPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosScriptRepaintFlowClient taskId={taskId} stage="target_settings" />
}
