export type GenerationPreview = {
  nodeId: string
  fingerprint: string
  title: string
  model: string
  count: number
  points: number | null
  media?: 'text' | 'image' | 'video'
  resolution?: string
  aspectRatio?: string
  duration?: number
}

type BatchJob = Omit<GenerationPreview, 'points'> & { callId: string; points: number }
export type GenerationBatchOffer = { jobs: BatchJob[]; totalPoints: number }
export type BatchApproval = 'none' | 'approved' | 'changed' | 'declined'

/** A turn-scoped ticket store; quoting never runs an editor command. */
export function createBatchConfirmations() {
  const queue: { round: number; callId: string; name: string; input: unknown }[] = []
  const seen = new Set<string>()
  const approvals = new Map<string, BatchJob | false>()
  const priced = (callId: string, item: GenerationPreview): BatchJob | null =>
    item.points !== null && Number.isFinite(item.points) && item.points >= 0 ? { ...item, callId, points: item.points } : null
  return {
    enqueue(round: number, callId: string, name: string, input: unknown) {
      if (seen.has(callId) || queue.length >= 24) return
      seen.add(callId)
      queue.push({ round, callId, name, input })
    },
    async offer(callId: string, current: GenerationPreview, preview: (input: unknown) => Promise<GenerationPreview>): Promise<GenerationBatchOffer | null> {
      const first = priced(callId, current)
      const index = queue.findIndex((call) => call.callId === callId)
      if (!first || index === -1) return null
      const jobs = [first]
      const seenTargets = new Set([first.nodeId])
      for (const call of queue.slice(index + 1)) {
        if (call.round !== queue[index].round || call.name !== 'generate') break
        if (approvals.has(call.callId)) continue
        // Unpriced or unplannable tasks must still get a separate, explicit decision.
        let job: BatchJob | null
        try { job = priced(call.callId, await preview(call.input)) } catch { return null }
        if (!job || seenTargets.has(job.nodeId)) return null
        jobs.push(job)
        seenTargets.add(job.nodeId)
      }
      const totalPoints = jobs.reduce((sum, job) => sum + job.points, 0)
      return jobs.length > 1 && Number.isFinite(totalPoints) ? { jobs, totalPoints } : null
    },
    approve(offer: GenerationBatchOffer) {
      // The visible card resolves the first task directly. Each later ticket
      // is bound to its own tool-call id and consumed at most once.
      for (const job of offer.jobs.slice(1)) approvals.set(job.callId, job)
    },
    decide(offer: GenerationBatchOffer, callId: string, allow: boolean): GenerationBatchOffer | undefined {
      const job = offer.jobs.slice(1).find((item) => item.callId === callId)
      if (!job) return offer
      approvals.set(callId, allow ? job : false)
      const jobs = offer.jobs.filter((item) => item.callId !== callId)
      return jobs.length > 1 ? { jobs, totalPoints: jobs.reduce((sum, item) => sum + item.points, 0) } : undefined
    },
    consume(callId: string, current: GenerationPreview): BatchApproval {
      const approval = approvals.get(callId)
      if (approval === undefined) return 'none'
      approvals.delete(callId)
      if (approval === false) return 'declined'
      return approval.fingerprint === current.fingerprint && approval.points === current.points ? 'approved' : 'changed'
    },
  }
}
