import { signVolcengineOpenApi } from './openapi-sign'

const DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volcengineapi.com'
const API_VERSION = '2024-01-01'

export type SeedanceAssetStatus = 'Active' | 'Processing' | 'Failed'

export interface SeedanceAssetsClientConfig {
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  region?: string
  service?: string
}

export interface SeedanceAssetGroupResult {
  Id: string
  Name?: string
  ProjectName?: string
}

export interface SeedanceAssetResult {
  Id: string
  Name?: string
  URL?: string
  AssetType?: 'Image' | 'Video' | 'Audio'
  GroupId?: string
  Status?: SeedanceAssetStatus
  Error?: {
    Code?: string
    Message?: string
  }
  ProjectName?: string
}

interface OpenApiResponse<T> {
  ResponseMetadata?: {
    RequestId?: string
    Error?: {
      Code?: string
      Message?: string
    }
  }
  Result?: T
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as OpenApiResponse<unknown>
  const error = record.ResponseMetadata?.Error
  if (error?.Message || error?.Code) {
    return [error.Code, error.Message].filter(Boolean).join(': ')
  }
  return fallback
}

export class SeedanceAssetsClient {
  private readonly endpoint: URL
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly region: string
  private readonly service: string

  constructor(config: SeedanceAssetsClientConfig) {
    this.endpoint = new URL(config.endpoint || DEFAULT_ENDPOINT)
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region || 'cn-beijing'
    this.service = config.service || 'ark'
  }

  private async call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const requestBody = JSON.stringify(body)
    const query = { Action: action, Version: API_VERSION }
    const url = new URL('/', this.endpoint)
    url.searchParams.set('Action', action)
    url.searchParams.set('Version', API_VERSION)

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: signVolcengineOpenApi({
        method: 'POST',
        host: this.endpoint.host,
        path: '/',
        query,
        body: requestBody,
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        region: this.region,
        service: this.service,
      }),
      body: requestBody,
    })

    const text = await response.text()
    let payload: OpenApiResponse<T> | null = null
    try {
      payload = text ? JSON.parse(text) as OpenApiResponse<T> : null
    } catch {
      payload = null
    }

    if (!response.ok || payload?.ResponseMetadata?.Error) {
      throw new Error(readErrorMessage(payload, `Volcengine ${action} failed: HTTP ${response.status} ${text}`))
    }
    if (!payload?.Result) {
      throw new Error(`Volcengine ${action} did not return Result`)
    }
    return payload.Result
  }

  async createAssetGroup(input: {
    name: string
    description?: string
    projectName: string
  }): Promise<SeedanceAssetGroupResult> {
    return await this.call<SeedanceAssetGroupResult>('CreateAssetGroup', {
      Name: input.name.slice(0, 64),
      Description: (input.description || '').slice(0, 300),
      GroupType: 'AIGC',
      ProjectName: input.projectName,
    })
  }

  async createImageAsset(input: {
    groupId: string
    url: string
    name: string
    projectName: string
  }): Promise<SeedanceAssetResult> {
    return await this.call<SeedanceAssetResult>('CreateAsset', {
      GroupId: input.groupId,
      URL: input.url,
      Name: input.name.slice(0, 64),
      AssetType: 'Image',
      ProjectName: input.projectName,
    })
  }

  async getAsset(input: {
    assetId: string
    projectName: string
  }): Promise<SeedanceAssetResult> {
    return await this.call<SeedanceAssetResult>('GetAsset', {
      Id: input.assetId,
      ProjectName: input.projectName,
    })
  }
}
