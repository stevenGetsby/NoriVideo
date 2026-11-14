'use client'

import { useState } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { StoryRun } from '@/lib/interactive/engine'
import { snapshotLabel, snapshotRun, storyMap, type StoryMapPoint, type StoryRunSnapshot, type StorySaves } from '@/lib/interactive/saves'
import type { StoryProgram } from '@/lib/interactive/types'
import type { StoryProfile } from '@/lib/interactive/achievements'
import { SheetShell } from './SheetShell'
import { saveTimeText } from './records'
import './records.css'

const POINT_WIDTH = 136
const POINT_HEIGHT = 92
const COLUMN_GAP = 156
const ROW_GAP = 112
const PAD = 16

function saveLabel(program: StoryProgram, snapshot: StoryRunSnapshot): string {
  const place = snapshotLabel(program, snapshot)
  return place ? `${place.chapter} · ${place.node}` : '未知位置'
}

/** A point on the route graph: unlocked save points show their cover and name, locked ones stay grey. */
function MapPoint({ point, x, y, canResume, onResume }: {
  point: StoryMapPoint
  x: number
  y: number
  canResume: boolean
  onResume: () => void
}) {
  const cover = point.unlocked && point.coverUrl ? toDisplayImageUrl(point.coverUrl) || point.coverUrl : null
  return (
    <div
      className={`nori-map-point${point.unlocked ? ' is-unlocked' : ' is-locked'}${point.current ? ' is-current' : ''}`}
      style={{ left: x, top: y, width: POINT_WIDTH, minHeight: POINT_HEIGHT }}
      data-testid="map-point"
      data-point-key={point.key}
      data-unlocked={point.unlocked ? 'true' : 'false'}
      data-current={point.current ? 'true' : 'false'}
      aria-label={`${point.unlocked ? '已解锁' : '未解锁'}保存点：${point.name}`}
    >
      {cover ? <MediaImage src={cover} alt="" className="nori-map-cover" draggable={false} /> : <span className="nori-map-no-cover" aria-hidden="true">{point.unlocked ? '存' : '锁'}</span>}
      <span className="nori-map-name">{point.name || '保存点'}</span>
      {point.current ? <span className="nori-map-current">当前位置</span> : null}
      {point.unlocked && canResume ? (
        <button type="button" className="nori-map-resume" data-testid="map-resume" data-point-key={point.key}
          aria-label={`从保存点「${point.name}」继续`} onClick={onResume}>
          从这里继续
        </button>
      ) : null}
    </div>
  )
}

/**
 * The map and the saves: a solid-colour route graph of the creator's save points with the ones the
 * viewer has reached unlocked, plus the automatic save and three manual slots. Loading anything
 * here replaces the run through restoreRun, which never re-applies a segment's value effects.
 */
export function MapSheet({ program, profile, run, saves, orientation, notice, onResume, onWrite, onLoad, onDelete, onClose }: {
  program: StoryProgram
  profile: StoryProfile
  run: StoryRun
  saves: StorySaves
  orientation: 'portrait' | 'landscape'
  notice?: string | null
  onResume: (snapshot: StoryRunSnapshot) => void
  onWrite: (index: number) => void
  onLoad: (snapshot: StoryRunSnapshot) => void
  onDelete: (index: number) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'map' | 'saves'>('map')
  const view = storyMap(program, profile, run)
  const rows = new Map<number, number>()
  const placed = view.points.map((point) => {
    const row = rows.get(point.rank) ?? 0
    rows.set(point.rank, row + 1)
    return { point, x: PAD + point.rank * COLUMN_GAP, y: PAD + row * ROW_GAP }
  })
  const maxRank = placed.reduce((max, item) => Math.max(max, item.point.rank), 0)
  const maxRows = [...rows.values()].reduce((max, count) => Math.max(max, count), 1)
  const width = PAD * 2 + (maxRank + 1) * COLUMN_GAP - (COLUMN_GAP - POINT_WIDTH)
  const height = PAD * 2 + maxRows * ROW_GAP
  const at = new Map(placed.map((item) => [item.point.key, item]))
  const canSave = snapshotRun(run) !== null
  const auto = saves.auto

  return (
    <SheetShell
      title="地图与存档"
      orientation={orientation}
      testId="map-sheet"
      ariaLabel="地图与存档"
      onClose={onClose}
      head={(
        <div className="nori-records-tabs" role="tablist" aria-label="地图与存档">
          <button type="button" role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'is-on' : ''} data-testid="map-tab-map" onClick={() => setTab('map')}>地图</button>
          <button type="button" role="tab" aria-selected={tab === 'saves'} className={tab === 'saves' ? 'is-on' : ''} data-testid="map-tab-saves" onClick={() => setTab('saves')}>存档</button>
        </div>
      )}
    >
      {notice ? <p className="nori-records-notice" role="status" data-testid="map-notice">{notice}</p> : null}
      {tab === 'map' ? (
        <div className={`nori-records-body is-${orientation}`}>
          {view.points.length === 0 ? <p className="nori-records-empty">这部影游还没有设置存档点。</p> : (
            <div className="nori-map-scroll" data-testid="story-map">
              <div className="nori-map" style={{ width, height }}>
                <svg className="nori-map-routes" width={width} height={height} aria-hidden="true">
                  {view.routes.map((route) => {
                    const from = at.get(route.from)
                    const to = at.get(route.to)
                    if (!from || !to) return null
                    return (
                      <line key={`${route.from}->${route.to}`} data-testid="map-route" data-lit={route.lit ? 'true' : 'false'}
                        className={route.lit ? 'is-lit' : ''}
                        x1={from.x + POINT_WIDTH} y1={from.y + POINT_HEIGHT / 2}
                        x2={to.x} y2={to.y + POINT_HEIGHT / 2} />
                    )
                  })}
                </svg>
                {placed.map(({ point, x, y }) => (
                  <MapPoint key={point.key} point={point} x={x} y={y}
                    canResume={Boolean(saves.checkpoints[point.key])}
                    onResume={() => {
                      const slot = saves.checkpoints[point.key]
                      if (slot) onResume(slot.snapshot)
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={`nori-records-body is-${orientation}`} data-testid="save-panel">
          <section className="nori-records-section" aria-label="自动存档">
            <h4>自动存档</h4>
            <div className="nori-save-slot is-auto" data-testid="save-auto" data-filled={auto ? 'true' : 'false'}>
              <div className="nori-save-info">
                <strong>自动存档</strong>
                <span>{auto ? saveLabel(program, auto.snapshot) : '还没有自动存档'}</span>
                <small>{auto ? saveTimeText(auto.savedAt) : '到达可继续的剧情时会自动保存'}</small>
              </div>
              <div className="nori-save-actions">
                <button type="button" className="nori-save-btn" data-testid="auto-load" disabled={!auto}
                  aria-label="读取自动存档" onClick={() => auto && onLoad(auto.snapshot)}>读取</button>
              </div>
            </div>
          </section>
          <section className="nori-records-section" aria-label="手动存档">
            <h4>手动存档</h4>
            <ul className="nori-save-list">
              {saves.slots.map((slot, index) => (
                <li key={index} className="nori-save-slot" data-testid={`save-slot-${index}`} data-filled={slot ? 'true' : 'false'}>
                  <div className="nori-save-info">
                    <strong>存档位 {index + 1}</strong>
                    <span>{slot ? saveLabel(program, slot.snapshot) : '空存档位'}</span>
                    <small>{slot ? saveTimeText(slot.savedAt) : '随时保存当前进度'}</small>
                  </div>
                  <div className="nori-save-actions">
                    <button type="button" className="nori-save-btn is-primary" data-testid={`save-write-${index}`} disabled={!canSave}
                      aria-label={`保存到存档位 ${index + 1}`} onClick={() => onWrite(index)}>存档</button>
                    <button type="button" className="nori-save-btn" data-testid={`save-load-${index}`} disabled={!slot}
                      aria-label={`读取存档位 ${index + 1}`} onClick={() => slot && onLoad(slot.snapshot)}>读取</button>
                    <button type="button" className="nori-save-btn is-danger" data-testid={`save-delete-${index}`} disabled={!slot}
                      aria-label={`删除存档位 ${index + 1}`} onClick={() => onDelete(index)}>删除</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </SheetShell>
  )
}
