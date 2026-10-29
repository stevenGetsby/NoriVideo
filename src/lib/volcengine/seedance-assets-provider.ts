import { createHash } from 'node:crypto'
import { getProviderConfig, getProviderKey, resolveModelSelection } from '@/lib/api-config'
import { getProjectModelConfig } from '@/lib/config-service'
import { KuaiziAssetsClient } from '@/lib/providers/kuaizi/assets'
import { buildKuaiziUrl } from '@/lib/providers/kuaizi/client'

/** Stored in the existing project/character ownership field, never sent as ProjectName to Kuaizi. */
export async function getSeedanceAssetsProvider(input: { userId: string; projectId: string; modelKey?: string }) {
  const modelKey = input.modelKey || (await getProjectModelConfig(input.projectId, input.userId)).videoModel
  if (!modelKey) throw new Error('SEEDANCE_ASSETS_VIDEO_MODEL_REQUIRED')
  const selection = await resolveModelSelection(input.userId, modelKey, 'video')
  const provider = getProviderKey(selection.provider).toLowerCase()
  if (provider !== 'kuaizi' || !/doubao-seedance/i.test(selection.modelId)) {
    throw new Error('SEEDANCE_ASSETS_PROVIDER_UNSUPPORTED')
  }
  const config = await getProviderConfig(input.userId, selection.provider)
  const endpoint = buildKuaiziUrl(config.baseUrl, '/ai-open-platform-api/api/support/v1/asset')
  const digest = createHash('sha256').update(JSON.stringify([selection.provider, endpoint, config.apiKey])).digest('hex')
  return {
    client: new KuaiziAssetsClient(config),
    projectName: '',
    scope: `kuaizi:${digest}`,
  }
}
