'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface PromptMeta {
  promptId: string
  variableKeys: string[]
  hasOverride: {
    zh?: boolean
    en?: boolean
  }
}

interface PromptTemplatesResponse {
  prompts?: PromptMeta[]
}

type PromptGroup = 'script' | 'assets' | 'storyboard' | 'video' | 'utility'
const PROMPT_GROUPS: PromptGroup[] = ['script', 'assets', 'storyboard', 'video', 'utility']
const showInternalAgentTools = process.env.NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS === 'true'

function resolvePromptGroup(promptId: string): PromptGroup {
  if (promptId.includes('screenplay') || promptId.includes('episode') || promptId.includes('clip') || promptId.includes('story_expand')) {
    return 'script'
  }
  if (promptId.includes('character') || promptId.includes('location') || promptId.includes('prop') || promptId.includes('voice')) {
    return 'assets'
  }
  if (promptId.includes('storyboard') || promptId.includes('panel') || promptId.includes('cinematographer') || promptId.includes('acting')) {
    return 'storyboard'
  }
  if (promptId.includes('video') || promptId.includes('shot')) {
    return 'video'
  }
  return 'utility'
}

function formatPromptName(promptId: string) {
  return promptId
    .replace(/^np_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isInternalAgentPrompt(promptId: string) {
  return promptId.toLowerCase().includes('agent')
}

export function FramePromptsDashboard() {
  const t = useTranslations('workspace.promptsPanel')
  const [prompts, setPrompts] = useState<PromptMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPrompts() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/prompt-templates')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim())
        }
        const data = (await response.json()) as PromptTemplatesResponse
        if (!cancelled) setPrompts(Array.isArray(data.prompts) ? data.prompts : [])
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadPrompts()
    return () => {
      cancelled = true
    }
  }, [t])

  const visiblePrompts = useMemo(() => {
    if (showInternalAgentTools) return prompts
    return prompts.filter((prompt) => !isInternalAgentPrompt(prompt.promptId))
  }, [prompts])

  const stats = useMemo(() => {
    return visiblePrompts.reduce(
      (acc, prompt) => {
        acc.total += 1
        acc.zhOverrides += prompt.hasOverride.zh ? 1 : 0
        acc.enOverrides += prompt.hasOverride.en ? 1 : 0
        acc.variables += prompt.variableKeys.length
        return acc
      },
      { total: 0, zhOverrides: 0, enOverrides: 0, variables: 0 },
    )
  }, [visiblePrompts])

  const groupedPrompts = useMemo(() => {
    const groups: Record<PromptGroup, PromptMeta[]> = {
      script: [],
      assets: [],
      storyboard: [],
      video: [],
      utility: [],
    }
    for (const prompt of visiblePrompts) {
      groups[resolvePromptGroup(prompt.promptId)].push(prompt)
    }
    return groups
  }, [visiblePrompts])

  const featuredPrompts = useMemo(
    () => visiblePrompts
      .filter((prompt) => prompt.hasOverride.zh || prompt.hasOverride.en || prompt.variableKeys.length > 0)
      .slice(0, 10),
    [visiblePrompts],
  )

  const coverageRows = useMemo(() => PROMPT_GROUPS.map((group) => {
    const items = groupedPrompts[group]
    const zhOverrides = items.filter((prompt) => prompt.hasOverride.zh).length
    const enOverrides = items.filter((prompt) => prompt.hasOverride.en).length
    const variableCount = items.reduce((sum, prompt) => sum + prompt.variableKeys.length, 0)
    const missingCoverage = items.filter((prompt) => !prompt.hasOverride.zh && !prompt.hasOverride.en).length
    return {
      group,
      templates: items.length,
      variableCount,
      zhOverrides,
      enOverrides,
      missingCoverage,
    }
  }), [groupedPrompts])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="bookmark" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/profile' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="settingsHexMinor" className="h-4 w-4" />
            {t('openEditor')}
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {(['total', 'zhOverrides', 'enOverrides', 'variables'] as const).map((key) => (
            <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
              <div className="text-base font-bold text-white">{stats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
            {t('loadFailed')}: {error}
          </div>
        ) : null}

        <div className="mb-4 overflow-hidden rounded-md border border-white/10">
          <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#9bc3ff]" />
                {t('coverageTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('coverageSubtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('coverage.local')}
            </span>
          </div>
          <div className="grid grid-cols-[.8fr_.55fr_.55fr_.55fr_.55fr_.65fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('coverage.columns.group')}</div>
            <div>{t('coverage.columns.templates')}</div>
            <div>{t('coverage.columns.variables')}</div>
            <div>{t('coverage.columns.zh')}</div>
            <div>{t('coverage.columns.en')}</div>
            <div>{t('coverage.columns.missing')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {coverageRows.map((row) => (
              <div key={row.group} className="grid grid-cols-[.8fr_.55fr_.55fr_.55fr_.55fr_.65fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/74">{t(`groups.${row.group}`)}</div>
                <div className="text-white/56">{row.templates}</div>
                <div className="text-white/56">{row.variableCount}</div>
                <div className={row.zhOverrides > 0 ? 'font-medium text-[#8ff0b9]' : 'text-white/42'}>{row.zhOverrides}</div>
                <div className={row.enOverrides > 0 ? 'font-medium text-[#8ff0b9]' : 'text-white/42'}>{row.enOverrides}</div>
                <div className={row.missingCoverage > 0 ? 'font-medium text-[#ffd98a]' : 'text-white/42'}>{row.missingCoverage}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.2fr_.9fr_.7fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('table.prompt')}</div>
            <div>{t('table.variables')}</div>
            <div>{t('table.override')}</div>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : visiblePrompts.length === 0 ? (
            <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {(featuredPrompts.length > 0 ? featuredPrompts : visiblePrompts.slice(0, 10)).map((prompt) => (
                <div key={prompt.promptId} className="grid grid-cols-[1.2fr_.9fr_.7fr] gap-3 px-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white/78">{formatPromptName(prompt.promptId)}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-white/32">{prompt.promptId}</div>
                  </div>
                  <div className="min-w-0">
                    {prompt.variableKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {prompt.variableKeys.slice(0, 3).map((variable) => (
                          <span key={variable} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-white/52">
                            {variable}
                          </span>
                        ))}
                        {prompt.variableKeys.length > 3 ? (
                          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/38">
                            +{prompt.variableKeys.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-white/32">{t('noVariables')}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['zh', 'en'] as const).map((locale) => (
                      <span
                        key={locale}
                        className={`rounded border px-1.5 py-0.5 text-[11px] ${
                          prompt.hasOverride[locale]
                            ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                            : 'border-white/10 bg-white/5 text-white/34'
                        }`}
                      >
                        {locale.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="folderOpen" className="h-4 w-4 text-[#7eb0ff]" />
          {t('groupsTitle')}
        </div>
        <div className="space-y-2">
          {PROMPT_GROUPS.map((group) => {
            const count = groupedPrompts[group].length
            const overrides = groupedPrompts[group].filter((prompt) => prompt.hasOverride.zh || prompt.hasOverride.en).length
            return (
              <div key={group} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white/76">{t(`groups.${group}`)}</div>
                  <div className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/48">{count}</div>
                </div>
                <div className="mt-2 text-xs text-white/38">{t('overrideCount', { count: overrides })}</div>
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
