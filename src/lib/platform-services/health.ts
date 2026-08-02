import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deleteObject, getObjectBuffer, getSignedObjectUrl, resetStorageProvider, uploadObject } from '@/lib/storage'
import { getRawProviderKey } from '@/lib/model-provider-contract'
import { isUsableServiceSecret, readMaterializedPlatformServiceConfig } from './config'
import { recordServiceUsage } from './usage'

type ServiceHealthRow = {
  targetType: string
  targetId: string
  status: string
  latencyMs: number | null
  message: string | null
  checkedAt: Date
}

type ServiceHealthModel = {
  create(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<ServiceHealthRow[]>
}

const serviceHealthModel = (prisma as unknown as { serviceHealthCheck: ServiceHealthModel }).serviceHealthCheck

export type ServiceHealthTargetType = 'provider' | 'storage'

function compact(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function providerModelsUrl(providerId: string, baseUrl?: string): string {
  if (getRawProviderKey(providerId).toLowerCase() === 'ark') {
    return 'https://ark.cn-beijing.volces.com/api/v3/models'
  }
  const normalized = compact(baseUrl).replace(/\/+$/, '')
  if (!normalized) throw new Error(`服务 ${providerId} 未配置 Base URL`)
  return `${normalized}/models`
}

function kuaiziBalanceUrl(baseUrl?: string): string {
  const normalized = (compact(baseUrl) || 'https://aiopenapi.kuaizi.cn').replace(/\/+$/, '')
  const prefix = '/ai-open-platform-api'
  return normalized.endsWith(prefix)
    ? `${normalized}/v1/user/balance`
    : `${normalized}${prefix}/v1/user/balance`
}

async function persistHealth(input: {
  targetType: ServiceHealthTargetType
  targetId: string
  status: 'healthy' | 'unhealthy'
  latencyMs: number
  message: string
  checkedBy: string
  details?: Record<string, unknown>
}) {
  await serviceHealthModel.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      status: input.status,
      latencyMs: input.latencyMs,
      message: compact(input.message),
      checkedBy: input.checkedBy,
      details: input.details
        ? JSON.parse(JSON.stringify(input.details)) as Prisma.InputJsonValue
        : undefined,
    },
  })
}

export async function probeProviderHealth(providerId: string, checkedBy: string) {
  const config = readMaterializedPlatformServiceConfig()
  const provider = (config.llm?.providers || []).find((item) => item.id === providerId)
  if (!provider) throw new Error('服务不存在')
  const startedAt = Date.now()
  if (!isUsableServiceSecret(provider.apiKey)) {
    const message = 'API Key 未配置或仍是占位值，请填写真实密钥后重试'
    await persistHealth({
      targetType: 'provider',
      targetId: provider.id,
      status: 'unhealthy',
      latencyMs: 0,
      message,
      checkedBy,
    })
    await recordServiceUsage({
      provider: provider.id,
      serviceType: 'llm',
      operation: 'health-check',
      status: 'failed',
      userId: checkedBy,
      latencyMs: 0,
      units: 0,
      errorCode: 'API_KEY_MISSING',
    })
    return { targetType: 'provider' as const, targetId: provider.id, status: 'unhealthy' as const, latencyMs: 0, message, checkedAt: new Date().toISOString() }
  }
  try {
    const providerKey = getRawProviderKey(provider.id).toLowerCase()
    const isKuaizi = providerKey === 'kuaizi'
    const response = await fetch(
      isKuaizi ? kuaiziBalanceUrl(provider.baseUrl) : providerModelsUrl(provider.id, provider.baseUrl),
      isKuaizi
        ? {
          method: 'POST',
          headers: { ApiKey: provider.apiKey!, 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(15_000),
        }
        : {
          headers: { Authorization: `Bearer ${provider.apiKey}` },
          signal: AbortSignal.timeout(15_000),
        },
    )
    const latencyMs = Date.now() - startedAt
    const bodyText = await response.text().catch(() => '')
    let modelCount: number | null = null
    let kuaiziBalance: number | null = null
    let kuaiziBusinessOk = true
    if (response.ok && bodyText) {
      try {
        const payload = JSON.parse(bodyText) as { code?: unknown; data?: unknown; models?: unknown }
        if (isKuaizi) {
          kuaiziBusinessOk = Number(payload.code) === 0
          const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? payload.data as { wallet_balance?: unknown }
            : null
          kuaiziBalance = finiteNumber(data?.wallet_balance)
        } else {
          const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : null
          modelCount = list?.length ?? null
        }
      } catch {
        modelCount = null
        if (isKuaizi) kuaiziBusinessOk = false
      }
    }
    const healthy = response.ok && (!isKuaizi || kuaiziBusinessOk)
    const status = healthy ? 'healthy' : 'unhealthy'
    const message = healthy
      ? (isKuaizi
        ? (kuaiziBalance == null ? '连接正常，余额接口可用' : `连接正常，账户余额 ${(kuaiziBalance / 100).toFixed(2)} 点`)
        : modelCount == null ? '连接正常' : `连接正常，发现 ${modelCount} 个模型`)
      : `HTTP ${response.status}`
    await persistHealth({
      targetType: 'provider',
      targetId: provider.id,
      status,
      latencyMs,
      message,
      checkedBy,
      details: { httpStatus: response.status, modelCount, ...(isKuaizi ? { balanceAvailable: kuaiziBalance != null } : {}) },
    })
    await recordServiceUsage({
      provider: provider.id,
      serviceType: 'llm',
      operation: 'health-check',
      status: healthy ? 'success' : 'failed',
      userId: checkedBy,
      latencyMs,
      units: 0,
      errorCode: healthy ? null : `HTTP_${response.status}`,
    })
    return { targetType: 'provider' as const, targetId: provider.id, status, latencyMs, message, checkedAt: new Date().toISOString() }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = compact(error instanceof Error ? error.message : String(error)) || '连接失败'
    await persistHealth({ targetType: 'provider', targetId: provider.id, status: 'unhealthy', latencyMs, message, checkedBy })
    await recordServiceUsage({
      provider: provider.id,
      serviceType: 'llm',
      operation: 'health-check',
      status: 'failed',
      userId: checkedBy,
      latencyMs,
      units: 0,
      errorCode: 'NETWORK_ERROR',
    })
    return { targetType: 'provider' as const, targetId: provider.id, status: 'unhealthy' as const, latencyMs, message, checkedAt: new Date().toISOString() }
  }
}

export async function probeStorageHealth(checkedBy: string) {
  const startedAt = Date.now()
  const key = `settings-probe/${randomUUID()}.txt`
  const content = `nori storage probe ${new Date().toISOString()}`
  let uploaded = false
  try {
    resetStorageProvider()
    await uploadObject(Buffer.from(content), key, 1, 'text/plain')
    uploaded = true
    const signedUrl = await getSignedObjectUrl(key, 300)
    const [buffer, response] = await Promise.all([getObjectBuffer(key), fetch(signedUrl)])
    const publicText = response.ok ? await response.text() : ''
    if (!response.ok || buffer.toString() !== content || publicText !== content) {
      throw new Error(`TOS 读写校验失败（HTTP ${response.status}）`)
    }
    const latencyMs = Date.now() - startedAt
    const message = '上传、读取、签名地址和删除链路正常'
    await persistHealth({ targetType: 'storage', targetId: 'tos', status: 'healthy', latencyMs, message, checkedBy })
    await recordServiceUsage({
      provider: 'tos',
      serviceType: 'storage',
      operation: 'health-check',
      status: 'success',
      userId: checkedBy,
      latencyMs,
      units: 0,
    })
    return { targetType: 'storage' as const, targetId: 'tos', status: 'healthy' as const, latencyMs, message, checkedAt: new Date().toISOString() }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = compact(error instanceof Error ? error.message : String(error)) || 'TOS 检测失败'
    await persistHealth({ targetType: 'storage', targetId: 'tos', status: 'unhealthy', latencyMs, message, checkedBy })
    await recordServiceUsage({
      provider: 'tos',
      serviceType: 'storage',
      operation: 'health-check',
      status: 'failed',
      userId: checkedBy,
      latencyMs,
      units: 0,
      errorCode: 'STORAGE_PROBE_FAILED',
    })
    return { targetType: 'storage' as const, targetId: 'tos', status: 'unhealthy' as const, latencyMs, message, checkedAt: new Date().toISOString() }
  } finally {
    if (uploaded) await deleteObject(key).catch(() => undefined)
  }
}

export async function getLatestServiceHealth() {
  const checks = await serviceHealthModel.findMany({
    orderBy: { checkedAt: 'desc' },
    take: 500,
    select: {
      targetType: true,
      targetId: true,
      status: true,
      latencyMs: true,
      message: true,
      checkedAt: true,
    },
  })
  const seen = new Set<string>()
  return checks.flatMap((check) => {
    const key = `${check.targetType}:${check.targetId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...check, checkedAt: check.checkedAt.toISOString() }]
  })
}
