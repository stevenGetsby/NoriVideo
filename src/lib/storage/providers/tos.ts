import type { DeleteObjectsResult, SignedUrlParams, StorageProvider, UploadObjectParams, UploadObjectResult } from '@/lib/storage/types'
import { normalizeKey, requireEnv, streamToBuffer, toFetchableUrl } from '@/lib/storage/utils'
import { createHash, createHmac } from 'node:crypto'

interface NormalizedEndpoint {
  endpoint: string
  secure: boolean
}

function normalizeEndpoint(raw: string): NormalizedEndpoint {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const parsed = new URL(trimmed)
    return {
      endpoint: parsed.host,
      secure: parsed.protocol === 'https:',
    }
  }
  return {
    endpoint: trimmed.replace(/^\/+/, ''),
    secure: true,
  }
}

function readOptionalEndpoint(name: string): NormalizedEndpoint | null {
  const value = process.env[name]?.trim()
  return value ? normalizeEndpoint(value) : null
}

function toEndpointUrl(endpoint: NormalizedEndpoint): string {
  return `${endpoint.secure ? 'https' : 'http'}://${endpoint.endpoint}`
}

export class TosStorageProvider implements StorageProvider {
  readonly kind = 'tos' as const

  private readonly bucket: string
  private readonly endpoint: NormalizedEndpoint
  private readonly publicEndpoint: NormalizedEndpoint | null
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly forcePathStyle: boolean

  constructor() {
    this.endpoint = normalizeEndpoint(requireEnv('TOS_ENDPOINT'))
    this.publicEndpoint = readOptionalEndpoint('TOS_PUBLIC_ENDPOINT')
    this.accessKeyId = requireEnv('TOS_ACCESS_KEY')
    this.secretAccessKey = requireEnv('TOS_SECRET_KEY')
    this.bucket = requireEnv('TOS_BUCKET')
    this.region = requireEnv('TOS_REGION')
    this.forcePathStyle = process.env.TOS_FORCE_PATH_STYLE === 'true'
  }

  private objectUrl(key: string, endpoint: NormalizedEndpoint = this.endpoint): URL {
    const encodedKey = encodeStoragePath(key)
    const protocol = endpoint.secure ? 'https' : 'http'
    if (this.forcePathStyle) {
      return new URL(`${protocol}://${endpoint.endpoint}/${this.bucket}/${encodedKey}`)
    }
    return new URL(`${protocol}://${this.bucket}.${endpoint.endpoint}/${encodedKey}`)
  }

  private signRequest(input: {
    method: string
    url: URL
    body?: Buffer
    headers?: Record<string, string>
    unsignedPayload?: boolean
    now?: Date
  }): Record<string, string> {
    const now = input.now ?? new Date()
    const amzDate = toAmzDate(now)
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = 'UNSIGNED-PAYLOAD'
    const headersToSend = normalizeHeaders({
      ...(input.headers || {}),
      host: input.url.host,
      'x-tos-content-sha256': payloadHash,
      'x-tos-date': amzDate,
    })
    const headersToSign = pickTosSignedHeaders(headersToSend)
    const signedHeaders = Object.keys(headersToSign).sort().join(';')
    const canonicalRequest = [
      input.method.toUpperCase(),
      input.url.pathname,
      canonicalQuery(input.url.searchParams),
      canonicalHeaders(headersToSign),
      signedHeaders,
      payloadHash,
    ].join('\n')
    const credentialScope = `${dateStamp}/${this.region}/tos/request`
    const stringToSign = [
      'TOS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = hmacHex(signingKey(this.secretAccessKey, dateStamp, this.region, 'tos'), stringToSign)
    return {
      ...headersToSend,
      Authorization: `TOS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    }
  }

  private async signedFetch(input: {
    method: string
    url: URL
    body?: Buffer
    contentType?: string
    unsignedPayload?: boolean
  }): Promise<Response> {
    const headers = this.signRequest({
      method: input.method,
      url: input.url,
      body: input.body,
      unsignedPayload: input.unsignedPayload,
      headers: input.contentType ? { 'content-type': input.contentType } : undefined,
    })
    const res = await fetch(input.url, {
      method: input.method,
      headers,
      body: input.body ? new Uint8Array(input.body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`TOS_${input.method}_FAILED: ${res.status} ${res.statusText}${text ? ` ${text.slice(0, 500)}` : ''}`)
    }
    return res
  }

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const key = normalizeKey(params.key)
    await this.signedFetch({
      method: 'PUT',
      url: this.objectUrl(key),
      body: params.body,
      contentType: params.contentType,
    })
    return { key }
  }

  async deleteObject(key: string): Promise<void> {
    await this.signedFetch({
      method: 'DELETE',
      url: this.objectUrl(normalizeKey(key)),
    })
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const validKeys = keys.map(normalizeKey).filter((key) => key.length > 0)
    let success = 0
    let failed = 0
    for (const key of validKeys) {
      try {
        await this.deleteObject(key)
        success += 1
      } catch {
        failed += 1
      }
    }
    return { success, failed }
  }

  async getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    const url = this.objectUrl(normalizeKey(params.key), this.publicEndpoint || this.endpoint)
    const now = new Date()
    const amzDate = toAmzDate(now)
    const dateStamp = amzDate.slice(0, 8)
    const credentialScope = `${dateStamp}/${this.region}/tos/request`
    url.searchParams.set('X-Tos-Algorithm', 'TOS4-HMAC-SHA256')
    url.searchParams.set('X-Tos-Content-Sha256', 'UNSIGNED-PAYLOAD')
    url.searchParams.set('X-Tos-Credential', `${this.accessKeyId}/${credentialScope}`)
    url.searchParams.set('X-Tos-Date', amzDate)
    url.searchParams.set('X-Tos-Expires', String(Math.max(1, Math.floor(params.expiresInSeconds))))
    url.searchParams.set('X-Tos-SignedHeaders', 'host')
    const canonicalRequest = [
      'GET',
      url.pathname,
      canonicalQuery(url.searchParams),
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const stringToSign = [
      'TOS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    url.searchParams.set('X-Tos-Signature', hmacHex(signingKey(this.secretAccessKey, dateStamp, this.region, 'tos'), stringToSign))
    return url.toString()
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.signedFetch({
      method: 'GET',
      url: this.objectUrl(normalizeKey(key)),
      unsignedPayload: true,
    })
    return await streamToBuffer(res.body)
  }

  extractStorageKey(input: string | null | undefined): string | null {
    if (!input) return null
    if (!input.startsWith('http') && !input.startsWith('/')) {
      return normalizeKey(input)
    }

    try {
      const parsed = new URL(input)
      let pathname = parsed.pathname.replace(/^\/+/, '')
      const bucketPrefix = `${this.bucket}/`
      if (pathname.startsWith(bucketPrefix)) {
        pathname = pathname.slice(bucketPrefix.length)
      }
      return normalizeKey(pathname) || null
    } catch {
      return null
    }
  }

  toFetchableUrl(inputUrl: string): string {
    return toFetchableUrl(inputUrl)
  }

  generateUniqueKey(params: { prefix: string; ext: string }): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `images/${params.prefix}-${timestamp}-${random}.${params.ext}`
  }
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex')
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = hmac(secretAccessKey, dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  return hmac(serviceKey, 'request')
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function encodeStoragePath(key: string): string {
  return normalizeKey(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function canonicalHeaders(headers: Record<string, string>): string {
  return Object.entries(normalizeHeaders(headers))
    .map(([key, value]) => `${key}:${value.replace(/\s+/g, ' ')}\n`)
    .join('')
}

function pickTosSignedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => value != null && (key === 'host' || key.startsWith('x-tos-'))),
  )
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) => keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}