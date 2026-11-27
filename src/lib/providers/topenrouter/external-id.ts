function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`TOPENROUTER_EXTERNAL_ID_${field}_MISSING`)
  return normalized
}

export function encodeTopenrouterExternalToken(value: string): string {
  return Buffer.from(required(value, 'TOKEN'), 'utf8').toString('base64url')
}

export function decodeTopenrouterExternalToken(token: string): string {
  const normalized = required(token, 'TOKEN')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error('TOPENROUTER_EXTERNAL_ID_TOKEN_INVALID')
  }
  const decoded = Buffer.from(normalized, 'base64url').toString('utf8').trim()
  if (!decoded) throw new Error('TOPENROUTER_EXTERNAL_ID_TOKEN_INVALID')
  return decoded
}

export function formatTopenrouterExternalId(input: {
  providerId: string
  modelId: string
  taskId: string
}): string {
  return [
    'TOPENROUTER',
    'VIDEO',
    encodeTopenrouterExternalToken(input.providerId),
    encodeTopenrouterExternalToken(input.modelId),
    required(input.taskId, 'TASK_ID'),
  ].join(':')
}
