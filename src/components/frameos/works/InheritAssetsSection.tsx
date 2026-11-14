'use client'

import { useMemo, useState } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { AppIcon } from '@/components/ui/icons'
import {
  inheritedMaterialSource,
  MATERIAL_ORIGIN_LABELS,
  materialOrigin,
  MAX_INHERITED_MATERIALS,
} from '@/lib/frameos/material-inherit'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { FosFilterSelect } from '../FosFilterSelect'
import type { FrameosMaterialItem } from '../materials/contracts'
import {
  countMaterialOrigins,
  filterInheritableMaterials,
  formatInheritUpdatedAt,
  inheritSourceLabel,
  inheritSourceSelectOptions,
  type InheritMode,
  type InheritOriginFilter,
  type InheritSourceOption,
} from './inherit-sources'
import type { InheritAssetsState } from './useInheritAssets'

const MODE_OPTIONS: ReadonlyArray<{ value: InheritMode; label: string }> = [
  { value: 'none', label: '不继承' },
  { value: 'previous', label: '上一个作品' },
  { value: 'chosen', label: '指定作品' },
]

const ORIGIN_FILTERS: ReadonlyArray<{ key: InheritOriginFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'generated', label: MATERIAL_ORIGIN_LABELS.generated },
  { key: 'uploaded', label: MATERIAL_ORIGIN_LABELS.uploaded },
  { key: 'inherited', label: MATERIAL_ORIGIN_LABELS.inherited },
]

const TYPE_LABELS: Record<FrameosMaterialItem['type'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  model3d: '3D 模型',
}

function InheritThumb({ item }: { item: FrameosMaterialItem }) {
  const src = item.type === 'image' ? toDisplayImageUrl(item.url) : null
  if (src) return <MediaImage src={src} alt="" fill sizes="104px" />
  return (
    <AppIcon
      name={item.type === 'audio' ? 'audioWave' : item.type === 'video' ? 'video' : item.type === 'model3d' ? 'cube' : 'image'}
      aria-hidden="true"
    />
  )
}

function InheritTile({
  item,
  selected,
  blocked,
  onToggle,
}: {
  item: FrameosMaterialItem
  selected: boolean
  blocked: boolean
  onToggle: () => void
}) {
  const origin = materialOrigin(item)
  const from = inheritedMaterialSource(item.metadata)
  const name = item.title || '未命名素材'
  const detail = `${name} · ${TYPE_LABELS[item.type]} · ${MATERIAL_ORIGIN_LABELS[origin]}${from ? `（继承自「${from.projectName}」）` : ''}`
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-disabled={blocked}
      aria-label={detail}
      title={blocked ? `一次最多继承 ${MAX_INHERITED_MATERIALS} 项资产` : detail}
      data-testid="inherit-tile"
      data-origin={origin}
      className={`create-project-inherit-tile${selected ? ' is-selected' : ''}`}
      onClick={() => { if (!blocked) onToggle() }}
    >
      <span className="create-project-inherit-thumb">
        <InheritThumb item={item} />
        <span className="create-project-inherit-check">{selected ? <AppIcon name="check" aria-hidden="true" /> : null}</span>
        <span className={`create-project-inherit-origin is-${origin}`}>{MATERIAL_ORIGIN_LABELS[origin]}</span>
      </span>
      <span className="create-project-inherit-name">{name}</span>
      <span className="create-project-inherit-type">{TYPE_LABELS[item.type]}</span>
    </button>
  )
}

function InheritPicker({
  items,
  selectedIds,
  onToggle,
  onSelectVisible,
  onClearVisible,
}: {
  items: readonly FrameosMaterialItem[]
  selectedIds: readonly string[]
  onToggle: (id: string) => void
  onSelectVisible: (visible: readonly FrameosMaterialItem[]) => void
  onClearVisible: (visible: readonly FrameosMaterialItem[]) => void
}) {
  const [origin, setOrigin] = useState<InheritOriginFilter>('all')
  const [query, setQuery] = useState('')
  const counts = useMemo(() => countMaterialOrigins(items), [items])
  const visible = useMemo(() => filterInheritableMaterials(items, { origin, query }), [items, origin, query])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const atLimit = selectedIds.length >= MAX_INHERITED_MATERIALS
  const visibleSelected = visible.filter((item) => selected.has(item.id)).length

  return (
    <div className="create-project-inherit-picker" data-testid="inherit-picker">
      <div className="create-project-inherit-toolbar">
        <div className="create-project-inherit-chips" role="radiogroup" aria-label="按来源筛选资产">
          {ORIGIN_FILTERS.map((filter) => (
            <button
              type="button"
              role="radio"
              key={filter.key}
              aria-checked={origin === filter.key}
              className={origin === filter.key ? 'is-selected' : ''}
              onClick={() => setOrigin(filter.key)}
            >
              {filter.label}<em>{counts[filter.key]}</em>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="fos-input create-project-inherit-search"
          aria-label="搜索要继承的资产"
          placeholder="搜索资产名称"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
        />
      </div>
      <div className="create-project-inherit-actions">
        <span data-testid="inherit-count">
          已选 {selectedIds.length} / {items.length} 项
          {items.length > MAX_INHERITED_MATERIALS || atLimit ? ` · 一次最多继承 ${MAX_INHERITED_MATERIALS} 项` : ''}
        </span>
        <button
          type="button"
          aria-label="全选当前列表中的资产"
          disabled={visible.length === 0 || visibleSelected === visible.length || atLimit}
          onClick={() => onSelectVisible(visible)}
        >全选</button>
        <button
          type="button"
          aria-label="清空当前列表中已选的资产"
          disabled={visibleSelected === 0}
          onClick={() => onClearVisible(visible)}
        >清空</button>
      </div>
      {visible.length === 0 ? (
        <div className="create-project-inherit-empty">没有符合条件的资产</div>
      ) : (
        <div className="create-project-inherit-grid" role="group" aria-label="可继承的资产">
          {visible.map((item) => {
            const isSelected = selected.has(item.id)
            return (
              <InheritTile
                key={item.id}
                item={item}
                selected={isSelected}
                blocked={atLimit && !isSelected}
                onToggle={() => onToggle(item.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function InheritAssetsSection({
  inherit,
  sources,
}: {
  inherit: InheritAssetsState
  sources: readonly InheritSourceOption[]
}) {
  const selectOptions = useMemo(() => inheritSourceSelectOptions(sources), [sources])
  if (sources.length === 0) return null
  const { mode, previous, sourceProjectId } = inherit
  const previousUpdated = previous ? formatInheritUpdatedAt(previous.updatedAt) : ''

  return (
    <section className="create-project-inherit" data-testid="inherit-assets-section">
      <div className="create-project-pill-group">
        <span>继承资产（可选）</span>
        <div className="create-project-pill-row" role="radiogroup" aria-label="继承资产">
          {MODE_OPTIONS.map((option) => {
            const unavailable = option.value === 'previous' && !previous
            return (
              <button
                type="button"
                role="radio"
                key={option.value}
                aria-checked={mode === option.value}
                disabled={unavailable}
                title={unavailable ? '当前项目还没有可继承的作品' : undefined}
                className={mode === option.value ? 'is-selected' : ''}
                onClick={() => inherit.setMode(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {mode === 'none' ? null : (
        <>
          <p className="create-project-inherit-note">
            把已有作品里的资产复制到新作品，原作品不受影响；继承的资产可以在新作品里重命名、替换或删除。
          </p>
          {mode === 'previous' && previous ? (
            <div className="create-project-inherit-source" data-testid="inherit-previous">
              <AppIcon name="link" aria-hidden="true" />
              <span>上一个作品</span>
              <strong title={inheritSourceLabel(previous)}>{inheritSourceLabel(previous)}</strong>
              {previousUpdated ? <small>最近更新 {previousUpdated}</small> : null}
            </div>
          ) : null}
          {mode === 'chosen' ? (
            <FosFilterSelect
              value={inherit.chosenId}
              placeholder="选择要继承资产的作品（可搜索）"
              ariaLabel="选择要继承资产的作品"
              options={selectOptions}
              searchable
              allowClear={false}
              emptyText="暂无可继承的作品"
              onChange={inherit.setChosenId}
            />
          ) : null}

          {!sourceProjectId ? (
            <div className="create-project-inherit-empty">
              {mode === 'chosen' ? '选择作品后，可勾选要继承的资产。' : '当前项目还没有可继承的作品。'}
            </div>
          ) : inherit.loading ? (
            <div className="create-project-inherit-empty" role="status">
              <AppIcon name="loader" className="animate-spin" aria-hidden="true" />正在读取作品资产…
            </div>
          ) : inherit.error ? (
            <div className="create-project-inherit-empty is-error" role="alert">
              <span>{inherit.error}</span>
              <button type="button" onClick={inherit.retry}>重试</button>
            </div>
          ) : inherit.items.length === 0 ? (
            <div className="create-project-inherit-empty">该作品还没有可继承的资产，仅已完成的共享素材可以继承。</div>
          ) : (
            <InheritPicker
              key={sourceProjectId}
              items={inherit.items}
              selectedIds={inherit.selectedIds}
              onToggle={inherit.toggle}
              onSelectVisible={inherit.selectVisible}
              onClearVisible={inherit.clearVisible}
            />
          )}
        </>
      )}
    </section>
  )
}
