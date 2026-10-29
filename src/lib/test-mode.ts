import { prisma } from '@/lib/prisma'
import type { AuthSession } from '@/lib/api-auth'
import { NORI_DEFAULT_MODEL_KEYS } from '@/lib/nori-model-catalog'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_USER_NAME = 'nori-test'

let testModeSessionPromise: Promise<AuthSession> | null = null

function readEnv(name: string): string {
  return (process.env[name] || '').trim()
}

export function isTestModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return readEnv('NORI_TEST_MODE') === 'true' || readEnv('NEXT_PUBLIC_NORI_TEST_MODE') === 'true'
}

export function getTestModeUserId(): string {
  return TEST_USER_ID
}

export function getTestModeModelKeys() {
  return {
    analysisModel: NORI_DEFAULT_MODEL_KEYS.llm,
    imageModel: NORI_DEFAULT_MODEL_KEYS.image,
    videoModel: NORI_DEFAULT_MODEL_KEYS.video,
    audioModel: NORI_DEFAULT_MODEL_KEYS.audio,
  }
}

async function seedTestModeUser(): Promise<AuthSession> {
  const modelKeys = getTestModeModelKeys()
  const user = await prisma.user.upsert({
    where: { name: TEST_USER_NAME },
    create: {
      id: TEST_USER_ID,
      name: TEST_USER_NAME,
      role: 'super_admin',
      status: 'active',
      parentAccountId: null,
    },
    update: {
      role: 'super_admin',
      status: 'active',
      parentAccountId: null,
    },
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

  const preferences = {
    analysisModel: modelKeys.analysisModel,
    characterModel: modelKeys.imageModel,
    locationModel: modelKeys.imageModel,
    storyboardModel: modelKeys.imageModel,
    editModel: modelKeys.imageModel,
    videoModel: modelKeys.videoModel,
    audioModel: modelKeys.audioModel,
    videoRatio: '9:16',
    artStyle: 'realistic',
    imageResolution: '1024x1024',
    customProviders: '[]',
    customModels: '[]',
  }
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...preferences },
    update: preferences,
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
