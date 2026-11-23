import type { CanvasFlowNode } from '../editor-types'
import { isNodeBusy } from './commands/node-state'

export type SubmittedAgentTask = { id: string; token: string; observedBusy: boolean }
export function createAgentTaskTracker() {
  const tracked = new Map<string, SubmittedAgentTask>()
  const handled = new Set<string>()
  return {
    track(tasks: readonly SubmittedAgentTask[]) {
      for (const next of tasks) {
        if (handled.has(next.token) || tracked.get(next.id)?.token === next.token) continue
        tracked.set(next.id, { ...next })
      }
    },
    active: () => tracked.size > 0,
    poll(nodes: readonly CanvasFlowNode[]) {
      const byId = new Map(nodes.map((node) => [node.id, node]))
      let completed = 0, failed = 0
      for (const [id, task] of tracked) {
        const node = byId.get(id)
        if (node && isNodeBusy(node)) { task.observedBusy = true; continue }
        if (!task.observedBusy && node) continue
        if (!node || node.data.__server?.status === 'FAILED' || node.data.errorMessage) failed++
        else if (node.data.__server?.status === 'SUCCEEDED' || node.data.generationTask?.completed) completed++
        else continue
        tracked.delete(id)
        handled.add(task.token)
      }
      if (handled.size > 200) for (const token of [...handled].slice(0, handled.size - 150)) handled.delete(token)
      return { completed, failed }
    },
  }
}
