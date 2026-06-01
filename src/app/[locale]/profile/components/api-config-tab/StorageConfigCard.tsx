'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { AppIcon } from '@/components/ui/icons'

interface StorageConfig {
  storageType: string
  endpoint: string
  publicEndpoint: string
  bucket: string
  region: string
  hasAccessKey: boolean
  hasSecretKey: boolean
}

const DEFAULT_CONFIG: StorageConfig = {
  storageType: 'tos',
  endpoint: 'https://tos-cn-beijing.volces.com',
  publicEndpoint: 'https://tos-cn-beijing.volces.com',
  bucket: 'chaofen',
  region: 'cn-beijing',
  hasAccessKey: false,
  hasSecretKey: false,
}

export function StorageConfigCard() {
  const [config, setConfig] = useState<StorageConfig>(DEFAULT_CONFIG)
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'testing' | 'saved' | 'passed' | 'failed'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch('/api/user/storage-config')
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取存储配置失败'))
        const payload = await response.json() as { config?: Partial<StorageConfig> }
        if (!cancelled) {
          setConfig({ ...DEFAULT_CONFIG, ...payload.config })
          setStatus('idle')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('failed')
          setMessage(error instanceof Error ? error.message : '读取存储配置失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateField = (field: keyof Pick<StorageConfig, 'endpoint' | 'publicEndpoint' | 'bucket' | 'region'>, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }))
  }

  const saveConfig = async () => {
    setStatus('saving')
    setMessage(null)
    try {
      const response = await apiFetch('/api/user/storage-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: config.endpoint,
          publicEndpoint: config.publicEndpoint,
          bucket: config.bucket,
          region: config.region,
          accessKey,
          secretKey,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存存储配置失败'))
      const payload = await response.json() as { config?: Partial<StorageConfig> }
      setConfig({ ...DEFAULT_CONFIG, ...payload.config })
      setAccessKey('')
      setSecretKey('')
      setStatus('saved')
      setMessage('已保存')
    } catch (error) {
      setStatus('failed')
      setMessage(error instanceof Error ? error.message : '保存存储配置失败')
    }
  }

  const testConfig = async () => {
    setStatus('testing')
    setMessage(null)
    try {
      const response = await apiFetch('/api/user/storage-config', { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, 'TOS 测试失败'))
      setStatus('passed')
      setMessage('TOS 上传与公网签名下载通过')
    } catch (error) {
      setStatus('failed')
      setMessage(error instanceof Error ? error.message : 'TOS 测试失败')
    }
  }

  const busy = status === 'loading' || status === 'saving' || status === 'testing'

  return (
    <section className="glass-surface rounded-2xl p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="glass-surface-soft inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--glass-text-secondary)]">
            <AppIcon name="cloudUpload" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-[var(--glass-text-primary)]">TOS 存储配置</h2>
            <p className="text-[13px] text-[var(--glass-text-secondary)]">视频上传暂存与 MediaKit 输入源</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--glass-text-secondary)]">
          {config.storageType}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          Endpoint
          <input value={config.endpoint} onChange={(event) => updateField('endpoint', event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          Public Endpoint
          <input value={config.publicEndpoint} onChange={(event) => updateField('publicEndpoint', event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          Bucket
          <input value={config.bucket} onChange={(event) => updateField('bucket', event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          Region
          <input value={config.region} onChange={(event) => updateField('region', event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          AccessKeyId {config.hasAccessKey ? <span className="text-xs text-[var(--glass-tone-success-fg)]">已配置</span> : null}
          <input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={config.hasAccessKey ? '留空则保持现有值' : ''} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-[var(--glass-text-primary)]">
          SecretAccessKey {config.hasSecretKey ? <span className="text-xs text-[var(--glass-tone-success-fg)]">已配置</span> : null}
          <input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={config.hasSecretKey ? '留空则保持现有值' : ''} className="glass-input-base w-full px-3 py-2 text-sm font-normal" />
        </label>
      </div>

      {message ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${status === 'failed' ? 'border-[var(--glass-tone-danger-fg)]/25 bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)]' : 'border-[var(--glass-tone-success-fg)]/25 bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'}`}>
          {message}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => void testConfig()} disabled={busy} className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm font-semibold disabled:opacity-50">
          {status === 'testing' ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="refresh" className="h-4 w-4" />}
          测试连接
        </button>
        <button type="button" onClick={() => void saveConfig()} disabled={busy} className="glass-btn-base glass-btn-primary px-3 py-2 text-sm font-semibold disabled:opacity-50">
          {status === 'saving' ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="check" className="h-4 w-4" />}
          保存配置
        </button>
      </div>
    </section>
  )
}