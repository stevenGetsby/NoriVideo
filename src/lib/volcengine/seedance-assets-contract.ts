export type SeedanceAssetStatus = 'Active' | 'Processing' | 'Failed'

export interface SeedanceAssetGroupResult {
  Id: string
  Name?: string
  ProjectName?: string
}

export interface SeedanceAssetGroupListResult {
  AssetGroups?: SeedanceAssetGroupResult[]
  Groups?: SeedanceAssetGroupResult[]
  Items?: SeedanceAssetGroupResult[]
  Total?: number
  TotalCount?: number
}

export interface SeedanceAssetResult {
  Id: string
  Name?: string
  URL?: string
  AssetType?: 'Image' | 'Video' | 'Audio'
  GroupId?: string
  Status?: SeedanceAssetStatus
  Error?: { Code?: string; Message?: string }
  ProjectName?: string
}

export interface SeedanceAssetsApi {
  createAssetGroup(input: {
    name: string
    description?: string
    projectName: string
  }): Promise<SeedanceAssetGroupResult>
  listAssetGroups(input: {
    projectName: string
    pageSize?: number
  }): Promise<SeedanceAssetGroupListResult>
  createImageAsset(input: {
    groupId: string
    url: string
    name: string
    projectName: string
  }): Promise<SeedanceAssetResult>
  getAsset(input: {
    assetId: string
    projectName: string
  }): Promise<SeedanceAssetResult>
}
