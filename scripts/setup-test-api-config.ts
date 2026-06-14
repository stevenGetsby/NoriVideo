/**
 * 测试 API 配置脚本
 *
 * 使用方式:
 *   NORI_TEST_LUMINA_API_KEY=... NORI_TEST_IMAGE_API_KEY=... npx tsx scripts/setup-test-api-config.ts
 *
 * 配置架构:
 *   Provider: Lumina
 *     └── 文本模型: gpt-5.5
 *   Provider: HFSY API
 *     └── 图片模型: gpt-image-2 / gpt-image-2pro
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

// ─── Keys ───────────────────────────────────────────
const LLM_API_KEY = readEnvRequired('NORI_TEST_LUMINA_API_KEY', 'LUMINA_API_KEY')
const LLM_BASE_URL = readEnv('NORI_TEST_LUMINA_BASE_URL') || 'https://lumina.tripo3d.com/'

const IMAGE_API_KEY = readEnvRequired('NORI_TEST_IMAGE_API_KEY', 'HFSY_API_KEY')
const IMAGE_BASE_URL = readEnv('NORI_TEST_IMAGE_BASE_URL') || 'https://www.hfsyapi.cn/v1'

// ─── 加密（与 src/lib/crypto-utils.ts 完全一致）───
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const KEY_LENGTH = 32
const SALT = 'nori-api-key-salt-v1'

function deriveEncryptionKey(): Buffer {
  const secret = process.env.API_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'nori-private-fixed-key-2026'
  return crypto.pbkdf2Sync(secret, SALT, 100000, KEY_LENGTH, 'sha256')
}

function encryptApiKey(plaintext: string): string {
  const key = deriveEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

function readEnv(name: string): string {
  return (process.env[name] || '').trim()
}

function readEnvRequired(...names: string[]): string {
  for (const name of names) {
    const value = readEnv(name)
    if (value) return value
  }
  throw new Error(`Missing required env: ${names.join(' or ')}`)
}

// ─── 配置定义 ───────────────────────────────────────
const PROVIDERS = [
  {
    id: 'lumina',
    name: 'Lumina',
    baseUrl: LLM_BASE_URL,
    apiKey: encryptApiKey(LLM_API_KEY),
  },
  {
    id: 'hfsy',
    name: 'HFSY API',
    baseUrl: IMAGE_BASE_URL,
    apiKey: encryptApiKey(IMAGE_API_KEY),
    gatewayRoute: 'openai-compat',
  },
]

const MODELS = [
  // ─── LLM 模型 ───
  {
    modelId: 'gpt-5.5',
    name: 'Lumina GPT-5.5',
    type: 'llm',
    provider: 'lumina',
    price: 0,
  },
  // ─── Image 模型（不配 compatMediaTemplate，使用默认 images/generations 端点）───
  {
    modelId: 'gpt-image-2',
    name: 'GPT Image 2 (1K)',
    type: 'image',
    provider: 'hfsy',
    price: 0,
  },
  {
    modelId: 'gpt-image-2pro',
    name: 'GPT Image 2 Pro (2K)',
    type: 'image',
    provider: 'hfsy',
    price: 0,
  },
]

// 默认模型选择
const DEFAULT_ANALYSIS_MODEL = 'lumina::gpt-5.5'
const DEFAULT_CHARACTER_MODEL = 'hfsy::gpt-image-2pro'
const DEFAULT_LOCATION_MODEL = 'hfsy::gpt-image-2pro'
const DEFAULT_STORYBOARD_MODEL = 'hfsy::gpt-image-2pro'
const DEFAULT_EDIT_MODEL = 'hfsy::gpt-image-2pro'

// ─── 执行 ───────────────────────────────────────────
async function main() {
  const user = await prisma.user.findFirst()
  if (!user) {
    console.error('❌ 没有找到用户，请先注册。')
    process.exit(1)
  }
  console.log(`用户: ${user.name} (${user.id})`)
  console.log('')

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      analysisModel: DEFAULT_ANALYSIS_MODEL,
      characterModel: DEFAULT_CHARACTER_MODEL,
      locationModel: DEFAULT_LOCATION_MODEL,
      storyboardModel: DEFAULT_STORYBOARD_MODEL,
      editModel: DEFAULT_EDIT_MODEL,
      customProviders: JSON.stringify(PROVIDERS),
      customModels: JSON.stringify(MODELS),
    },
    update: {
      analysisModel: DEFAULT_ANALYSIS_MODEL,
      characterModel: DEFAULT_CHARACTER_MODEL,
      locationModel: DEFAULT_LOCATION_MODEL,
      storyboardModel: DEFAULT_STORYBOARD_MODEL,
      editModel: DEFAULT_EDIT_MODEL,
      customProviders: JSON.stringify(PROVIDERS),
      customModels: JSON.stringify(MODELS),
    },
  })

  console.log('✅ 配置写入完成')
  console.log('')
  console.log('┌─────────────────────────────────────────────────────┐')
  console.log('│  Lumina + HFSY 配置总览                             │')
  console.log('├─────────────────────────────────────────────────────┤')
  console.log('│  Provider                                           │')
  console.log('│    Lumina: lumina.tripo3d.com                       │')
  console.log('│    HFSY: www.hfsyapi.cn/v1                          │')
  console.log('├─────────────────────────────────────────────────────┤')
  console.log('│  文本模型 (LLM)                                     │')
  console.log('│    ✓ lumina::gpt-5.5  ← 默认分析模型                │')
  console.log('├─────────────────────────────────────────────────────┤')
  console.log('│  图片模型 (Image)                                   │')
  console.log('│    ✓ gpt-image-2      (1K)                          │')
  console.log('│    ✓ gpt-image-2pro   (2K) ← 默认生图模型          │')
  console.log('├─────────────────────────────────────────────────────┤')
  console.log('│  默认选择                                           │')
  console.log('│    分析模型: lumina::gpt-5.5                        │')
  console.log('│    角色图片: gpt-image-2pro                         │')
  console.log('│    场景图片: gpt-image-2pro                         │')
  console.log('│    分镜图片: gpt-image-2pro                         │')
  console.log('│    修图模型: gpt-image-2pro                         │')
  console.log('└─────────────────────────────────────────────────────┘')
  console.log('')
  console.log('刷新首页即可使用。手动创作和智能制作共用此配置。')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
