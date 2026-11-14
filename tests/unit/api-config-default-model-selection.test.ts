import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetServiceConfigCache } from '@/lib/service-config'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  decryptApiKey: vi.fn((value: string) => value),
  encryptApiKey: vi.fn((value: string) => value),
}))

import { getModelsByType, resolveModelSelection } from '@/lib/api-config'

describe('api-config default model selections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('KUAIZI_API_KEY', 'test-kuaizi-key')
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: JSON.stringify([]),
      customProviders: JSON.stringify([
        {
          id: 'ark',
          name: 'Volcengine Ark',
          apiKey: 'encrypted-key',
        },
      ]),
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: 'ark::doubao-seedance-1-0-pro-fast-251015',
      audioModel: null,
      lipSyncModel: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('rejects business and direct upstream submissions after their route is disabled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-disabled-model-'))
    const filePath = path.join(directory, 'services.json')
    fs.writeFileSync(filePath, JSON.stringify({
      llm: {
        providers: [{ id: 'kuaizi', name: 'Kuaizi' }],
        modelRouting: {
          'nori::norivideo2.5': '',
          'nori::seedance2.0': '',
          'nori::seedance2.0-fast': '',
          'nori::seedance2.0-mini': '',
        },
      },
    }))
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()

    await expect(resolveModelSelection('user-1', 'nori::norivideo2.5', 'video')).rejects.toThrow('MODEL_NOT_FOUND')
    await expect(resolveModelSelection('user-1', 'kuaizi::doubao-seedance-2-5-260628', 'video')).rejects.toThrow('MODEL_NOT_ADMIN_ENABLED')
  })

  it('does not resolve audio from a direct upstream key when its only admin route is disabled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-disabled-audio-'))
    const filePath = path.join(directory, 'services.json')
    fs.writeFileSync(filePath, JSON.stringify({
      llm: {
        providers: [{ id: 'kuaizi', name: 'Kuaizi' }],
        modelRouting: { 'nori::nori-audio': '' },
      },
    }))
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()

    for (const modelKey of ['nori::nori-audio', 'kuaizi::speech-2.8-hd']) {
      await expect(resolveModelSelection('user-1', modelKey, 'audio')).rejects.toThrow('MODEL_')
    }
  })

  it('routes a legacy video model through the administrator-controlled Seedance alias', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'ark::doubao-seedance-1-0-pro-fast-251015',
      'video',
    )).resolves.toEqual({
      provider: 'kuaizi',
      modelId: 'doubao-seedance-2-0-fast-260128',
      modelKey: 'kuaizi::doubao-seedance-2-0-fast-260128',
      mediaType: 'video',
    })
  })

  it('includes the routed Seedance provider model in runtime model listing', async () => {
    const models = await getModelsByType('user-1', 'video')

    expect(models).toContainEqual(expect.objectContaining({
      provider: 'kuaizi',
      modelId: 'doubao-seedance-2-0-260128',
      modelKey: 'kuaizi::doubao-seedance-2-0-260128',
      type: 'video',
    }))
  })

  it('uses the enabled admin capability behind a saved provider key', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'kuaizi::doubao-seedance-2-5-260628',
      'video',
    )).resolves.toEqual({
      provider: 'kuaizi',
      modelId: 'doubao-seedance-2-5-260628',
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      mediaType: 'video',
    })
  })

  it('rejects a real model key used for a different media type', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'openlux::gpt-image-2.5-sunburst',
      'video',
    )).rejects.toThrow('MODEL_TYPE_MISMATCH')
  })

  it('rejects a provider key when several admin capabilities share its route', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'deepseek::deepseek-chat',
      'llm',
    )).rejects.toThrow('MODEL_NOT_ADMIN_ENABLED')
  })

  it('still resolves legacy business keys through the administrator route', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'nori::norivideo2.5',
      'video',
    )).resolves.toMatchObject({
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      mediaType: 'video',
    })
  })
})
