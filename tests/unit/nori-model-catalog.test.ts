import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetServiceConfigCache } from '@/lib/service-config'
import {
  listNoriBusinessModels,
  normalizeProjectBusinessModelKey,
  resolveNoriModelRoute,
} from '@/lib/nori-model-catalog'

function configure(routing: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-model-routing-'))
  const filePath = path.join(directory, 'services.json')
  fs.writeFileSync(filePath, JSON.stringify({ llm: { modelRouting: routing } }))
  vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
  resetServiceConfigCache()
}

describe('Nori business model catalog', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('publishes stable text, image, video and independently routed audio models', () => {
    expect(listNoriBusinessModels('llm')).toHaveLength(4)
    expect(listNoriBusinessModels('image').map((model) => [model.key, model.tier])).toEqual([
      ['nori::nori-image-mini', 'mini'],
      ['nori::nori-image-fast', 'fast'],
      ['nori::nori-image', 'standard'],
      ['nori::nori-image-pro', 'pro'],
    ])
    expect(listNoriBusinessModels('video').map((model) => [model.key, model.tier])).toEqual([
      ['nori::seedance2.0-mini', 'mini'],
      ['nori::seedance2.0-fast', 'fast'],
      ['nori::seedance2.0', 'pro'],
    ])
    expect(listNoriBusinessModels('audio').map((model) => model.key)).toEqual([
      'nori::nori-audio',
      'nori::nori-music',
      'nori::nori-sfx',
    ])
  })

  it('uses the administrator route and normalizes legacy project keys', () => {
    configure({
      'nori::nori-gpt': 'deepseek::deepseek-chat',
      'nori::nori-image': 'hfsy::gpt-image-2',
    })

    expect(resolveNoriModelRoute('nori::nori-gpt')).toBe('deepseek::deepseek-chat')
    expect(normalizeProjectBusinessModelKey('deepseek::deepseek-chat', 'llm')).toBe('nori::nori-gpt')
    expect(normalizeProjectBusinessModelKey('hfsy::gpt-image-2', 'image')).toBe('nori::nori-image')
    expect(normalizeProjectBusinessModelKey('ark::doubao-seedance-1-5-pro', 'video')).toBe('nori::seedance2.0')
  })
})
