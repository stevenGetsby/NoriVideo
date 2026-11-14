import { describe, expect, it, vi } from 'vitest'
import { findBoundCharacterVoices } from '@/lib/frameos/character-voice-service'
import { replacementMaterialMetadata, supersededByMaterialId, withSupersededMaterial } from '@/lib/frameos/material-supersede'

const file = { originalName: '新形象.png', mimeType: 'image/jpeg', sizeBytes: 1234, width: 640, height: 360 }

describe('retired material marker', () => {
  it.each([null, undefined, 'text', 12, [], {}, { supersededByMaterialId: '' }, { supersededByMaterialId: '   ' }, { supersededByMaterialId: 7 }])(
    'does not treat %j as retired', (metadata) => {
      expect(supersededByMaterialId(metadata)).toBeNull()
    })

  it('reads the replacement id and trims it', () => {
    expect(supersededByMaterialId({ supersededByMaterialId: ' next-1 ' })).toBe('next-1')
  })

  it('marks a row retired without touching the rest of its metadata', () => {
    const metadata = { assetCategory: 'character', voiceMaterialId: 'voice-1' }
    const marked = withSupersededMaterial(metadata, 'next-1')
    expect(marked).toEqual({ assetCategory: 'character', voiceMaterialId: 'voice-1', supersededByMaterialId: 'next-1' })
    expect(metadata).toEqual({ assetCategory: 'character', voiceMaterialId: 'voice-1' })
    expect(withSupersededMaterial(null, 'next-1')).toEqual({ supersededByMaterialId: 'next-1' })
  })
})

describe('replacement metadata', () => {
  const previous = {
    assetCategory: 'character',
    prompt: '红脸长髯',
    voiceMaterialId: 'voice-1',
    originalName: '旧形象.png',
    mimeType: 'image/png',
    sizeBytes: 99,
    width: 100,
    height: 100,
    durationSeconds: 3,
    characterId: 'char-1',
    characterName: '关羽',
    supersededByMaterialId: 'stale',
    replacesMaterialId: 'older',
  }

  it('keeps the classification and moves a still-valid voice onto the new picture', () => {
    expect(replacementMaterialMetadata(previous, 'old-1', file, 'voice-1')).toEqual({
      assetCategory: 'character',
      prompt: '红脸长髯',
      voiceMaterialId: 'voice-1',
      originalName: '新形象.png',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      width: 640,
      height: 360,
      replacesMaterialId: 'old-1',
    })
  })

  it('drops the voice link when that voice is no longer usable', () => {
    const next = replacementMaterialMetadata(previous, 'old-1', file, null)
    expect(next).not.toHaveProperty('voiceMaterialId')
    expect(next.assetCategory).toBe('character')
  })

  it('never inherits facts about the previous file, a project-character link or a retirement marker', () => {
    const next = replacementMaterialMetadata(previous, 'old-1', file, 'voice-1')
    for (const key of ['durationSeconds', 'characterId', 'characterName', 'supersededByMaterialId']) {
      expect(next).not.toHaveProperty(key)
    }
    expect(supersededByMaterialId(next)).toBeNull()
    expect(next.replacesMaterialId).toBe('old-1')
  })

  it('does not mutate the previous row metadata', () => {
    const snapshot = JSON.parse(JSON.stringify(previous))
    replacementMaterialMetadata(previous, 'old-1', file, null)
    expect(previous).toEqual(snapshot)
  })

  it.each([null, undefined, 'text', []])('starts from nothing when the previous metadata is %j', (metadata) => {
    expect(replacementMaterialMetadata(metadata, 'old-1', file, null)).toEqual({
      originalName: '新形象.png', mimeType: 'image/jpeg', sizeBytes: 1234, width: 640, height: 360, replacesMaterialId: 'old-1',
    })
  })
})

describe('voice deletion guard with a retired picture', () => {
  function tx(rows: Array<{ id: string; title: string; metadata: Record<string, unknown> }>) {
    return {
      frameosMaterial: { findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) },
      globalCharacter: { findMany: vi.fn().mockResolvedValue([]) },
      novelPromotionCharacter: { findMany: vi.fn().mockResolvedValue([]) },
    }
  }
  const visible = { id: 'new', title: '关羽', metadata: { voiceMaterialId: 'voice-1' } }
  const hidden = { id: 'old', title: '关羽', metadata: { voiceMaterialId: 'voice-1', supersededByMaterialId: 'new' } }
  const run = (rows: Parameters<typeof tx>[0]) => findBoundCharacterVoices(tx(rows) as never, 'owner-1', ['voice-1'])

  it('keeps the old picture binding the voice, and explains that to the user', async () => {
    const message = (await run([hidden])).get('voice-1')
    expect(message).toContain('关羽')
    expect(message).toContain('替换前的旧图片')
    expect(message).not.toContain('请先解除角色卡音色绑定')
  })

  it('prefers the actionable message of the visible card in either order', async () => {
    for (const rows of [[visible, hidden], [hidden, visible]]) {
      expect((await run(rows)).get('voice-1')).toBe('音色仍被角色「关羽」使用，请先解除角色卡音色绑定。')
    }
  })

  it('leaves the plain binding message unchanged', async () => {
    expect((await run([visible])).get('voice-1')).toBe('音色仍被角色「关羽」使用，请先解除角色卡音色绑定。')
  })
})
