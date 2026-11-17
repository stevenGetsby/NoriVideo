'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import type { CreatorStats } from '@/lib/mp/stats'
import { storyErrorMessage } from '../interactive/story-api-error'

const RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
] as const

type RangeKey = typeof RANGES[number]['key']

function DailyChart({ daily }: { daily: CreatorStats['daily'] }) {
  const width = 600
  const height = 120
  const gap = 4
  const max = Math.max(1, ...daily.map((day) => day.players))
  const barWidth = (width - gap * (daily.length - 1)) / daily.length
  const labels = [0, Math.floor((daily.length - 1) / 2), daily.length - 1]
  return (
    // eslint-disable-next-line no-restricted-syntax -- This SVG is a data chart, not an interface icon.
    <svg className="nori-mp-chart" viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label="每日玩家">
      {daily.map((day, index) => {
        const barHeight = day.players > 0 ? Math.max(2, Math.round((day.players / max) * height)) : 0
        return (
          <rect key={day.date} x={index * (barWidth + gap)} y={height - barHeight} width={barWidth} height={barHeight} rx={2}>
            <title>{`${day.date} 玩家 ${day.players}`}</title>
          </rect>
        )
      })}
      {labels.map((index) => (
        <text
          key={index}
          x={index === 0 ? 0 : index === daily.length - 1 ? width : index * (barWidth + gap) + barWidth / 2}
          y={height + 14}
          textAnchor={index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle'}
        >
          {daily[index]?.date.slice(5)}
        </text>
      ))}
    </svg>
  )
}

export function StatsCard({ workId }: { workId: string }) {
  const [range, setRange] = useState<RangeKey>('7d')
  const [data, setData] = useState<CreatorStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/interactive/${encodeURIComponent(workId)}/publish/stats`

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await apiFetch(`${endpoint}?range=${range}`)
      if (!response.ok) throw new Error(await storyErrorMessage(response, '加载数据失败'))
      setData(await response.json() as CreatorStats)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '加载数据失败')
    }
  }, [endpoint, range])

  useEffect(() => { void load() }, [load])

  const empty = data
    && data.kpis.views === 0 && data.kpis.starts === 0 && data.kpis.players === 0
    && data.endings.length === 0 && data.choices.length === 0

  return (
    <section className="nori-mp-card">
      <div className="nori-mp-card-head">
        <h2>数据</h2>
        <div className="nori-mp-chips" role="tablist" aria-label="时间范围">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={range === item.key}
              className={`nori-mp-chip${range === item.key ? ' is-on' : ''}`}
              onClick={() => { setRange(item.key); setData(null) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="nori-mp-empty">
          <p>{error}</p>
          <button type="button" className="fos-btn fos-btn-ghost" onClick={() => void load()}>重试</button>
        </div>
      ) : !data ? (
        <p className="nori-mp-placeholder">加载中…</p>
      ) : empty ? (
        <p className="nori-mp-placeholder">还没有数据，作品上线后每 10 分钟更新一次</p>
      ) : (
        <>
          <div className="nori-mp-kpis">
            {[
              { label: '访问', value: String(data.kpis.views) },
              { label: '开始游玩', value: String(data.kpis.starts) },
              { label: '玩家', value: String(data.kpis.players) },
              { label: '完成率', value: `${(data.kpis.completionRate * 100).toFixed(1)}%` },
              { label: '人均时长', value: `${data.kpis.avgWatchMin} 分钟` },
              { label: '分享', value: String(data.kpis.shares) },
              { label: '新增用户', value: String(data.kpis.newUsers) },
            ].map((kpi) => (
              <div key={kpi.label} className="nori-mp-kpi">
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
              </div>
            ))}
          </div>
          <div className="nori-mp-stat-section">
            <h3>每日玩家</h3>
            <DailyChart daily={data.daily} />
          </div>
          <div className="nori-mp-stat-section">
            <h3>结局分布（累计）</h3>
            {data.endings.length === 0 ? <p className="nori-mp-placeholder">暂无数据</p> : (
              <table className="nori-mp-table">
                <thead><tr><th>结局</th><th>达成人数</th><th>占比</th></tr></thead>
                <tbody>
                  {data.endings.map((ending) => (
                    <tr key={ending.nodeId}>
                      <td>{ending.title || ending.nodeId}</td>
                      <td>{ending.count}</td>
                      <td>{ending.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="nori-mp-stat-section">
            <h3>选择分歧（累计）</h3>
            {data.choices.length === 0 ? <p className="nori-mp-placeholder">暂无数据</p> : data.choices.map((node) => (
              <div key={node.nodeId} className="nori-mp-stat-node">
                <h3>{node.title || node.nodeId}</h3>
                <table className="nori-mp-table">
                  <thead><tr><th>选项</th><th>次数</th><th>占比</th></tr></thead>
                  <tbody>
                    {node.options.map((option) => (
                      <tr key={option.optionId}>
                        <td>{option.label || option.optionId}</td>
                        <td>{option.count}</td>
                        <td>{option.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="nori-mp-stat-section">
            <h3>流失点 Top 10</h3>
            {data.dropoffs.length === 0 ? <p className="nori-mp-placeholder">暂无数据</p> : (
              <table className="nori-mp-table">
                <thead><tr><th>节点</th><th>退出次数</th></tr></thead>
                <tbody>
                  {data.dropoffs.map((dropoff) => (
                    <tr key={dropoff.nodeId}>
                      <td>{dropoff.title || dropoff.nodeId}</td>
                      <td>{dropoff.exits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="nori-mp-stat-section">
            <h3>渠道表现</h3>
            {data.channels.length === 0 ? <p className="nori-mp-placeholder">暂无数据</p> : (
              <table className="nori-mp-table">
                <thead><tr><th>渠道</th><th>新用户</th><th>游玩人数</th></tr></thead>
                <tbody>
                  {data.channels.map((channel) => (
                    <tr key={channel.code}>
                      <td>{channel.name}</td>
                      <td>{channel.newUsers}</td>
                      <td>{channel.players}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}
