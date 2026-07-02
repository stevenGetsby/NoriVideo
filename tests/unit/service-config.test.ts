import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readServiceConfig,
  resetServiceConfigCache,
  resolveServiceConfigPath,
} from '@/lib/service-config'
import { extractModelKey } from '@/lib/config-service'
import { normalizeProviderModelId } from '@/lib/model-provider-contract'

function writeTempConfig(fileName: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-service-config-'))
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

describe('service config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('loads JSON service config from NORI_SERVICE_CONFIG', () => {
    const filePath = writeTempConfig('services.json', JSON.stringify({
      storage: {
        type: 'tos',
        tos: {
          bucket: 'bucket-json',
        },
      },
      llm: {
        providers: [
          {
            id: 'openai-compatible:deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'sk-json',
            gatewayRoute: 'openai-compat',
          },
        ],
      },
    }))
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)

    expect(resolveServiceConfigPath()).toBe(filePath)
    expect(readServiceConfig().storage?.tos?.bucket).toBe('bucket-json')
    expect(readServiceConfig().llm?.providers?.[0]?.apiKey).toBe('sk-json')
  })

  it('loads YAML service config with arrays and nested objects', () => {
    const filePath = writeTempConfig('services.yaml', [
      'storage:',
      '  type: tos',
      '  tos:',
      '    bucket: bucket-yaml',
      '    forcePathStyle: false',
      'llm:',
      '  providers:',
      '    - id: openai-compatible:deepseek',
      '      name: DeepSeek',
      '      baseUrl: https://api.deepseek.com/v1',
      '      apiKey: sk-yaml',
      '      gatewayRoute: openai-compat',
      '  models:',
      '    - modelId: deepseek-chat',
      '      type: llm',
      '      provider: openai-compatible:deepseek',
      '      llmProtocol: chat-completions',
    ].join('\n'))
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)

    const config = readServiceConfig()

    expect(config.storage?.tos?.bucket).toBe('bucket-yaml')
    expect(config.storage?.tos?.forcePathStyle).toBe(false)
    expect(config.llm?.providers?.[0]?.id).toBe('openai-compatible:deepseek')
    expect(config.llm?.models?.[0]?.modelId).toBe('deepseek-chat')
  })

  it('normalizes legacy GHC model keys to provider model keys', () => {
    expect(extractModelKey('dev_ghc_api::gpt-5.5')).toBe('ghc::gpt-5.5')
    expect(extractModelKey('dev_text_llm::gpt-5.5')).toBe('ghc::gpt-5.5')
    expect(normalizeProviderModelId('hfsy', 'gpt5.5')).toBe('gpt-5.5')
    expect(normalizeProviderModelId('ghc', 'gpt5.5')).toBe('gpt-5.5')
  })
})
