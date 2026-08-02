import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('manual asset and storyboard controls', () => {
  it('submits manual characters, location-backed assets, and character variants to real APIs', () => {
    const shared = source('src/components/frameos/views/FosAssetShared.tsx')
    const setting = source('src/components/frameos/views/FosAssetSetting.tsx')
    expect(shared).toContain('/api/novel-promotion/${projectId}/character')
    expect(shared).toContain('/api/novel-promotion/${projectId}/location')
    expect(shared).toContain('/api/novel-promotion/${projectId}/character/appearance')
    expect(setting).toContain('添加角色变体')
    expect(setting).toContain('<AddCharacterVariantDialog')
    expect(setting).toContain('handleDeleteAsset')
    expect(setting).toContain("const endpoint = tab === 'characters' ? 'character' : 'location'")
    expect(setting).toContain('handleDeleteCharacterVariant')
    expect(setting).toContain('删除变体')
    expect(setting).not.toContain('取消确认')
  })

  it('supports AI episode parsing and a script-free manual Segment workflow', () => {
    const storyboard = source('src/components/frameos/views/FosStoryboard.tsx')
    const manualRoute = source('src/app/api/novel-promotion/[projectId]/panel/manual/route.ts')
    expect(storyboard).toContain('解析本集分镜')
    expect(storyboard).toContain('手动制作分镜')
    expect(storyboard).toContain('在此后添加自由 Segment')
    expect(storyboard).toContain('添加自由 Segment')
    expect(storyboard).toContain('/api/novel-promotion/${projectId}/panel/manual')
    expect(storyboard).toContain('freeform: true')
    expect(storyboard).not.toContain('AddStoryboardPanelDialog')
    expect(storyboard).toContain('storyboardId: scene.storyboardId')
    expect(storyboard).toContain('await loadStoryboards(true)')
    expect(storyboard).toContain("body: JSON.stringify({ panelId, reorderDirection: direction })")
    expect(storyboard).toContain("method: 'DELETE'")
    expect(storyboard).toContain('再次点击确认删除')
    expect(storyboard).toContain('其余镜头已自动重新编号')
    expect(storyboard).toContain("assetCategory={pickerKind === '角色' ? 'character' : pickerKind === '环境' ? 'location' : 'prop'}")
    expect(storyboard).toContain('setPickerKind(null)')
    expect(manualRoute).toContain("body.mode === 'freeform'")
    expect(manualRoute).toContain("sceneType: freeform ? 'manual-freeform' : 'manual'")
    expect(manualRoute).toContain('tx.novelPromotionClip.create')
    expect(manualRoute).toContain('tx.novelPromotionStoryboard.create')
    expect(manualRoute).toContain('tx.novelPromotionPanel.create')
  })
})
