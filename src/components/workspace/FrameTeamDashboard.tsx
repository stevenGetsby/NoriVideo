'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

const ROLE_KEYS = ['owner', 'writer', 'asset', 'producer'] as const
const PERMISSION_KEYS = ['projects', 'scripts', 'assets', 'production', 'records'] as const
const QUOTA_KEYS = ['projects', 'runningTasks', 'serviceUnits'] as const
const showInternalAgentTools = process.env.NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS === 'true'

interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  stats?: {
    episodes: number
    panels: number
    videos: number
  }
}

interface TaskSummary {
  id: string
  type: string
  status: string
  updatedAt: string
  projectId?: string | null
}

interface TeamStats {
  projects: number
  episodes: number
  activeTasks: number
  failedTasks: number
}

interface WorkloadRow {
  key: string
  count: number
  failed: number
}

interface QuotaRow {
  used: number
  limit: number
}

type QuotaRows = Record<(typeof QUOTA_KEYS)[number], QuotaRow>

interface SeatRow {
  role: (typeof ROLE_KEYS)[number]
  status: 'enabled' | 'reserved'
  projects: number
  workload: number
  lastActivity: string | null
  permissions: number
}

interface TeamOverviewResponse {
  projects?: ProjectSummary[]
  projectTotal?: number
  tasks?: TaskSummary[]
  stats?: TeamStats
  workloadRows?: WorkloadRow[]
  quotaRows?: QuotaRows
  seatRows?: SeatRow[]
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function countRolePermissions(role: (typeof ROLE_KEYS)[number]) {
  if (role === 'owner') return PERMISSION_KEYS.length
  if (role === 'writer') return 2
  if (role === 'asset') return 2
  return 3
}

function getLatestActivity(projects: ProjectSummary[], tasks: TaskSummary[]) {
  const timestamps = [...projects.map((project) => project.updatedAt), ...tasks.map((task) => task.updatedAt)]
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function isInternalAgentTask(task: TaskSummary) {
  return task.type.toLowerCase().includes('agent')
}

export function FrameTeamDashboard() {
  const t = useTranslations('workspace.teamPanel')
  const { data: session } = useSession()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [serverStats, setServerStats] = useState<TeamStats | null>(null)
  const [serverWorkloadRows, setServerWorkloadRows] = useState<WorkloadRow[] | null>(null)
  const [serverQuotaRows, setServerQuotaRows] = useState<QuotaRows | null>(null)
  const [serverSeatRows, setServerSeatRows] = useState<SeatRow[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadTeamData() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/workspace/team-overview')
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
        const payload = await response.json() as TeamOverviewResponse
        if (!cancelled) {
          setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          setProjectTotal(payload.projectTotal ?? payload.projects?.length ?? 0)
          setTasks(Array.isArray(payload.tasks) ? payload.tasks : [])
          setServerStats(payload.stats || null)
          setServerWorkloadRows(Array.isArray(payload.workloadRows) ? payload.workloadRows : null)
          setServerQuotaRows(payload.quotaRows || null)
          setServerSeatRows(Array.isArray(payload.seatRows) ? payload.seatRows : null)
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadTeamData()
    return () => {
      cancelled = true
    }
  }, [t])

  const visibleTasks = useMemo(() => {
    if (showInternalAgentTools) return tasks
    return tasks.filter((task) => !isInternalAgentTask(task))
  }, [tasks])

  const stats = useMemo(() => {
    if (serverStats) return serverStats
    const activeTasks = visibleTasks.filter((task) => task.status === 'queued' || task.status === 'processing').length
    const failedTasks = visibleTasks.filter((task) => task.status === 'failed').length
    return {
      projects: projectTotal,
      episodes: projects.reduce((sum, project) => sum + (project.stats?.episodes ?? 0), 0),
      activeTasks,
      failedTasks,
    }
  }, [projectTotal, projects, serverStats, visibleTasks])

  const workloadRows = useMemo(() => {
    if (serverWorkloadRows) return serverWorkloadRows.slice(0, 5)
    const rows = new Map<string, { key: string; count: number; failed: number }>()
    for (const task of visibleTasks) {
      const key = task.type || 'unknown'
      const current = rows.get(key) || { key, count: 0, failed: 0 }
      current.count += 1
      if (task.status === 'failed') current.failed += 1
      rows.set(key, current)
    }
    return Array.from(rows.values()).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [serverWorkloadRows, visibleTasks])

  const quotaRows = useMemo(() => {
    if (serverQuotaRows) return serverQuotaRows
    const serviceUnits = visibleTasks.reduce((sum, task) => {
      if (task.status !== 'completed') return sum
      const text = task.type.toLowerCase()
      if (text.includes('video')) return sum + 6
      if (text.includes('voice') || text.includes('tts')) return sum + 2
      if (text.includes('image') || text.includes('storyboard')) return sum + 1
      return sum
    }, 0)
    return {
      projects: { used: projectTotal, limit: Math.max(10, projectTotal) },
      runningTasks: { used: stats.activeTasks, limit: 8 },
      serviceUnits: { used: serviceUnits, limit: Math.max(120, serviceUnits) },
    }
  }, [projectTotal, serverQuotaRows, stats.activeTasks, visibleTasks])

  const seatRows = useMemo(() => {
    if (serverSeatRows) {
      return serverSeatRows.map((row) => ({
        ...row,
        lastActivity: row.lastActivity ? formatDate(row.lastActivity) : t('seatMatrix.none'),
      }))
    }
    const latestActivity = getLatestActivity(projects, visibleTasks)
    return ROLE_KEYS.map((role) => ({
      role,
      status: role === 'owner' ? 'enabled' : 'reserved',
      projects: role === 'owner' ? projectTotal : 0,
      workload: role === 'owner' ? visibleTasks.length : 0,
      lastActivity: role === 'owner' && latestActivity ? formatDate(latestActivity) : t('seatMatrix.none'),
      permissions: countRolePermissions(role),
    }))
  }, [projectTotal, projects, serverSeatRows, t, visibleTasks])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="usersRound" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/projects' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="monitor" className="h-4 w-4" />
            {t('openProjects')}
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
            {t('loadFailed')}: {error}
          </div>
        ) : null}

        <div className="mb-4 rounded-lg border border-white/10 bg-white/4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white">
              {(session?.user?.name || session?.user?.email || 'N').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-white">{session?.user?.name || t('fallbackName')}</div>
              <div className="truncate text-sm text-white/45">{session?.user?.email || t('personalAccount')}</div>
            </div>
            <span className="ml-auto rounded border border-[#45d483]/30 bg-[#45d483]/10 px-2 py-1 text-xs font-medium text-[#8ff0b9]">
              {t('ownerBadge')}
            </span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {(['seat', 'workspace', 'security'] as const).map((key) => (
              <div key={key} className="rounded-md border border-white/8 bg-[#10131b] px-3 py-2">
                <div className="text-[11px] text-white/38">{t(`profile.${key}.label`)}</div>
                <div className="mt-1 truncate text-sm font-semibold text-white/72">{t(`profile.${key}.value`)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {(['projects', 'episodes', 'activeTasks', 'failedTasks'] as const).map((key) => (
            <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
              <div className="text-base font-bold text-white">{stats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 overflow-hidden rounded-md border border-white/10">
          <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <AppIcon name="usersRound" className="h-4 w-4 text-[#9bc3ff]" />
                {t('seatMatrix.title')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('seatMatrix.subtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('seatMatrix.personalMode')}
            </span>
          </div>
          <div className="grid grid-cols-[.75fr_.65fr_.65fr_.65fr_.9fr_.65fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('seatMatrix.columns.role')}</div>
            <div>{t('seatMatrix.columns.status')}</div>
            <div>{t('seatMatrix.columns.projects')}</div>
            <div>{t('seatMatrix.columns.workload')}</div>
            <div>{t('seatMatrix.columns.lastActivity')}</div>
            <div>{t('seatMatrix.columns.permissions')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {seatRows.map((row) => (
              <div key={row.role} className="grid grid-cols-[.75fr_.65fr_.65fr_.65fr_.9fr_.65fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/74">{t(`roles.${row.role}.title`)}</div>
                <div>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                    row.status === 'enabled'
                      ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                      : 'border-white/10 bg-white/5 text-white/38'
                  }`}>
                    {t(row.status)}
                  </span>
                </div>
                <div className="text-white/56">{t('seatMatrix.projectCount', { count: row.projects })}</div>
                <div className="text-white/56">{t('seatMatrix.taskCount', { count: row.workload })}</div>
                <div className="truncate text-white/42">{row.lastActivity}</div>
                <div className="text-white/56">{t('seatMatrix.permissionCount', { count: row.permissions })}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.2fr_.7fr_.8fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('table.project')}</div>
            <div>{t('table.episodes')}</div>
            <div>{t('table.updatedAt')}</div>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {projects.map((project) => (
                <div key={project.id} className="grid grid-cols-[1.2fr_.7fr_.8fr] gap-3 px-3 py-3 text-sm">
                  <Link href={`/workspace/${project.id}`} className="truncate font-medium text-white/78 hover:text-white">
                    {project.name}
                  </Link>
                  <div className="text-white/58">{project.stats?.episodes ?? 0}</div>
                  <div className="text-xs text-white/45">{formatDate(project.updatedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-md border border-white/10 bg-white/4 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/76">
              <AppIcon name="chart" className="h-4 w-4 text-[#9bc3ff]" />
              {t('workloadTitle')}
            </div>
            {workloadRows.length > 0 ? (
              <div className="space-y-2">
                {workloadRows.map((row) => {
                  const maxCount = Math.max(...workloadRows.map((item) => item.count), 1)
                  return (
                    <div key={row.key} className="rounded-md border border-white/8 bg-[#10131b] px-3 py-2">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium text-white/74">{row.key}</div>
                        <span className={`rounded px-2 py-0.5 text-[11px] ${row.failed > 0 ? 'bg-[#ff6b6b]/10 text-[#ff9a9a]' : 'bg-white/6 text-white/42'}`}>
                          {t('workloadFailed', { count: row.failed })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${Math.max(8, Math.round((row.count / maxCount) * 100))}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-white/38">{t('workloadTasks', { count: row.count })}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-sm text-white/38">{t('workloadEmpty')}</div>
            )}
          </div>

          <div className="rounded-md border border-white/10 bg-white/4 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/76">
              <AppIcon name="lock" className="h-4 w-4 text-[#ffd98a]" />
              {t('quotaTitle')}
            </div>
            <div className="space-y-3">
              {QUOTA_KEYS.map((key) => {
                const quota = quotaRows[key]
                const progress = quota.limit ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <span className="text-white/52">{t(`quota.${key}`)}</span>
                      <span className="font-medium text-white/72">{quota.used}/{quota.limit}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-[#45d483]" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="lock" className="h-4 w-4 text-[#7eb0ff]" />
          {t('rolesTitle')}
        </div>
        <div className="space-y-2">
          {ROLE_KEYS.map((role) => (
            <div key={role} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-white/76">{t(`roles.${role}.title`)}</div>
                <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  role === 'owner'
                    ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                    : 'border-white/10 bg-white/5 text-white/38'
                }`}>
                  {role === 'owner' ? t('enabled') : t('reserved')}
                </span>
              </div>
              <div className="mt-1 text-xs leading-5 text-white/38">{t(`roles.${role}.hint`)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="usersRound" className="h-4 w-4 text-[#7eb0ff]" />
          {t('permissionsTitle')}
        </div>
        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[.8fr_repeat(5,minmax(44px,1fr))] gap-1 border-b border-white/10 bg-white/5 px-2 py-2 text-[11px] text-white/42">
            <div>{t('permissions.role')}</div>
            {PERMISSION_KEYS.map((permission) => (
              <div key={permission} className="truncate text-center">{t(`permissions.${permission}`)}</div>
            ))}
          </div>
          <div className="divide-y divide-white/8">
            {ROLE_KEYS.map((role) => (
              <div key={role} className="grid grid-cols-[.8fr_repeat(5,minmax(44px,1fr))] gap-1 px-2 py-2 text-[11px]">
                <div className="truncate text-white/62">{t(`roles.${role}.title`)}</div>
                {PERMISSION_KEYS.map((permission) => {
                  const enabled = role === 'owner'
                  return (
                    <div key={permission} className="text-center">
                      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 ${
                        enabled
                          ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                          : 'border-white/10 bg-white/5 text-white/28'
                      }`}>
                        {enabled ? t('permissions.enabled') : t('permissions.reserved')}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      </aside>
    </div>
  )
}
