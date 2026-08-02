export type KuaiziAsyncType = 'IMAGE' | 'VIDEO' | 'AUDIO'

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`KUAIZI_EXTERNAL_ID_${field}_MISSING`)
  return normalized
}

export function encodeKuaiziExternalToken(value: string): string {
  return Buffer.from(required(value, 'TOKEN'), 'utf8').toString('base64url')
}

export function decodeKuaiziExternalToken(token: string): string {
  const normalized = required(token, 'TOKEN')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error('KUAIZI_EXTERNAL_ID_TOKEN_INVALID')
  }
  const decoded = Buffer.from(normalized, 'base64url').toString('utf8').trim()
  if (!decoded) throw new Error('KUAIZI_EXTERNAL_ID_TOKEN_INVALID')
  return decoded
}

export function formatKuaiziExternalId(input: {
  type: KuaiziAsyncType
  providerId: string
  modelId: string
  taskId: string
}): string {
  return [
    'KUAIZI',
    input.type,
    encodeKuaiziExternalToken(input.providerId),
    encodeKuaiziExternalToken(input.modelId),
    required(input.taskId, 'TASK_ID'),
  ].join(':')
}
