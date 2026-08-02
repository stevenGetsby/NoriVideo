export type MaterialType = 'image' | 'video' | 'audio' | 'model3d'

export interface FrameosMaterialItem {
  id: string
  projectId: string
  projectName: string
  ownerName: string | null
  title: string | null
  type: MaterialType
  source: 'toolbox' | 'creative' | 'production' | 'upload'
  status: 'ready' | 'processing' | 'failed'
  isFavorited: boolean
  resultUrl: string | null
  storageKey: string | null
  url: string | null
  metadata?: Record<string, unknown> | null
  deletedAt?: string | null
  deletedById?: string | null
  createdAt: string
  updatedAt: string
}

export interface FrameosMaterialProjectOption {
  id: string
  name: string
}

export interface FrameosMaterialLibraryCapabilities {
  trash: {
    supported: boolean
    count: number
    reason: string | null
  }
}

export const MATERIAL_SOURCE_LABELS: Record<FrameosMaterialItem['source'], string> = {
  toolbox: '工具箱',
  creative: '资产生成',
  production: '项目制作',
  upload: '本地上传',
}
