import { FosVideoRepaintFlowClient } from '@/components/frameos/FosVideoRepaintFlowClient'

export default async function VideoRepaintTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  return <FosVideoRepaintFlowClient taskId={taskId} />
}
