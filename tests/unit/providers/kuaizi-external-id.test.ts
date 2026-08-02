import { describe, expect, it } from 'vitest'
import { parseExternalId } from '@/lib/async-poll'
import {
  decodeKuaiziExternalToken,
  formatKuaiziExternalId,
} from '@/lib/providers/kuaizi/external-id'

describe('kuaizi durable external id', () => {
  it('round-trips scoped provider and model identifiers', () => {
    const externalId = formatKuaiziExternalId({
      type: 'VIDEO',
      providerId: 'kuaizi:production',
      modelId: 'doubao-seedance-2-0-fast-260128',
      taskId: 'task:with:segments',
    })
    const parsed = parseExternalId(externalId)

    expect(parsed).toMatchObject({
      provider: 'KUAIZI',
      type: 'VIDEO',
      requestId: 'task:with:segments',
    })
    expect(decodeKuaiziExternalToken(parsed.providerToken!)).toBe('kuaizi:production')
    expect(decodeKuaiziExternalToken(parsed.modelKeyToken!)).toBe('doubao-seedance-2-0-fast-260128')
  })

  it('rejects malformed encoded tokens', () => {
    expect(() => decodeKuaiziExternalToken('not+base64')).toThrow('KUAIZI_EXTERNAL_ID_TOKEN_INVALID')
  })
})
