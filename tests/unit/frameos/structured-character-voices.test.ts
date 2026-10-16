import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  characterAppearance: { findMany: vi.fn() },
  globalCharacterAppearance: { findMany: vi.fn() },
  frameosMaterial: { findFirst: vi.fn() },
}))
const media = vi.hoisted(() => ({ read: vi.fn(), register: vi.fn(), duration: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: mock }))
vi.mock('@/lib/storage', () => ({ extractStorageKey: (source: string) => source.startsWith('voice/') ? source : null, getObjectBuffer: media.read }))
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: media.register }))
vi.mock('@/lib/media/duration-probe', () => ({ probeMediaDurationSeconds: media.duration }))
import { materializeStructuredCharacterVoices } from '@/lib/frameos/structured-character-voices'
describe('structured character references reuse uploaded voices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.characterAppearance.findMany.mockResolvedValue([{ character: { id: 'role', name: '关羽', customVoiceUrl: 'voice/role.wav', customVoiceMedia: null } }])
    mock.globalCharacterAppearance.findMany.mockResolvedValue([])
    mock.frameosMaterial.findFirst.mockResolvedValue(null)
    media.read.mockResolvedValue(Buffer.from('test-voice'))
    media.duration.mockResolvedValue(3)
    media.register.mockResolvedValue({ id: 'voice-material', type: 'audio' })
  })
  it('scopes the lookup to authorised project and registers actual measured audio duration', async () => {
    expect(await materializeStructuredCharacterVoices({ userId: 'owner', projectId: 'project', images: [{ metadata: { originType: 'character', originId: 'appearance' } }] })).toEqual([{ id: 'voice-material', type: 'audio' }])
    expect(mock.characterAppearance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['appearance'] }, character: { novelPromotionProject: { projectId: 'project' } } } }))
    expect(media.register).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ durationSeconds: 3, characterId: 'role' }) }))
  })
  it('never imports characters from another workspace/project or non-character metadata', async () => {
    mock.characterAppearance.findMany.mockResolvedValue([])
    expect(await materializeStructuredCharacterVoices({ userId: 'owner', projectId: 'project', images: [{ metadata: { originType: 'character', originId: 'foreign' } }] })).toEqual([])
    expect(media.read).not.toHaveBeenCalled()
    expect(await materializeStructuredCharacterVoices({ userId: 'owner', projectId: 'project', images: [{ metadata: { originType: 'location', originId: 'foreign' } }] })).toEqual([])
  })
  it('reuses an existing audio without rereading/reuploading bytes', async () => {
    mock.frameosMaterial.findFirst.mockResolvedValue({ id: 'cached', metadata: { durationSeconds: 3 } })
    expect(await materializeStructuredCharacterVoices({ userId: 'owner', projectId: 'project', images: [{ metadata: { originType: 'character', originId: 'appearance' } }] })).toEqual([{ id: 'cached', metadata: { durationSeconds: 3 } }])
    expect(media.read).not.toHaveBeenCalled()
    expect(media.register).not.toHaveBeenCalled()
  })
})
