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
  fs.writeFileSync(filePath, JSON.stringify({
    llm: {
      providers: [{ id: 'deepseek' }, { id: 'openlux' }, { id: 'kuaizi' }],
      modelRouting: routing,
    },
  }))
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
      ['nori::norivideo2.5', 'pro'],
    ])
    expect(listNoriBusinessModels('audio').map((model) => model.key)).toEqual([
      'nori::nori-audio',
      'nori::nori-music',
      'nori::nori-sfx',
    ])
  })

  it('suggests OpenLux image routes and provider-correct routes for the other capabilities', () => {
    configure({})

    expect(resolveNoriModelRoute('nori::nori-image-mini')).toBe('openlux::gpt-image-2.5-flare')
    expect(resolveNoriModelRoute('nori::nori-image-fast')).toBe('openlux::gpt-image-2.5-flare')
    expect(resolveNoriModelRoute('nori::nori-image')).toBe('openlux::gpt-image-2.5-sunburst')
    expect(resolveNoriModelRoute('nori::nori-image-pro')).toBe('openlux::gpt-image-2.5-sunburst')
    expect(resolveNoriModelRoute('nori::nori-gpt')).toBe('deepseek::deepseek-chat')
    expect(resolveNoriModelRoute('nori::seedance2.0')).toBe('kuaizi::doubao-seedance-2-0-260128')
    expect(resolveNoriModelRoute('nori::nori-audio')).toBe('kuaizi::speech-2.8-hd')
  })

  it('uses the administrator route and normalizes legacy project keys', () => {
    configure({
      'nori::nori-gpt': 'deepseek::deepseek-chat',
      'nori::nori-image': 'openlux::gpt-image-2.5-sunburst',
    })

    expect(resolveNoriModelRoute('nori::nori-gpt')).toBe('deepseek::deepseek-chat')
    expect(resolveNoriModelRoute('nori::nori-image')).toBe('openlux::gpt-image-2.5-sunburst')
    expect(normalizeProjectBusinessModelKey('deepseek::deepseek-chat', 'llm')).toBe('nori::nori-gpt')
    expect(normalizeProjectBusinessModelKey('hfsy::gpt-image-2', 'image')).toBe('nori::nori-image')
    expect(normalizeProjectBusinessModelKey('ark::doubao-seedance-1-5-pro', 'video')).toBe('nori::seedance2.0')
    expect(normalizeProjectBusinessModelKey('kuaizi::doubao-seedance-2-5-260628', 'video')).toBe('nori::norivideo2.5')
  })

  it('accepts HuiMeng for image and video while keeping text and audio fixed', () => {
    configure({
      'nori::nori-image': 'huimengi::seedream-5.0-pro',
      'nori::seedance2.0': 'huimengi::wan3.0-video',
      'nori::nori-gpt': 'huimengi::seedream-5.0-pro',
      'nori::nori-audio': 'huimengi::wan3.0-video',
    })

    expect(resolveNoriModelRoute('nori::nori-image')).toBe('huimengi::seedream-5.0-pro')
    expect(resolveNoriModelRoute('nori::seedance2.0')).toBe('huimengi::wan3.0-video')
    expect(resolveNoriModelRoute('nori::nori-gpt')).toBeNull()
    expect(resolveNoriModelRoute('nori::nori-audio')).toBeNull()
  })

  it('rejects routes that cross the fixed provider boundaries', () => {
    configure({
      'nori::nori-gpt': 'openlux::gpt-image-2.5-sunburst',
      'nori::nori-image': 'kuaizi::seedream5.0lite',
      'nori::nori-image-pro': 'deepseek::deepseek-chat',
      'nori::seedance2.0': 'openlux::gpt-image-2.5-sunburst',
      'nori::nori-audio': 'deepseek::deepseek-chat',
    })

    expect(resolveNoriModelRoute('nori::nori-gpt')).toBeNull()
    expect(resolveNoriModelRoute('nori::nori-image')).toBeNull()
    expect(resolveNoriModelRoute('nori::nori-image-pro')).toBeNull()
    expect(resolveNoriModelRoute('nori::seedance2.0')).toBeNull()
    expect(resolveNoriModelRoute('nori::nori-audio')).toBeNull()
  })
})
