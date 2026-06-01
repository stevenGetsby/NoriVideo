import { TosClient } from '@volcengine/tos-sdk'
import type { DeleteObjectsResult, SignedUrlParams, StorageProvider, UploadObjectParams, UploadObjectResult } from '@/lib/storage/types'
import { normalizeKey, requireEnv, streamToBuffer, toFetchableUrl } from '@/lib/storage/utils'

type TosClientInstance = InstanceType<typeof TosClient>

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

function buildPublicSigningOptions(
  endpoint: NormalizedEndpoint,
  publicEndpoint: NormalizedEndpoint | null,
): { alternativeEndpoint: string; isCustomDomain: true } | Record<string, never> {
  if (!publicEndpoint || publicEndpoint.endpoint === endpoint.endpoint) {
    return {}
  }
  return {
    alternativeEndpoint: publicEndpoint.endpoint,
    isCustomDomain: true,
  }
}

export class TosStorageProvider implements StorageProvider {
  readonly kind = 'tos' as const

  private readonly bucket: string
  private readonly endpoint: NormalizedEndpoint
  private readonly publicEndpoint: NormalizedEndpoint | null
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private client: TosClientInstance | null = null

  constructor() {
    this.endpoint = normalizeEndpoint(requireEnv('TOS_ENDPOINT'))
    this.publicEndpoint = readOptionalEndpoint('TOS_PUBLIC_ENDPOINT')
    this.accessKeyId = requireEnv('TOS_ACCESS_KEY')
    this.secretAccessKey = requireEnv('TOS_SECRET_KEY')
    this.bucket = requireEnv('TOS_BUCKET')
    this.region = requireEnv('TOS_REGION')
  }

  private getClient(): TosClientInstance {
    if (!this.client) {
      this.client = new TosClient({
        accessKeyId: this.accessKeyId,
        accessKeySecret: this.secretAccessKey,
        bucket: this.bucket,
        region: this.region,
        endpoint: this.endpoint.endpoint,
        secure: this.endpoint.secure,
      })
    }
    return this.client
  }

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const key = normalizeKey(params.key)
    await this.getClient().putObject({
      key,
      body: params.body,
      contentLength: params.body.byteLength,
      contentType: params.contentType,
    })
    return { key }
  }

  async deleteObject(key: string): Promise<void> {
    await this.getClient().deleteObject({ key: normalizeKey(key) })
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

  getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    const signedUrl = this.getClient().getPreSignedUrl({
      key: normalizeKey(params.key),
      method: 'GET',
      expires: params.expiresInSeconds,
      ...buildPublicSigningOptions(this.endpoint, this.publicEndpoint),
    })
    return Promise.resolve(signedUrl)
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.getClient().getObjectV2({
      key: normalizeKey(key),
      dataType: 'buffer',
    })
    return await streamToBuffer(result.data.content)
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