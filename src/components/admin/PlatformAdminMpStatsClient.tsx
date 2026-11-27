'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { AdminAlert, AdminEmpty, AdminLoading, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AdminStats } from '@/lib/mp/stats'
import './admin-mp.css'

const RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
] as const

type RangeKey = typeof RANGES[number]['key']

const SOURCE_LABEL: Record<string, string> = {
  channel: '渠道码',
  share: '分享',
  qrcode: '小程序码',
  timeline: '朋友圈',
  subscribe: '订阅消息',
  official_account: '公众号',
  channels: '视频号',
  url_link: '外链',
  search: '搜索',
  recent: '最近使用',
  other: '其他',
}

function DailyChart({ daily }: { daily: AdminStats['daily'] }) {
  const width = 640
  const height = 148
  const groupGap = 6
  const barGap = 2
  const max = Math.max(1, ...daily.flatMap((day) => [day.newUsers, day.starts]))
  const groupWidth = (width - groupGap * Math.max(0, daily.length - 1)) / Math.max(1, daily.length)
  const barWidth = Math.max(2, (groupWidth - barGap) / 2)
  const labels = daily.length > 0 ? [0, Math.floor((daily.length - 1) / 2), daily.length - 1] : []
  return (
    // eslint-disable-next-line no-restricted-syntax -- This SVG is a data chart, not an interface icon.
    <svg className="nori-mp-stats-chart" viewBox={`0 0 ${width} ${height + 20}`} role="img" aria-label="每日新增用户与开始游玩">
      {[0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = Math.round(height * (1 - ratio))
        return <line key={ratio} className="is-grid" x1={0} y1={y} x2={width} y2={y} />
      })}
      {daily.map((day, index) => {
        const x = index * (groupWidth + groupGap)
        const userHeight = day.newUsers > 0 ? Math.max(3, Math.round((day.newUsers / max) * height)) : 0
        const startHeight = day.starts > 0 ? Math.max(3, Math.round((day.starts / max) * height)) : 0
        return (
          <g key={day.date}>
            <rect className="is-users" x={x} y={height - userHeight} width={barWidth} height={userHeight} rx={2.5}>
              <title>{`${day.date} 新增用户 ${day.newUsers}`}</title>
            </rect>
            <rect className="is-starts" x={x + barWidth + barGap} y={height - startHeight} width={barWidth} height={startHeight} rx={2.5}>
              <title>{`${day.date} 开始游玩 ${day.starts}`}</title>
            </rect>
          </g>
        )
      })}
      {labels.map((index, idx) => (
        <text
          key={`${index}-${idx}`}
          x={index === 0 ? 0 : index === daily.length - 1 ? width : index * (groupWidth + groupGap) + groupWidth / 2}
          y={height + 15}
          textAnchor={index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle'}
        >
          {daily[index]?.date.slice(5)}
        </text>
      ))}
    </svg>
  )
}

export function PlatformAdminMpStatsClient() {
  const [range, setRange] = useState<RangeKey>('7d')
  const [data, setData] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await apiFetch(`/api/admin/mp/stats?range=${range}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载失败'))
        const payload = await response.json() as AdminStats
        if (!cancelled) setData(payload)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [range, reloadKey])

  const maxSourceUsers = Math.max(1, ...(data?.sources ?? []).map((item) => item.newUsers))

  return (
    <PlatformAdminShell
      active="mp-stats"
      eyebrow="平台管理"
      title="小程序数据"
      description="聚合监控小程序新增用户、游玩转化、作品表现与渠道获客趋势。"
      actions={(
        <button type="button" className="fos-btn fos-btn-ghost" disabled={loading} onClick={() => setReloadKey((key) => key + 1)}>
          <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </button>
      )}
    >
      <div className="nori-mp-review-tabs" role="tablist" aria-label="时间范围">
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={range === item.key}
            className={`nori-mp-review-tab${range === item.key ? ' is-active' : ''}`}
            onClick={() => setRange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? (
        <AdminAlert tone="error" action={<button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button>}>{error}</AdminAlert>
      ) : loading && !data ? (
        <AdminLoading label="正在加载小程序统计数据…" />
      ) : data ? (
        <div className="nori-admin-stack">
          <div className="nori-mp-stats-kpis">
            {[
              { label: '新增用户', value: data.kpis.newUsers },
              { label: '活跃用户', value: data.kpis.activeUsers },
              { label: '开始游玩', value: data.kpis.starts },
              { label: '完成数', value: data.kpis.completions },
              { label: '分享数', value: data.kpis.shares },
              { label: '分享带来的新用户', value: data.kpis.shareNewUsers },
            ].map((kpi) => (
              <div key={kpi.label} className="nori-mp-stats-kpi">
                <span>{kpi.label}</span>
                <strong>{kpi.value.toLocaleString('zh-CN')}</strong>
              </div>
            ))}
          </div>
          <section className="nori-admin-panel">
            <div className="nori-admin-panel-head">
              <div>
                <h2>每日趋势</h2>
                <p>按北京时间统计每日新增用户与开始游玩次数</p>
              </div>
              <div className="nori-mp-stats-legend">
                <span><i className="is-users" />新增用户</span>
                <span><i className="is-starts" />开始游玩</span>
              </div>
            </div>
            <div className="nori-admin-panel-body nori-mp-stats-chart-body">
              <DailyChart daily={data.daily} />
            </div>
          </section>
          <section className="nori-admin-panel">
            <div className="nori-admin-panel-head"><div><h2>作品排行</h2></div></div>
            {data.works.length === 0 ? <AdminEmpty icon="chart">暂无数据</AdminEmpty> : (
              <div className="nori-admin-table-wrap">
                <table className="nori-admin-table">
                  <thead><tr><th>作品</th><th>玩家</th><th>完成率</th><th>分享</th><th>评分</th></tr></thead>
                  <tbody>
                    {data.works.map((work) => (
                      <tr key={work.title}>
                        <td className="font-medium">{work.title}</td>
                        <td>{work.players.toLocaleString('zh-CN')}</td>
                        <td>
                          <div className="nori-mp-stats-bar-cell">
                            <span>{(work.completionRate * 100).toFixed(1)}%</span>
                            <span className="nori-mp-stats-bar-track" aria-hidden="true">
                              <span className="nori-mp-stats-bar-fill" style={{ width: `${Math.min(100, Math.round(work.completionRate * 100))}%` }} />
                            </span>
                          </div>
                        </td>
                        <td>{work.shares.toLocaleString('zh-CN')}</td>
                        <td>{work.ratingCount > 0 ? `${work.ratingScore.toFixed(1)}（${work.ratingCount}）` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="nori-admin-panel">
              <div className="nori-admin-panel-head"><div><h2>来源分布</h2></div></div>
              {data.sources.length === 0 ? <AdminEmpty icon="globe">暂无数据</AdminEmpty> : (
                <div className="nori-admin-table-wrap">
                  <table className="nori-admin-table">
                    <thead><tr><th>来源</th><th>新增用户</th></tr></thead>
                    <tbody>
                      {data.sources.map((source) => (
                        <tr key={source.source}>
                          <td>{SOURCE_LABEL[source.source] ?? source.source}</td>
                          <td>
                            <div className="nori-mp-stats-bar-cell">
                              <strong>{source.newUsers.toLocaleString('zh-CN')}</strong>
                              <span className="nori-mp-stats-bar-track" aria-hidden="true">
                                <span className="nori-mp-stats-bar-fill" style={{ width: `${Math.max(4, Math.round((source.newUsers / maxSourceUsers) * 100))}%` }} />
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="nori-admin-panel">
              <div className="nori-admin-panel-head"><div><h2>渠道表现</h2></div></div>
              {data.channels.length === 0 ? <AdminEmpty icon="link">暂无数据</AdminEmpty> : (
                <div className="nori-admin-table-wrap">
                  <table className="nori-admin-table">
                    <thead><tr><th>渠道</th><th>新用户</th><th>游玩人数</th></tr></thead>
                    <tbody>
                      {data.channels.map((channel) => (
                        <tr key={channel.name}>
                          <td className="font-medium">{channel.name}</td>
                          <td>{channel.newUsers.toLocaleString('zh-CN')}</td>
                          <td>{channel.players.toLocaleString('zh-CN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </PlatformAdminShell>
  )
}
