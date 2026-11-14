import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('character voice entry points and per-asset carry toggle', () => {
  it('lets the material library preview set, change and unbind the character voice', () => {
    const library = source('src/components/frameos/views/FosMaterialLibrary.tsx')
    const dialog = source('src/components/frameos/materials/CharacterMaterialVoiceDialog.tsx')
    expect(library).toContain("import { CharacterMaterialVoiceDialog } from '../materials/CharacterMaterialVoiceDialog'")
    expect(library).toContain('data-testid="material-character-voice"')
    expect(library).toContain("item.voice ? '更换音色' : '设置音色'")
    expect(library).toContain('<CharacterMaterialVoiceDialog material={{ id: item.id')
    expect(library).toContain('withCharacterVoiceMaterial(item.metadata, voice?.id || null)')
    // Escape must close only the voice dialog, not the preview behind it.
    expect(library).toContain("event.key === 'Escape' && !voiceOpen")
    expect(dialog).toContain('onSaved: (voice: FrameosMaterialItem | null) => void')
    expect(dialog).toContain('onSaved(voice)')
  })

  it('keeps a visible voice entry on asset cards and in the asset lightbox', () => {
    const assets = source('src/components/frameos/views/FosAssetLibrary.tsx')
    expect(assets).toContain('const voiceHandlerFor = (asset: Asset)')
    expect(assets).toContain('onVoice={voiceHandlerFor(asset)}')
    expect(assets).toContain("{asset.voice?.bound ? '更换音色' : '设置音色'}")
    expect(assets).toContain("'管理角色音色' : '设置角色音色'")
    expect(assets).toContain('function AssetLightbox({ asset, onClose, onVoice')
  })

  it('submits detached character voices and lets the server skip them', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    const route = source('src/app/api/frameos/toolbox/generate/route.ts')
    expect(graph).toContain('voiceDetachedMaterialIds')
    expect(graph).toContain("voiceDetached: nodesRef.current.find((item) => item.id === nodeId)?.data.voiceDetached !== true")
    expect(generator).toContain('拆卸角色音色 ${title}')
    expect(generator).toContain('恢复携带角色音色 ${title}')
    expect(route).toContain("'voiceDetachedMaterialIds'")
    expect(route).toContain('voiceCarryingImages')
    expect(route).toContain('!voiceDetachedIds.has(material.id)')
  })
})
