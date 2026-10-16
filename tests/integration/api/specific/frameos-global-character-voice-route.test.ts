import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
const auth = vi.hoisted(() => vi.fn())
const mock = vi.hoisted(() => {
  const client = {
    globalCharacter: { findFirst: vi.fn(), update: vi.fn() },
    frameosMaterial: { findFirst: vi.fn(), updateMany: vi.fn() },
    mediaObject: { findUnique: vi.fn() },
  }
  return { ...client, $transaction: vi.fn(async (operation: (tx: typeof client) => unknown) => operation(client)) }
})
vi.mock('@/lib/prisma', () => ({ prisma: mock }))
vi.mock('@/lib/api-auth', () => ({ requireUserPermission: auth, isErrorResponse: (value: unknown) => value instanceof Response }))
import { PATCH } from '@/app/api/frameos/character-voices/[characterId]/route'
function post(body: unknown) {
  return PATCH(buildMockRequest({ path: '/api/frameos/character-voices/role', method: 'PATCH', body }), { params: Promise.resolve({ characterId: 'role' }) })
}
describe('global structured character voice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ session: { user: { id: 'owner' } } })
    mock.globalCharacter.findFirst.mockResolvedValue({ id: 'role' })
    mock.globalCharacter.update.mockResolvedValue({ id: 'role' })
    mock.frameosMaterial.findFirst.mockResolvedValue({ id: 'voice', storageKey: 'voice/role.wav', updatedAt: new Date() })
    mock.frameosMaterial.updateMany.mockResolvedValue({ count: 1 })
    mock.mediaObject.findUnique.mockResolvedValue({ id: 'voice-media' })
  })
  it('requires asset editing and persists a scoped uploaded voice/media reference', async () => {
    expect((await post({ voiceMaterialId: 'voice' })).status).toBe(200)
    expect(auth).toHaveBeenCalledWith(['assetWrite'])
    expect(mock.frameosMaterial.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'owner', projectId: { in: ['global', 'global-asset-hub'] }, type: 'audio', deletedAt: null }) }))
    expect(mock.globalCharacter.update).toHaveBeenCalledWith({ where: { id: 'role' }, data: { voiceType: 'uploaded', voiceId: null, globalVoiceId: null, customVoiceUrl: 'voice/role.wav', customVoiceMediaId: 'voice-media' } })
  })
  it('rejects foreign role/voice and writes nothing', async () => {
    mock.globalCharacter.findFirst.mockResolvedValueOnce(null)
    expect((await post({ voiceMaterialId: 'voice' })).status).toBe(404)
    expect(mock.globalCharacter.update).not.toHaveBeenCalled()
    mock.frameosMaterial.findFirst.mockResolvedValueOnce(null)
    expect((await post({ voiceMaterialId: 'voice-private' })).status).toBe(404)
    expect(mock.globalCharacter.update).not.toHaveBeenCalled()
  })
  it('clears every old voice mechanism when unbinding', async () => {
    expect((await post({ voiceMaterialId: null })).status).toBe(200)
    expect(mock.globalCharacter.update).toHaveBeenCalledWith({ where: { id: 'role' }, data: { voiceType: null, voiceId: null, globalVoiceId: null, customVoiceUrl: null, customVoiceMediaId: null } })
  })
  it('rejects malformed input and concurrent voice deletion', async () => {
    expect((await post({ voiceMaterialId: true })).status).toBe(400)
    mock.frameosMaterial.updateMany.mockResolvedValueOnce({ count: 0 })
    expect((await post({ voiceMaterialId: 'voice' })).status).toBe(409)
    expect(mock.globalCharacter.update).not.toHaveBeenCalled()
  })
})
