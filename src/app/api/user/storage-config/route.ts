import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { deleteObject, getObjectBuffer, getSignedObjectUrl, resetStorageProvider, uploadObject } from '@/lib/storage'

const ENV_FILE = path.join(process.cwd(), '.env.local')
const DEFAULT_TOS_ENDPOINT = 'https://tos-cn-beijing.volces.com'
const DEFAULT_TOS_REGION = 'cn-beijing'
const DEFAULT_TOS_BUCKET = 'chaofen'
const STORAGE_CONFIG_KEYS = [
  'STORAGE_TYPE',
  'TOS_ENDPOINT',
  'TOS_PUBLIC_ENDPOINT',
  'TOS_BUCKET',
  'TOS_ACCESS_KEY',
  'TOS_SECRET_KEY',
  'TOS_REGION',
] as const

type StorageConfigKey = typeof STORAGE_CONFIG_KEYS[number]

interface EnvState {
  text: string
  values: Record<string, string>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readEnvState(): Promise<EnvState> {
  let text = ''
  try {
    text = await fs.readFile(ENV_FILE, 'utf8')
  } catch (error) {
    if ((error as { code?: string })?.code !== 'ENOENT') throw error
  }

  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index)
    const value = trimmed.slice(index + 1).replace(/^[']|[']$/g, '').replace(/^["]|["]$/g, '')
    values[key] = value
  }

  return { text, values }
}

function serializeEnvValue(value: string): string {
  if (/\s|#|"|'/.test(value)) return JSON.stringify(value)
  return value
}

function upsertEnvText(text: string, updates: Partial<Record<StorageConfigKey, string>>): string {
  const handled = new Set<string>()
  const lines = text.split(/\r?\n/)
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (!match) return line
    const key = match[1] as StorageConfigKey
    if (!STORAGE_CONFIG_KEYS.includes(key) || updates[key] === undefined) return line
    handled.add(key)
    return `${key}=${serializeEnvValue(updates[key] || '')}`
  })

  const missingEntries = STORAGE_CONFIG_KEYS
    .filter((key) => updates[key] !== undefined && !handled.has(key))
    .map((key) => `${key}=${serializeEnvValue(updates[key] || '')}`)

  if (missingEntries.length === 0) return nextLines.join('\n')
  const existingLines = nextLines.filter((line, index) => index < nextLines.length - 1 || line.length > 0)
  const separator = existingLines.some((line) => line.trim().length > 0)
    ? ['', '# 火山引擎 TOS 存储配置']
    : ['# 火山引擎 TOS 存储配置']
  return [...existingLines, ...separator, ...missingEntries, ''].join('\n')
}

function toResponseConfig(values: Record<string, string>) {
  return {
    storageType: values.STORAGE_TYPE || process.env.STORAGE_TYPE || 'tos',
    endpoint: values.TOS_ENDPOINT || process.env.TOS_ENDPOINT || DEFAULT_TOS_ENDPOINT,
    publicEndpoint: values.TOS_PUBLIC_ENDPOINT || process.env.TOS_PUBLIC_ENDPOINT || values.TOS_ENDPOINT || process.env.TOS_ENDPOINT || DEFAULT_TOS_ENDPOINT,
    bucket: values.TOS_BUCKET || process.env.TOS_BUCKET || DEFAULT_TOS_BUCKET,
    region: values.TOS_REGION || process.env.TOS_REGION || DEFAULT_TOS_REGION,
    hasAccessKey: Boolean(values.TOS_ACCESS_KEY || process.env.TOS_ACCESS_KEY),
    hasSecretKey: Boolean(values.TOS_SECRET_KEY || process.env.TOS_SECRET_KEY),
  }
}

function applyToProcessEnv(updates: Partial<Record<StorageConfigKey, string>>) {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) process.env[key] = value
  }
  resetStorageProvider()
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const state = await readEnvState()
  return NextResponse.json({ success: true, config: toResponseConfig(state.values) })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) throw new ApiError('INVALID_PARAMS', { message: '配置格式无效' })

  const state = await readEnvState()
  const endpoint = readString(body.endpoint) || DEFAULT_TOS_ENDPOINT
  const publicEndpoint = readString(body.publicEndpoint) || endpoint
  const bucket = readString(body.bucket) || DEFAULT_TOS_BUCKET
  const region = readString(body.region) || DEFAULT_TOS_REGION
  const accessKey = readString(body.accessKey)
  const secretKey = readString(body.secretKey)

  const updates: Partial<Record<StorageConfigKey, string>> = {
    STORAGE_TYPE: 'tos',
    TOS_ENDPOINT: endpoint,
    TOS_PUBLIC_ENDPOINT: publicEndpoint,
    TOS_BUCKET: bucket,
    TOS_REGION: region,
  }
  if (accessKey) updates.TOS_ACCESS_KEY = accessKey
  if (secretKey) updates.TOS_SECRET_KEY = secretKey

  if (!updates.TOS_ACCESS_KEY && !state.values.TOS_ACCESS_KEY && !process.env.TOS_ACCESS_KEY) {
    throw new ApiError('INVALID_PARAMS', { message: '请填写 TOS AccessKeyId' })
  }
  if (!updates.TOS_SECRET_KEY && !state.values.TOS_SECRET_KEY && !process.env.TOS_SECRET_KEY) {
    throw new ApiError('INVALID_PARAMS', { message: '请填写 TOS SecretAccessKey' })
  }

  const nextText = upsertEnvText(state.text, updates)
  await fs.writeFile(ENV_FILE, nextText, 'utf8')
  applyToProcessEnv(updates)
  const nextState = await readEnvState()
  return NextResponse.json({ success: true, config: toResponseConfig(nextState.values) })
})

export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  resetStorageProvider()

  const key = `settings-probe/${randomUUID()}.txt`
  const content = `tos probe ${new Date().toISOString()}`
  let uploaded = false
  try {
    await uploadObject(Buffer.from(content), key, 1, 'text/plain')
    uploaded = true
    const signedUrl = await getSignedObjectUrl(key, 300)
    const [buffer, response] = await Promise.all([
      getObjectBuffer(key),
      fetch(signedUrl),
    ])
    const text = response.ok ? await response.text() : ''
    if (!response.ok || buffer.toString() !== content || text !== content) {
      throw new Error(`TOS 测试失败：HTTP ${response.status}`)
    }
    return NextResponse.json({ success: true, httpStatus: response.status })
  } catch (error) {
    throw new ApiError('EXTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'TOS 测试失败',
    })
  } finally {
    if (uploaded) {
      await deleteObject(key).catch(() => undefined)
    }
  }
})
