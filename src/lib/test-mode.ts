import { prisma } from '@/lib/prisma'
import { encryptApiKey } from '@/lib/crypto-utils'
import { composeModelKey } from '@/lib/model-config-contract'
import {
  HFSY_IMAGE_MODEL_ID,
  HFSY_IMAGE_MODEL_KEY,
  HFSY_PROVIDER_ID,
  HFSY_VIDEO_MODEL_ID,
  HFSY_VIDEO_MODEL_KEY,
} from '@/lib/hfsy-fixed-models'
import {
  LUMINA_GPT55_MODEL_ID,
  LUMINA_GPT55_MODEL_KEY,
  LUMINA_PROVIDER_ID,
} from '@/lib/lumina-fixed-models'
import type { AuthSession } from '@/lib/api-auth'
import type { OpenAICompatMediaTemplate } from '@/lib/openai-compat-media-template'

type TestProviderConfig = {
  id: string
  name: string
  baseUrl?: string
  apiKey: string
  gatewayRoute?: 'openai-compat'
}

type TestModelConfig = {
  modelId: string
  modelKey: string
  name: string
  type: string
  provider: string
  llmProtocol?: 'chat-completions'
  compatMediaTemplate?: OpenAICompatMediaTemplate
  compatMediaTemplateCheckedAt?: string
  compatMediaTemplateSource?: 'manual'
}

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_USER_NAME = 'nori-test'
const IMAGE_PROVIDER_ID = HFSY_PROVIDER_ID
const ARK_PROVIDER_ID = 'ark'
const LUMINA_BASE_URL = 'https://lumina.tripo3d.com/'
const IMAGE_BASE_URL = 'https://www.hfsyapi.cn/v1'
const IMAGE_MODEL_ID = HFSY_IMAGE_MODEL_ID
const VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128'

let testModeSessionPromise: Promise<AuthSession> | null = null

function readEnv(name: string): string {
  return (process.env[name] || '').trim()
}

export function isTestModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return readEnv('NORI_TEST_MODE') === 'true' || readEnv('NEXT_PUBLIC_NORI_TEST_MODE') === 'true'
}

function requireTestKey(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`TEST_MODE_KEY_MISSING: ${name}`)
  }
  return value
}

export function getTestModeUserId(): string {
  return TEST_USER_ID
}

export function getTestModeModelKeys() {
  return {
    analysisModel: LUMINA_GPT55_MODEL_KEY,
    imageModel: HFSY_IMAGE_MODEL_KEY,
    videoModel: HFSY_VIDEO_MODEL_KEY,
  }
}

function buildGptImage2Template(): OpenAICompatMediaTemplate {
  return {
    version: 1,
    mediaType: 'image',
    mode: 'sync',
    create: {
      method: 'POST',
      path: '/images/generations',
      contentType: 'application/json',
      bodyTemplate: {
        model: '{{model}}',
        prompt: '{{prompt}}',
        size: '{{size}}',
        reference_images: '{{images}}',
        n: 1,
        response_format: 'b64_json',
      },
    },
    response: {
      outputB64JsonPath: '$.data[0].b64_json',
      outputUrlPath: '$.data[0].url',
      outputUrlsPath: '$.data',
      errorPath: '$.error.message',
    },
  }
}

function buildTestProviders(luminaApiKey: string, imageApiKey: string, arkApiKey?: string) {
  const providers: TestProviderConfig[] = [
    {
      id: LUMINA_PROVIDER_ID,
      name: 'Lumina Test',
      baseUrl: LUMINA_BASE_URL,
      apiKey: encryptApiKey(luminaApiKey),
    },
    {
      id: IMAGE_PROVIDER_ID,
      name: 'HFSY gpt-image-2 Test',
      baseUrl: IMAGE_BASE_URL,
      apiKey: encryptApiKey(imageApiKey),
      gatewayRoute: 'openai-compat',
    },
  ]

  if (arkApiKey) {
    providers.push({
      id: ARK_PROVIDER_ID,
      name: 'Volcengine Ark',
      apiKey: encryptApiKey(arkApiKey),
    })
  }

  return providers
}

function buildTestModels(includeArkVideoModels = false) {
  const now = new Date().toISOString()
  const imageTemplate = buildGptImage2Template()

  const models: TestModelConfig[] = [
    {
      modelId: LUMINA_GPT55_MODEL_ID,
      modelKey: LUMINA_GPT55_MODEL_KEY,
      name: 'Lumina GPT-5.5',
      type: 'llm',
      provider: LUMINA_PROVIDER_ID,
    },
    {
      modelId: IMAGE_MODEL_ID,
      modelKey: HFSY_IMAGE_MODEL_KEY,
      name: 'GPT Image 2',
      type: 'image',
      provider: IMAGE_PROVIDER_ID,
      compatMediaTemplate: imageTemplate,
      compatMediaTemplateCheckedAt: now,
      compatMediaTemplateSource: 'manual',
    },
    {
      modelId: HFSY_VIDEO_MODEL_ID,
      modelKey: HFSY_VIDEO_MODEL_KEY,
      name: 'HFSY SD-2 VIP',
      type: 'video',
      provider: IMAGE_PROVIDER_ID,
    },
  ]

  if (includeArkVideoModels) {
    const arkVideoModels = [
      { modelId: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast' },
      { modelId: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite' },
      { modelId: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' },
      { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' },
      { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0' },
      { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast' },
    ].map((model) => ({
      ...model,
      modelKey: composeModelKey(ARK_PROVIDER_ID, model.modelId),
      type: 'video',
      provider: ARK_PROVIDER_ID,
    }))

    models.push(...arkVideoModels)
  }

  return models
}

async function seedTestModeUser(): Promise<AuthSession> {
  const luminaApiKey = requireTestKey('NORI_TEST_LUMINA_API_KEY')
  const imageApiKey = requireTestKey('NORI_TEST_IMAGE_API_KEY')
  const arkApiKey = readEnv('NORI_TEST_ARK_API_KEY')
  const modelKeys = getTestModeModelKeys()
  const providers = buildTestProviders(luminaApiKey, imageApiKey, arkApiKey)
  const models = buildTestModels(!!arkApiKey)

  const user = await prisma.user.upsert({
    where: { name: TEST_USER_NAME },
    create: {
      id: TEST_USER_ID,
      name: TEST_USER_NAME,
    },
    update: {},
    select: {
      id: true,
      name: true,
      email: true,
    },
  })

  await prisma.userBalance.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      balance: 0,
      frozenAmount: 0,
      totalSpent: 0,
    },
    update: {},
  })

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      analysisModel: modelKeys.analysisModel,
      characterModel: modelKeys.imageModel,
      locationModel: modelKeys.imageModel,
      storyboardModel: modelKeys.imageModel,
      editModel: modelKeys.imageModel,
      videoModel: modelKeys.videoModel,
      videoRatio: '9:16',
      artStyle: 'realistic',
      imageResolution: '1024x1024',
      customProviders: JSON.stringify(providers),
      customModels: JSON.stringify(models),
    },
    update: {
      analysisModel: modelKeys.analysisModel,
      characterModel: modelKeys.imageModel,
      locationModel: modelKeys.imageModel,
      storyboardModel: modelKeys.imageModel,
      editModel: modelKeys.imageModel,
      videoModel: modelKeys.videoModel,
      customProviders: JSON.stringify(providers),
      customModels: JSON.stringify(models),
    },
  })

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  }
}

export async function getOrCreateTestModeSession(): Promise<AuthSession> {
  if (!testModeSessionPromise) {
    testModeSessionPromise = seedTestModeUser()
  }
  return await testModeSessionPromise
}
