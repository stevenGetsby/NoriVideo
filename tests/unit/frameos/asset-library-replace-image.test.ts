import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const read = (file: string) => fs.readFileSync(file, 'utf8')

describe('library picture replacement wiring', () => {
  it('hides retired-but-referenced pictures from every library listing without cutting pagination short', () => {
    const source = read('src/app/api/frameos/materials/route.ts')
    expect(source).toContain('!supersededByMaterialId(material.metadata)')
    expect(source).toContain('materials: visibleMaterials.map(')
    // A hidden row must not end the page early: the cursor follows the unfiltered batch.
    expect(source).toContain('nextCursor: materials.length === limit ? materials.at(-1)?.id || null : null')
  })

  it('exposes the replacement as an assetWrite-only POST that is registered with the route catalog', () => {
    const route = read('src/app/api/frameos/materials/[materialId]/replace-image/route.ts')
    expect(route).toContain('export const POST = apiHandler(')
    expect(route).toContain("requireUserPermission(['assetWrite'])")
    expect(route).toContain('replaceFrameosMaterialImage(request, authResult.session, materialId)')
    expect(read('tests/contracts/route-catalog.ts')).toContain('src/app/api/frameos/materials/[materialId]/replace-image/route.ts')
  })

  it('never edits the original row in place', () => {
    const source = read('src/lib/frameos/material-replace-image.ts')
    expect(source).toContain('tx.frameosMaterial.create(')
    expect(source).not.toMatch(/frameosMaterial\.update\(/)
    expect(source).toContain('updatedAt: previous.updatedAt')
    expect(source).toContain('{ timeout: 30_000 }')
  })

  it('offers the replacement only on editable uploaded cards and in their preview', () => {
    const source = read('src/components/frameos/views/FosAssetLibrary.tsx')
    expect(source).toContain('onReplace={asset.uploadMaterialId && canEditAssets ? () => startReplaceImage(asset) : undefined}')
    expect(source).toContain('onReplace={lightbox.uploadMaterialId && canEditAssets ? () => startReplaceImage(lightbox) : undefined}')
    expect(source).toContain('aria-label="选择替换图片"')
    expect(source).toContain('replaceFrameosMaterialImage(target.uploadMaterialId, file)')
    expect(source).toContain('describeMaterialImageReplacement(target.name, result)')
    expect(source).toContain('aria-label={`替换图片 ${asset.name}`}')
    expect(source).toContain('aria-label={`在预览中替换图片 ${asset.name}`}')
  })

  it('keeps the replace and delete paths mutually exclusive with the other library writes', () => {
    const source = read('src/components/frameos/views/FosAssetLibrary.tsx')
    expect(source).toContain('const replaceDisabled = mutationBusy.current || Boolean(deletingMaterialId)')
    expect(source).toMatch(/if \(!canEditAssets \|\| !target\?\.uploadMaterialId \|\| mutationBusy\.current\) return/)
    expect(source).toContain("mutationBusy.current = true\n    setReplacingMaterialId(target.uploadMaterialId)")
  })
})
