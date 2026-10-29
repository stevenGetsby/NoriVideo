import type {
  SeedanceAssetsApi, SeedanceAssetResult, SeedanceAssetGroupResult, SeedanceAssetGroupListResult,
} from '@/lib/volcengine/seedance-assets-contract'
import { asRecord, postKuaiziApiKey, readString } from './client'

const ASSET_PATH = '/ai-open-platform-api/api/support/v1/asset'

function requireId(value: unknown): string {
  // Long decimal IDs exceed JS safe integers. Reject numbers instead of corrupting IDs.
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('KUAIZI_ASSET_ID_INVALID')
  return value
}

export class KuaiziAssetsClient implements SeedanceAssetsApi {
  constructor(private readonly config: { apiKey: string; baseUrl?: string }) {}

  private async call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const payload = asRecord(await postKuaiziApiKey({
      ...this.config,
      path: `${ASSET_PATH}?Action=${action}&Version=2024-01-01`,
      body,
    }))
    const error = asRecord(asRecord(payload?.ResponseMetadata)?.Error)
    if (error) throw new Error(`KUAIZI_ASSET_ERROR: ${readString(error.Code) || 'UnknownError'}`)
    const result = asRecord(payload?.Result)
    if (!result) throw new Error(`KUAIZI_ASSET_RESULT_MISSING: ${action}`)
    return result as T
  }

  async createAssetGroup(input: Parameters<SeedanceAssetsApi['createAssetGroup']>[0]): Promise<SeedanceAssetGroupResult> {
    const result = await this.call<SeedanceAssetGroupResult>('CreateAssetGroup', {
      Name: input.name.slice(0, 64), Description: (input.description || '').slice(0, 300), GroupType: 'AIGC',
    })
    requireId(result.Id)
    return result
  }

  async listAssetGroups(input: Parameters<SeedanceAssetsApi['listAssetGroups']>[0]): Promise<SeedanceAssetGroupListResult> {
    const result = await this.call<SeedanceAssetGroupListResult>('ListAssetGroups', {
      PageNumber: 1, PageSize: Math.max(1, Math.min(input.pageSize ?? 20, 100)),
    })
    for (const group of result.Items || []) requireId(group.Id)
    return result
  }

  async createImageAsset(input: Parameters<SeedanceAssetsApi['createImageAsset']>[0]): Promise<SeedanceAssetResult> {
    const result = await this.call<SeedanceAssetResult>('CreateAsset', {
      GroupId: requireId(input.groupId), URL: input.url, Name: input.name.slice(0, 64), AssetType: 'Image',
    })
    requireId(result.Id)
    return result
  }

  async getAsset(input: Parameters<SeedanceAssetsApi['getAsset']>[0]): Promise<SeedanceAssetResult> {
    const result = await this.call<SeedanceAssetResult>('GetAsset', { Id: requireId(input.assetId) })
    requireId(result.Id)
    return result
  }
}
