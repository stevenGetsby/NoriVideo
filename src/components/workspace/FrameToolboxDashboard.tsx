'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface ApiModel {
  modelKey?: string
  modelId?: string
  name?: string
  type?: string
  provider?: string
  enabled?: boolean
}

interface ApiProvider {
  id?: string
  name?: string
  apiKey?: string
  hidden?: boolean
}

interface ApiConfigResponse {
  models?: ApiModel[]
  providers?: ApiProvider[]
  defaultModels?: Record<string, string | undefined>
  workflowConcurrency?: {
    analysis?: number
    image?: number
    video?: number
  }
}

interface TaskItem {
  id: string
  type: string
  status: string
  progress: number
  updatedAt: string
}

interface TasksResponse {
  tasks?: TaskItem[]
}

interface AssetItem {
  id: string
  kind: string
  family: string
}

interface AssetsResponse {
  assets?: AssetItem[]
}

interface PromptItem {
  promptId: string
  variableKeys: string[]
  hasOverride: {
    zh?: boolean
    en?: boolean
  }
}

interface PromptsResponse {
  prompts?: PromptItem[]
}

interface ToolboxData {
  config: ApiConfigResponse | null
  tasks: TaskItem[]
  assets: AssetItem[]
  prompts: PromptItem[]
}

const DEFAULT_TOOLBOX_DATA: ToolboxData = {
  config: null,
  tasks: [],
  assets: [],
  prompts: [],
}

const showInternalAgentTools = process.env.NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS === 'true'
const CAPABILITY_KEYS = ['models', 'tasks', 'assets', 'prompts', 'delivery'] as const

function activeStatuses(status: string) {
  return status === 'queued' || status === 'processing' || status === 'submitted' || status === 'running'
}

function isInternalAgentTask(task: TaskItem) {
  return task.type.toLowerCase().includes('agent')
}

function isInternalAgentPrompt(prompt: PromptItem) {
  return prompt.promptId.toLowerCase().includes('agent')
}

export function FrameToolboxDashboard() {
  const t = useTranslations('workspace.toolboxPanel')
  const [data, setData] = useState<ToolboxData>(DEFAULT_TOOLBOX_DATA)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadToolboxData() {
      setIsLoading(true)
      setError(null)
      try {
        const [configResponse, tasksResponse, assetsResponse, promptsResponse] = await Promise.all([
          apiFetch('/api/user/api-config'),
          apiFetch('/api/tasks?limit=60'),
          apiFetch('/api/assets?scope=global'),
          apiFetch('/api/prompt-templates'),
        ])

        const failed = [configResponse, tasksResponse, assetsResponse, promptsResponse].find((response) => !response.ok)
        if (failed) {
          throw new Error(`${failed.status} ${failed.statusText}`.trim())
        }

        const [config, tasksPayload, assetsPayload, promptsPayload] = await Promise.all([
          configResponse.json() as Promise<ApiConfigResponse>,
          tasksResponse.json() as Promise<TasksResponse>,
          assetsResponse.json() as Promise<AssetsResponse>,
          promptsResponse.json() as Promise<PromptsResponse>,
        ])

        if (!cancelled) {
          setData({
            config,
            tasks: Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [],
            assets: Array.isArray(assetsPayload.assets) ? assetsPayload.assets : [],
            prompts: Array.isArray(promptsPayload.prompts) ? promptsPayload.prompts : [],
          })
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadToolboxData()
    return () => {
      cancelled = true
    }
  }, [t])

  const visibleTasks = useMemo(() => {
    if (showInternalAgentTools) return data.tasks
    return data.tasks.filter((task) => !isInternalAgentTask(task))
  }, [data.tasks])

  const visiblePrompts = useMemo(() => {
    if (showInternalAgentTools) return data.prompts
    return data.prompts.filter((prompt) => !isInternalAgentPrompt(prompt))
  }, [data.prompts])

  const diagnostics = useMemo(() => {
    const models = data.config?.models ?? []
    const enabledModels = models.filter((model) => model.enabled !== false)
    const providers = (data.config?.providers ?? []).filter((provider) => !provider.hidden)
    const configuredProviders = providers.filter((provider) => !!provider.apiKey)
    const defaults = data.config?.defaultModels ?? {}
    const configuredDefaults = Object.values(defaults).filter(Boolean).length
    const activeTasks = visibleTasks.filter((task) => activeStatuses(task.status)).length
    const failedTasks = visibleTasks.filter((task) => task.status === 'failed').length
    const completedTasks = visibleTasks.filter((task) => task.status === 'completed').length
    const visualAssets = data.assets.filter((asset) => asset.family === 'visual').length
    const audioAssets = data.assets.filter((asset) => asset.family === 'audio').length
    const promptOverrides = visiblePrompts.filter((prompt) => prompt.hasOverride.zh || prompt.hasOverride.en).length

    return {
      enabledModels: enabledModels.length,
      videoModels: enabledModels.filter((model) => model.type === 'video').length,
      providers: providers.length,
      configuredProviders: configuredProviders.length,
      configuredDefaults,
      activeTasks,
      failedTasks,
      completedTasks,
      assets: data.assets.length,
      visualAssets,
      audioAssets,
      prompts: visiblePrompts.length,
      promptOverrides,
      concurrency: data.config?.workflowConcurrency ?? null,
    }
  }, [data.config?.defaultModels, data.config?.models, data.config?.providers, data.config?.workflowConcurrency, data.assets, visiblePrompts, visibleTasks])

  const checks = [
    {
      key: 'models',
      ok: diagnostics.enabledModels > 0 && diagnostics.configuredDefaults > 0,
      value: `${diagnostics.enabledModels} / ${diagnostics.configuredDefaults}`,
      href: '/profile',
    },
    {
      key: 'tasks',
      ok: diagnostics.failedTasks === 0,
      value: `${diagnostics.activeTasks} / ${diagnostics.failedTasks}`,
      href: '/service-records',
    },
    {
      key: 'assets',
      ok: diagnostics.assets > 0,
      value: `${diagnostics.visualAssets} / ${diagnostics.audioAssets}`,
      href: '/material',
    },
    {
      key: 'prompts',
      ok: diagnostics.prompts > 0,
      value: `${diagnostics.prompts} / ${diagnostics.promptOverrides}`,
      href: '/prompts',
    },
  ]

  const shortcuts = [
    { key: 'profile', href: '/profile', icon: 'settingsHexMinor' as const },
    { key: 'seedance', href: '/seedance', icon: 'film' as const },
    { key: 'assetHub', href: '/asset-hub', icon: 'folderHeart' as const },
    { key: 'records', href: '/service-records', icon: 'receipt' as const },
  ]

  const capabilityRows = CAPABILITY_KEYS.map((key) => {
    if (key === 'models') {
      return {
        key,
        status: diagnostics.enabledModels > 0 && diagnostics.configuredDefaults > 0 ? 'ok' : 'review',
        primary: `${diagnostics.enabledModels}`,
        secondary: `${diagnostics.configuredDefaults}`,
        href: '/profile',
      }
    }
    if (key === 'tasks') {
      return {
        key,
        status: diagnostics.failedTasks === 0 ? 'ok' : 'review',
        primary: `${diagnostics.activeTasks}`,
        secondary: `${diagnostics.failedTasks}`,
        href: '/service-records',
      }
    }
    if (key === 'assets') {
      return {
        key,
        status: diagnostics.assets > 0 ? 'ok' : 'review',
        primary: `${diagnostics.visualAssets}`,
        secondary: `${diagnostics.audioAssets}`,
        href: '/material',
      }
    }
    if (key === 'prompts') {
      return {
        key,
        status: diagnostics.prompts > 0 ? 'ok' : 'review',
        primary: `${diagnostics.prompts}`,
        secondary: `${diagnostics.promptOverrides}`,
        href: '/prompts',
      }
    }
    return {
      key,
      status: diagnostics.completedTasks > 0 ? 'ok' : 'review',
      primary: `${diagnostics.completedTasks}`,
      secondary: `${diagnostics.failedTasks}`,
      href: '/updates',
    }
  })

  const recentTasks = useMemo(
    () => [...visibleTasks]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6),
    [visibleTasks],
  )

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/service-records' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="receipt" className="h-4 w-4" />
            {t('openRecords')}
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
            {t('loadFailed')}: {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/52">
            <AppIcon name="loader" className="h-4 w-4 animate-spin" />
            {t('loading')}
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {checks.map((check) => (
                <Link
                  key={check.key}
                  href={{ pathname: check.href }}
                  className="rounded-md border border-white/10 bg-white/4 px-3 py-3 transition-colors hover:border-[#2c6ef2]/50 hover:bg-white/7"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-white/76">{t(`checks.${check.key}.title`)}</div>
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                      check.ok
                        ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                        : 'border-[#ffcc66]/35 bg-[#ffcc66]/10 text-[#ffd98a]'
                    }`}>
                      {check.ok ? t('status.ok') : t('status.review')}
                    </span>
                  </div>
                  <div className="text-lg font-bold text-white">{check.value}</div>
                  <div className="mt-1 text-xs leading-5 text-white/38">{t(`checks.${check.key}.hint`)}</div>
                </Link>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-white/10 bg-white/4 p-3">
                <div className="text-xs text-white/42">{t('metrics.providers')}</div>
                <div className="mt-1 text-xl font-bold text-white">{diagnostics.configuredProviders}/{diagnostics.providers}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/4 p-3">
                <div className="text-xs text-white/42">{t('metrics.videoModels')}</div>
                <div className="mt-1 text-xl font-bold text-white">{diagnostics.videoModels}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/4 p-3">
                <div className="text-xs text-white/42">{t('metrics.concurrency')}</div>
                <div className="mt-1 text-xl font-bold text-white">
                  {diagnostics.concurrency
                    ? `${diagnostics.concurrency.analysis ?? '-'} / ${diagnostics.concurrency.image ?? '-'} / ${diagnostics.concurrency.video ?? '-'}`
                    : '-'}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-md border border-white/10">
              <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                    <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#9bc3ff]" />
                    {t('capabilityTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-white/40">{t('capabilitySubtitle')}</p>
                </div>
                <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
                  {t('capability.local')}
                </span>
              </div>
              <div className="grid grid-cols-[.8fr_.55fr_.65fr_.65fr_.9fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
                <div>{t('capability.columns.module')}</div>
                <div>{t('capability.columns.status')}</div>
                <div>{t('capability.columns.primary')}</div>
                <div>{t('capability.columns.secondary')}</div>
                <div>{t('capability.columns.action')}</div>
              </div>
              <div className="divide-y divide-white/8">
                {capabilityRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[.8fr_.55fr_.65fr_.65fr_.9fr] gap-2 px-3 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white/74">{t(`capability.modules.${row.key}.title`)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-white/34">{t(`capability.modules.${row.key}.hint`)}</div>
                    </div>
                    <div>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        row.status === 'ok'
                          ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                          : 'border-[#ffd98a]/30 bg-[#ffd98a]/10 text-[#ffd98a]'
                      }`}>
                        {t(`status.${row.status}`)}
                      </span>
                    </div>
                    <div className="text-white/56">{row.primary}</div>
                    <div className="text-white/56">{row.secondary}</div>
                    <Link href={{ pathname: row.href }} className="truncate text-[#9bc3ff] hover:text-white">
                      {t(`capability.modules.${row.key}.action`)}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="settingsHexMinor" className="h-4 w-4 text-[#7eb0ff]" />
            {t('shortcutsTitle')}
          </div>
          <div className="space-y-2">
            {shortcuts.map((shortcut) => (
              <Link
                key={shortcut.key}
                href={{ pathname: shortcut.href }}
                className="flex items-center gap-3 rounded-md border border-white/10 bg-white/4 px-3 py-3 transition-colors hover:border-[#2c6ef2]/50 hover:bg-white/7"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-[#7eb0ff]">
                  <AppIcon name={shortcut.icon} className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white/78">{t(`shortcuts.${shortcut.key}.title`)}</div>
                  <div className="mt-0.5 truncate text-xs text-white/38">{t(`shortcuts.${shortcut.key}.hint`)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="clock" className="h-4 w-4 text-[#7eb0ff]" />
            {t('taskQueueTitle')}
          </div>
          {recentTasks.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/45">{t('taskQueueEmpty')}</div>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((task) => (
                <div key={task.id} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate font-mono text-xs text-white/72">{task.type}</div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
                      task.status === 'failed'
                        ? 'border-[#ff6b6b]/35 bg-[#ff6b6b]/10 text-[#ff9a9a]'
                        : activeStatuses(task.status)
                          ? 'border-[#ffd98a]/30 bg-[#ffd98a]/10 text-[#ffd98a]'
                          : 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${Math.min(100, Math.max(4, task.progress || 0))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
