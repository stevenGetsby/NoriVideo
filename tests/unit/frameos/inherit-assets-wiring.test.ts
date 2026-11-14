import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { INHERITED_FROM_KEY, inheritedMaterialMetadata, materialOrigin } from '@/lib/frameos/material-inherit'
import { replacementMaterialMetadata } from '@/lib/frameos/material-supersede'

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8')
}

describe('inherited copies in staff statistics', () => {
  it('excludes inherited rows from every upload and retention query', () => {
    const stats = source('src/lib/account/activity-stats.ts')
    const guarded = new RegExp(`m\\.source (?:=|<>) 'upload'\\s+AND JSON_EXTRACT\\(m\\.metadata, '\\$\\.${INHERITED_FROM_KEY}'\\) IS NULL`, 'g')
    // Upload totals, retention (produced assets) and the per-person detail scope.
    expect(stats.match(guarded)).toHaveLength(3)
    expect(stats.match(new RegExp(`'\\$\\.${INHERITED_FROM_KEY}'`, 'g'))).toHaveLength(3)
  })
})

describe('who may change an inherited copy', () => {
  it('lets the material, bulk-delete and replace-image routes act on uploads and inherited copies only', () => {
    for (const file of [
      'src/app/api/frameos/materials/[materialId]/route.ts',
      'src/app/api/frameos/materials/bulk-delete/route.ts',
      'src/lib/frameos/material-replace-image.ts',
    ]) {
      const text = source(file)
      expect(text, file).toMatch(/import \{ isUserManagedMaterial \} from '(?:@\/lib\/frameos\/|\.\/)material-inherit'/)
      expect(text, file).toContain('isUserManagedMaterial(')
      expect(text, file).not.toMatch(/material\.source !== 'upload'/)
    }
    expect(source('src/app/api/frameos/materials/[materialId]/route.ts')).toContain('这里只能删除本地上传或继承的素材；项目产物请在对应工作流中管理。')
    expect(source('src/app/api/frameos/materials/bulk-delete/route.ts')).toContain('只能删除本地上传或继承的素材。')
  })

  it('turns a replaced inherited picture into a fresh upload', () => {
    const copy = inheritedMaterialMetadata(
      { assetCategory: 'character', voiceMaterialId: 'voice-1' },
      { projectId: 'p1', projectName: '第一集', materialId: 'm1' },
      'voice-copy',
    )
    expect(materialOrigin({ source: 'creative', metadata: copy })).toBe('inherited')

    const replaced = replacementMaterialMetadata(
      copy,
      'copy-1',
      { originalName: '新形象.png', mimeType: 'image/png', sizeBytes: 10, width: 1, height: 1 },
      'voice-copy',
    )
    expect(replaced).not.toHaveProperty(INHERITED_FROM_KEY)
    expect(replaced).toMatchObject({ assetCategory: 'character', voiceMaterialId: 'voice-copy' })
    expect(materialOrigin({ source: 'upload', metadata: replaced })).toBe('uploaded')
  })
})

describe('origin badges and duplicate collapsing in the pickers', () => {
  it('collapses duplicates in the canvas assets panel and the picker, but never in the trash or the management library', () => {
    const panel = source('src/features/canvas/components/CanvasProjectAssets.tsx')
    expect(panel).toContain('collapseInheritedDuplicates(materials, projectId)')
    expect(panel).toContain('${listedMaterials.length} 项可用素材')
    const picker = source('src/components/frameos/materials/MaterialPickerDialog.tsx')
    expect(picker).toContain("activeScope === 'trash'")
    expect(picker).toContain('collapseInheritedDuplicates(categorized, projectId?.trim() || \'\', selectedIdSet)')
    expect(picker).toContain('nori-origin-inherited')
    expect(source('src/components/frameos/views/FosMaterialLibrary.tsx')).not.toContain('collapseInheritedDuplicates')
    expect(source('src/components/frameos/views/FosAssetLibrary.tsx')).not.toContain('collapseInheritedDuplicates')
  })

  it('paints the inherited badge with a solid colour', () => {
    const css = source('src/styles/frameos-replica.css')
    const rule = css.match(/\.nori-origin-inherited\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('background: #123a36;')
    expect(rule).toContain('color: #5eead4;')
    expect(rule).not.toMatch(/gradient/i)
  })
})

describe('create dialog wiring', () => {
  it('offers inheritance only for canvas creation and blocks an incomplete choice', () => {
    const dialog = source('src/components/frameos/CreateProjectDialog.tsx')
    expect(dialog).toContain("{draft.creationMode === 'canvas' ? <InheritAssetsSection inherit={inherit} sources={inheritSources} /> : null}")
    expect(dialog).toContain("if (draft.creationMode === 'canvas' && inherit.issue) { setError(inherit.issue); return }")
    expect(dialog).toContain('inheritSourceProjectId: inherit.request.sourceProjectId, inheritMaterialIds: inherit.request.materialIds')
  })

  it('posts the choice only for canvas creation with at least one asset', () => {
    const client = source('src/components/frameos/FosProjectsClient.tsx')
    expect(client).toContain("draft.creationMode === 'canvas' && draft.inheritSourceProjectId")
    expect(client).toContain('if (draft.inheritSourceProjectId && inheritMaterialIds.length > 0) {')
    expect(client).toContain("form.set('inheritSourceProjectId', draft.inheritSourceProjectId)")
    expect(client).toContain("form.set('inheritMaterialIds', JSON.stringify(inheritMaterialIds))")
  })

  it('reads the source library through the shared paginated helper', () => {
    const hook = source('src/components/frameos/works/useInheritAssets.ts')
    expect(hook).toContain("scope: 'project'")
    expect(hook).toContain("sync: '1'")
    expect(hook).toContain('fetchAllFrameosMaterials(params, controller.signal)')
    expect(hook).toContain('items.filter(isInheritableMaterial)')
  })
})
