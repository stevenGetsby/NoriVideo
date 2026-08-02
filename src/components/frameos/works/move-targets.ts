import type { WorkSummary } from './types'

export function eligibleMoveTargets(works: WorkSummary[], sourceWorkId: string): WorkSummary[] {
  return works.filter((work) => (
    !work.virtual
    && work.id !== sourceWorkId
    && work.canManage === true
  ))
}
