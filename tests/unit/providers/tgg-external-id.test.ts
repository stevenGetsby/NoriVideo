import { describe, expect, it } from 'vitest'
import { parseExternalId, resolveExecutedModelKeyFromExternalId } from '@/lib/async-poll'
import {
  decodeTggExternalToken,
  encodeTggExternalToken,
  formatTggExternalId,
} from '@/lib/providers/tgg/external-id'

describe('tgg durable external id', () => {
  it('round-trips scoped provider and model identifiers through the async poll parser', () => {
    const externalId = formatTggExternalId({
      providerId: 'tgg:production',
      modelId: 'tgg-fixture-video',
      taskId: 'task:with:segments',
    })
    const parsed = parseExternalId(externalId)

    expect(parsed).toMatchObject({
      provider: 'TGG',
      type: 'VIDEO',
      requestId: 'task:with:segments',
    })
    expect(decodeTggExternalToken(parsed.providerToken)).toBe('tgg:production')
    expect(decodeTggExternalToken(parsed.modelKeyToken)).toBe('tgg-fixture-video')
    expect(externalId.startsWith('TGG:VIDEO:')).toBe(true)
  })

  it('round-trips unicode tokens', () => {
    const token = encodeTggExternalToken('服务商::视频模型')
    expect(decodeTggExternalToken(token)).toBe('服务商::视频模型')
  })

  it('rejects malformed or empty tokens', () => {
    expect(() => decodeTggExternalToken('not+base64')).toThrow('TGG_EXTERNAL_ID_TOKEN_INVALID')
    expect(() => decodeTggExternalToken('   ')).toThrow('TGG_EXTERNAL_ID_TOKEN_MISSING')
    expect(() => encodeTggExternalToken('')).toThrow('TGG_EXTERNAL_ID_TOKEN_MISSING')
    expect(() => formatTggExternalId({ providerId: 'tgg', modelId: 'm', taskId: ' ' })).toThrow('TGG_EXTERNAL_ID_TASK_ID_MISSING')
  })

  it('only resumes TGG video tasks', () => {
    const providerToken = encodeTggExternalToken('tgg')
    const modelToken = encodeTggExternalToken('tgg-fixture-video')
    expect(() => parseExternalId(`TGG:IMAGE:${providerToken}:${modelToken}:task-1`)).toThrow('ASYNC_TASK_PROVIDER_RETIRED')
    expect(() => parseExternalId(`TGG:VIDEO::${modelToken}:task-1`)).toThrow('ASYNC_TASK_PROVIDER_RETIRED')
    expect(() => parseExternalId(`TGG:VIDEO:${providerToken}:${modelToken}:`)).toThrow('ASYNC_TASK_PROVIDER_RETIRED')
  })

  it('resolves the executed model key pinned inside the external id', () => {
    const externalId = formatTggExternalId({ providerId: 'tgg', modelId: 'tgg-fixture-video', taskId: 'task-1' })
    expect(resolveExecutedModelKeyFromExternalId(externalId)).toBe('tgg::tgg-fixture-video')
    expect(resolveExecutedModelKeyFromExternalId(null)).toBeNull()
    expect(resolveExecutedModelKeyFromExternalId(undefined)).toBeNull()
    expect(resolveExecutedModelKeyFromExternalId('')).toBeNull()
    expect(resolveExecutedModelKeyFromExternalId('RETIRED:VIDEO:abc:def:task')).toBeNull()
  })
})
