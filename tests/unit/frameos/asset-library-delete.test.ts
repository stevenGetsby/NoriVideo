import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('asset library upload delete affordance', () => {
  it('shows delete only for uploaded material cards and calls the guarded material route', () => {
    const source = fs.readFileSync('src/components/frameos/views/FosAssetLibrary.tsx', 'utf8')
    expect(source).toContain('asset.uploadMaterialId && canEditAssets')
    expect(source).toContain("material.source === 'upload'")
    expect(source).toContain('title="删除上传资产"')
    expect(source).toContain('/api/frameos/materials/${encodeURIComponent(materialId)}')
    expect(source).toContain('删除上传素材失败')
  })
})
