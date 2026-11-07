export type HuimengiAsyncType = 'IMAGE' | 'VIDEO'

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`HUIMENGI_EXTERNAL_ID_${field}_MISSING`)
  return normalized
}

export function encodeHuimengiExternalToken(value: string): string {
  return Buffer.from(required(value, 'TOKEN'), 'utf8').toString('base64url')
}

export function decodeHuimengiExternalToken(token: string): string {
  const normalized = required(token, 'TOKEN')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error('HUIMENGI_EXTERNAL_ID_TOKEN_INVALID')
  }
  const decoded = Buffer.from(normalized, 'base64url').toString('utf8').trim()
  if (!decoded) throw new Error('HUIMENGI_EXTERNAL_ID_TOKEN_INVALID')
  return decoded
}

export function formatHuimengiExternalId(input: {
  type: HuimengiAsyncType
  providerId: string
  modelId: string
  taskId: string
}): string {
  return [
    'HUIMENGI',
    input.type,
    encodeHuimengiExternalToken(input.providerId),
    encodeHuimengiExternalToken(input.modelId),
    required(input.taskId, 'TASK_ID'),
  ].join(':')
}
