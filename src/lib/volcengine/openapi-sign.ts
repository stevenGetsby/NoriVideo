import crypto from 'crypto'

export interface VolcengineSignInput {
  method: 'POST'
  host: string
  path: string
  query: Record<string, string>
  body: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  service?: string
  now?: Date
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest()
}

function hmacHex(key: Buffer | string, value: string): string {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

function formatXDate(date: Date): string {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return iso
}

function formatShortDate(date: Date): string {
  return formatXDate(date).slice(0, 8)
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

export function signVolcengineOpenApi(input: VolcengineSignInput): HeadersInit {
  const region = input.region || 'cn-beijing'
  const service = input.service || 'ark'
  const now = input.now || new Date()
  const xDate = formatXDate(now)
  const shortDate = formatShortDate(now)
  const payloadHash = sha256Hex(input.body)

  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${input.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    '',
  ].join('\n')

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const dateKey = hmac(input.secretAccessKey, shortDate)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  const signingKey = hmac(serviceKey, 'request')
  const signature = hmacHex(signingKey, stringToSign)

  return {
    'Content-Type': 'application/json',
    Host: input.host,
    'X-Date': xDate,
    'X-Content-Sha256': payloadHash,
    Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
