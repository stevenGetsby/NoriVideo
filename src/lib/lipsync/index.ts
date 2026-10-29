import { logError as _ulogError } from '@/lib/logging/core'
import type { LipSyncParams, LipSyncResult } from '@/lib/lipsync/types'

export async function generateLipSync(
  _params: LipSyncParams,
  _userId: string,
  _modelKey?: string,
): Promise<LipSyncResult> {
  const error = new Error('LIPSYNC_PROVIDER_RETIRED: 旧版唇形同步服务已下线，不再接受新任务')
  _ulogError('[LipSync] 已拒绝旧服务任务', error)
  throw error
}

export type { LipSyncParams, LipSyncResult } from '@/lib/lipsync/types'
