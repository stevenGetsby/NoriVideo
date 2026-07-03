import { FosScriptRepaintFlowClient } from '@/components/frameos/FosScriptRepaintFlowClient'

export default async function ScriptRepaintTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosScriptRepaintFlowClient taskId={taskId} />
}
