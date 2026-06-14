import { ApiError } from '@/lib/api-errors'
import { canExposeInternalAgentRuns } from './internal-run-visibility'

export function assertInternalAgentApiEnabled() {
  if (!canExposeInternalAgentRuns()) {
    throw new ApiError('NOT_FOUND')
  }
}
