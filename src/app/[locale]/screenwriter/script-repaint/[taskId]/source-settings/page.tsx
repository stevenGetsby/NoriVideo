import { FosScriptRepaintFlowClient } from '@/components/frameos/FosScriptRepaintFlowClient'

export default async function ScriptRepaintSourceSettingsPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosScriptRepaintFlowClient taskId={taskId} stage="source_settings" />
}
