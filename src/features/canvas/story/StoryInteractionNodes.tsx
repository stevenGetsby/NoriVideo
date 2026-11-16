'use client'

import { memo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore, type NodeProps } from '@xyflow/react'
import { MediaImage } from '@/components/media/MediaImage'
import { AlertTriangle, Plus, X } from '@/components/ui/icons'
import {
  beatWindowsOverlap,
  clampBeatStart,
  hasRandomResults,
  interactionHandleLabel,
  interactionHandles,
  readInteractionData,
  STORY_DURING_LABEL,
  STORY_INTERACTION_DEFAULT_HINT,
  STORY_INTERACTION_LABEL,
  STORY_SWIPE_LABEL,
} from '@/lib/interactive/interaction'
import {
  STORY_BEAT_DURINGS,
  STORY_INTERACTION_KINDS,
  STORY_MOUNT_ROLE,
  STORY_SWIPE_DIRECTIONS,
  type StoryHotspotZone,
  type StoryInteractionSpec,
  type StoryResultConfig,
} from '@/lib/interactive/types'
import type { CanvasFlowEdge, CanvasFlowNode, CanvasFlowNodeData } from '../editor-types'
import { useHandleSync } from './StoryBranchNodes'
import { StoryChoicePanelFields } from './StoryChoicePanelFields'
import { StoryEffectsEditor } from './StoryFields'
import { StoryImageField } from './StoryImageField'
import { StoryHandle, StoryNodeShell, useStoryNodeEditing } from './StoryNodeShell'
import { mountedBeats, sceneVideoDurationSec, type SceneBeat } from './story-beats'
import { toDisplayImageUrl } from '@/lib/media/image-url'

const SWIPE_ARROW = { up: '↑', down: '↓', left: '←', right: '→' } as const
const DEFAULT_RESULT: StoryResultConfig = { effects: [], when: 'now', retry: false }
const bounded = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rounded = (value: number, min: number, max: number) => Math.round(bounded(value, min, max))
const tenths = (value: number) => Math.round(value * 10) / 10

function NumberField({ label, value, min, max, step = 1, disabled, testId, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  testId?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="nori-story-field">
      <span>{label}</span>
      <input
        className="nodrag nori-story-input is-number"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        readOnly={disabled}
        data-testid={testId}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

function TextField({ label, value, placeholder, disabled, onChange }: {
  label: string
  value: string
  placeholder?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="nori-story-field">
      <span>{label}</span>
      <input
        className="nodrag nori-story-input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

import { dragHotspotZone, type HotspotDragHandle } from '@/lib/interactive/hotspot'

function WeightField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (weight?: number) => void }) {
  return (
    <label className="nori-story-weight is-inline">
      <span>权重</span>
      <input className="nodrag nori-story-input is-number" type="number" min={0} max={999} step={1} value={value} disabled={disabled} aria-label={`${label}随机权重`} onChange={(event) => {
        const weight = Math.max(0, Math.min(999, event.target.valueAsNumber || 0))
        onChange(weight > 0 ? weight : undefined)
      }} />
    </label>
  )
}

function HotspotEditor({ spec, workId, readOnly, orientation, onChange, onRemove }: {
  spec: Extract<StoryInteractionSpec, { type: 'hotspot' }>
  workId: string | null
  readOnly: boolean
  orientation: 'portrait' | 'landscape'
  onChange: (patch: Record<string, unknown>, label?: string) => void
  onRemove: (zoneId: string) => Promise<boolean>
}) {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; handle: HotspotDragHandle; zone: StoryHotspotZone; x: number; y: number } | null>(null)
  const move = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    const preview = previewRef.current
    if (!drag || !preview) return
    const rect = preview.getBoundingClientRect()
    const zone = dragHotspotZone(drag.zone, (event.clientX - drag.x) / rect.width, (event.clientY - drag.y) / rect.height, drag.handle)
    onChange({ zones: spec.zones.map((item) => item.id === zone.id ? zone : item) })
  }
  const commitDrag = () => {
    if (dragRef.current) onChange({}, '调整热区')
    dragRef.current = null
  }
  return (
    <>
      <StoryImageField label="背景帧" value={spec.frameImageUrl} workId={workId} readOnly={readOnly} onChange={(frameImageUrl) => onChange({ frameImageUrl }, '更换热区背景帧')} />
      <button type="button" className={`nori-story-chip nodrag${spec.showZones ? ' is-active' : ''}`} aria-pressed={spec.showZones} disabled={readOnly} onClick={() => onChange({ showZones: !spec.showZones }, '设置热区可见性')}>向观众显示热区</button>
      <div ref={previewRef} className="nori-hotspot-editor nodrag nopan" style={{ aspectRatio: orientation === 'landscape' ? '16 / 9' : '9 / 16' }} data-testid="hotspot-editor">
        {spec.frameImageUrl ? <MediaImage src={toDisplayImageUrl(spec.frameImageUrl) || spec.frameImageUrl} alt="" fill sizes="260px" draggable={false} /> : null}
        {spec.zones.map((zone) => (
          <div key={zone.id} className="nori-hotspot-editor-zone" data-zone-id={zone.id} style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` } as CSSProperties}>
            <button type="button" className="nori-hotspot-editor-move" aria-label={`移动${zone.label || '热区'}`} disabled={readOnly} onPointerDown={(event) => {
              if (readOnly) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = { id: zone.id, handle: 'move', zone, x: event.clientX, y: event.clientY }
            }} onPointerMove={move} onPointerUp={commitDrag} onPointerCancel={commitDrag} />
            {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => <button key={handle} type="button" className={`nori-hotspot-editor-resize is-${handle}`} aria-label={`缩放${zone.label || '热区'}${handle}`} disabled={readOnly} onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = { id: zone.id, handle, zone, x: event.clientX, y: event.clientY }
            }} onPointerMove={move} onPointerUp={commitDrag} onPointerCancel={commitDrag} />)}
          </div>
        ))}
      </div>
      <ol className="nori-hotspot-editor-list">
        {spec.zones.map((zone) => <li key={zone.id}><input className="nodrag nori-story-input" aria-label="热区名称" value={zone.label} readOnly={readOnly} onChange={(event) => onChange({ zones: spec.zones.map((item) => item.id === zone.id ? { ...item, label: event.target.value } : item) })} /><button type="button" className="nori-story-icon-button nodrag" aria-label={`删除热区${zone.label}`} disabled={readOnly} onClick={() => void onRemove(zone.id)}><X /></button></li>)}
      </ol>
      <button type="button" className="nori-story-add-rule nodrag" disabled={readOnly} onClick={() => onChange({ zones: [...spec.zones, { id: `opt_${crypto.randomUUID().slice(0, 8)}`, label: `线索${['一', '二', '三', '四', '五', '六'][spec.zones.length] ?? spec.zones.length + 1}`, x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] }, '添加热区')}><Plus />热区</button>
    </>
  )
}

export const StoryInteractionNode = memo(function StoryInteractionNode({ id, data, selected }: NodeProps) {
  const { readOnly, variables, manageVariables, story, patch } = useStoryNodeEditing(id)
  const interaction = readInteractionData(data)
  const spec = interaction.spec
  const [openEffects, setOpenEffects] = useState<string | null>(null)
  useHandleSync(id, `${spec.type}:${interactionHandles(spec).join('|')}`)

  const mountKey = useStore((state) => {
    const edge = state.edges.find((item) => item.target === id && item.data?.role === STORY_MOUNT_ROLE)
    if (!edge) return ''
    const scene = state.nodeLookup.get(edge.source)
    const title = typeof scene?.data?.title === 'string' ? scene.data.title.trim() : ''
    return JSON.stringify({ sceneId: edge.source, sceneTitle: title })
  })
  const mount = mountKey ? JSON.parse(mountKey) as { sceneId: string; sceneTitle: string } : null

  // Reduced to the scene's own wires so moving unrelated cards does not re-render this one.
  const sceneTimelineKey = useStore((state) => {
    if (!mount) return ''
    const sceneId = mount.sceneId
    const sceneEdges = state.edges.filter((edge) => edge.source === sceneId || edge.target === sceneId)
    const ids = new Set<string>([sceneId])
    for (const edge of sceneEdges) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    const nodes: Array<Pick<CanvasFlowNode, 'id' | 'type' | 'data'>> = []
    for (const nodeId of ids) {
      const node = state.nodeLookup.get(nodeId)
      if (node) nodes.push({ id: node.id, type: node.type ?? '', data: node.data as CanvasFlowNodeData })
    }
    const edges: Array<Pick<CanvasFlowEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'data'>> = sceneEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      data: edge.data as CanvasFlowEdge['data'],
    }))
    return JSON.stringify({
      beats: mountedBeats(sceneId, nodes, edges).filter((beat) => beat.nodeId !== id),
      videoSec: sceneVideoDurationSec(sceneId, nodes, edges),
    })
  })
  const sceneTimeline = sceneTimelineKey
    ? JSON.parse(sceneTimelineKey) as { beats: SceneBeat[]; videoSec: number | null }
    : { beats: [] as SceneBeat[], videoSec: null as number | null }
  const videoSec = sceneTimeline.videoSec
  const neighbouringBeats = sceneTimeline.beats
  const outsideVideo = Boolean(mount) && videoSec != null && interaction.startSec + interaction.durationSec > videoSec + 0.001
  const overlappingBeat = mount ? neighbouringBeats.find((beat) => beatWindowsOverlap(interaction, beat)) : undefined
  const orientation = story?.story.aspectRatio === '16:9' ? 'landscape' as const : 'portrait' as const
  const workId = story?.story.workId ?? null

  const updateResult = (handle: string, next: Partial<StoryResultConfig>, label?: string) => {
    const current = interaction.results[handle] ?? DEFAULT_RESULT
    patch({ results: { ...interaction.results, [handle]: { ...current, ...next } } }, label)
  }
  const setDuration = (raw: number, label: string) => {
    const durationSec = tenths(bounded(raw, 0.5, 120))
    patch({ durationSec, startSec: clampBeatStart(interaction.startSec, durationSec, videoSec) }, label)
  }

  return (
    <StoryNodeShell
      id={id} type="story_interaction" selected={selected} title={interaction.title} mount
      badge={story ? (
        <select
          className="nodrag nori-story-select nori-story-kind-select"
          aria-label="互动类型"
          value={spec.type}
          disabled={readOnly}
          onChange={(event) => {
            const next = event.target.value
            if (STORY_INTERACTION_KINDS.includes(next as (typeof STORY_INTERACTION_KINDS)[number])) {
              void story.actions.retargetInteraction(id, next as (typeof STORY_INTERACTION_KINDS)[number])
            }
          }}
        >
          {STORY_INTERACTION_KINDS.map((kind) => <option key={kind} value={kind}>{STORY_INTERACTION_LABEL[kind]}</option>)}
        </select>
      ) : undefined}
    >
      {hasRandomResults(interaction.results) ? <span className="nori-story-random-badge" data-testid="random-badge">随机</span> : null}
      <div className={`nori-story-status${mount ? ' is-mounted' : ''}`}>
        <span className="nori-story-status-dot" aria-hidden="true" />
        <span>{mount ? `挂在「${mount.sceneTitle || '剧情片段'}」` : '未挂载：接在上一步之后，上一步结束时触发'}</span>
      </div>

      {mount ? (
        <div className="nori-story-field-grid">
          <NumberField
            label="开始（秒）" testId="interaction-start"
            value={interaction.startSec} min={0} max={videoSec ?? 3600} step={0.1} disabled={readOnly}
            onChange={(value) => patch({ startSec: clampBeatStart(value, interaction.durationSec, videoSec) })}
          />
          <NumberField
            label="时长（秒）" testId="interaction-duration"
            value={interaction.durationSec} min={0.5} max={120} step={0.1} disabled={readOnly}
            onChange={(value) => setDuration(value, '调整互动时长')}
          />
        </div>
      ) : (
        <div className="nori-story-field-grid">
          <NumberField
            label="限时（秒）" testId="interaction-duration"
            value={interaction.durationSec} min={0.5} max={120} step={0.1} disabled={readOnly}
            onChange={(value) => setDuration(value, '调整互动限时')}
          />
        </div>
      )}
      {mount && videoSec == null ? <p className="nori-story-note">视频时长未知，按秒数手动填写</p> : null}
      {outsideVideo ? <p className="nori-story-warning"><AlertTriangle />超出视频时长</p> : null}
      {overlappingBeat ? <p className="nori-story-warning"><AlertTriangle />与「{overlappingBeat.title}」重叠</p> : null}

      <div className="nori-story-segmented is-three nodrag" role="radiogroup" aria-label="互动时画面">
        {STORY_BEAT_DURINGS.map((during) => (
          <button
            key={during}
            type="button"
            role="radio"
            aria-checked={interaction.during === during}
            className={interaction.during === during ? 'is-active' : ''}
            disabled={readOnly}
            onClick={() => patch({ during }, '设置互动画面')}
          >
            {STORY_DURING_LABEL[during].replace('画面', '')}
          </button>
        ))}
      </div>

      {spec.type === 'tap' ? (
        <>
          <div className="nori-story-field-grid">
            <NumberField
              label="次数" testId="interaction-count"
              value={spec.count} min={1} max={99} disabled={readOnly}
              onChange={(value) => patch({ count: rounded(value, 1, 99) }, '设置点击次数')}
            />
          </div>
          <TextField label="按钮文字" value={spec.buttonText} placeholder="不填则用点击图标" disabled={readOnly}
            onChange={(buttonText) => patch({ buttonText })} />
          <StoryImageField label="按钮图片" value={spec.buttonImageUrl} workId={workId} readOnly={readOnly}
            onChange={(buttonImageUrl) => patch({ buttonImageUrl }, '更换按钮图片')} />
        </>
      ) : null}

      {spec.type === 'swipe' ? (
        <>
          <div className="nori-story-direction nodrag" role="radiogroup" aria-label="滑动方向">
            {STORY_SWIPE_DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                role="radio"
                aria-checked={spec.direction === direction}
                aria-label={STORY_SWIPE_LABEL[direction]}
                title={STORY_SWIPE_LABEL[direction]}
                className={spec.direction === direction ? 'is-active' : ''}
                disabled={readOnly}
                onClick={() => patch({ direction }, '设置滑动方向')}
              >
                {SWIPE_ARROW[direction]}
              </button>
            ))}
          </div>
          <TextField label="按钮文字" value={spec.buttonText} placeholder="不填则用箭头图标" disabled={readOnly}
            onChange={(buttonText) => patch({ buttonText })} />
          <StoryImageField label="按钮图片" value={spec.buttonImageUrl} workId={workId} readOnly={readOnly}
            onChange={(buttonImageUrl) => patch({ buttonImageUrl }, '更换按钮图片')} />
        </>
      ) : null}

      {spec.type === 'timing' ? (
        <>
          <StoryImageField label="道具图片" value={spec.propImageUrl} workId={workId} readOnly={readOnly}
            onChange={(propImageUrl) => patch({ propImageUrl }, '更换道具图片')} />
          <div className="nori-story-field-grid is-three">
            <NumberField
              label="指针速度" value={spec.speed} min={0.25} max={4} step={0.25} disabled={readOnly}
              onChange={(value) => patch({ speed: Math.round(bounded(value, 0.25, 4) * 100) / 100 }, '设置指针速度')}
            />
            <NumberField
              label="完美区（%）" value={spec.perfectWidth} min={2} max={50} disabled={readOnly}
              onChange={(value) => {
                const perfectWidth = rounded(value, 2, 50)
                patch({ perfectWidth, ...(perfectWidth > spec.normalWidth ? { normalWidth: perfectWidth } : {}) }, '设置完美区')
              }}
            />
            <NumberField
              label="普通区（%）" value={spec.normalWidth} min={4} max={90} disabled={readOnly}
              onChange={(value) => patch({ normalWidth: rounded(Math.max(spec.perfectWidth, value), 4, 90) }, '设置普通区')}
            />
          </div>
        </>
      ) : null}

      {spec.type === 'hold' ? (
        <>
          <div className="nori-story-field-grid is-three">
            <NumberField
              label="蓄力时长（秒）" value={spec.fillSec} min={0.5} max={20} step={0.1} disabled={readOnly}
              onChange={(value) => patch({ fillSec: tenths(bounded(value, 0.5, 20)) }, '设置蓄力时长')}
            />
            <NumberField
              label="松手最小（%）" value={spec.rangeMin} min={0} max={100} disabled={readOnly}
              onChange={(value) => {
                const rangeMin = rounded(value, 0, 100)
                patch({ rangeMin, rangeMax: Math.max(rangeMin, spec.rangeMax) }, '设置松手区间')
              }}
            />
            <NumberField
              label="松手最大（%）" value={spec.rangeMax} min={0} max={100} disabled={readOnly}
              onChange={(value) => {
                const rangeMax = rounded(value, 0, 100)
                patch({ rangeMax, rangeMin: Math.min(rangeMax, spec.rangeMin) }, '设置松手区间')
              }}
            />
          </div>
          <button
            type="button"
            className={`nori-story-chip nodrag${spec.overchargeFails ? ' is-active' : ''}`}
            aria-pressed={spec.overchargeFails}
            disabled={readOnly}
            onClick={() => patch({ overchargeFails: !spec.overchargeFails }, '设置过量失败')}
          >
            过量失败
          </button>
          <TextField label="按钮文字" value={spec.buttonText} placeholder="不填则用长按图标" disabled={readOnly}
            onChange={(buttonText) => patch({ buttonText })} />
          <StoryImageField label="按钮图片" value={spec.buttonImageUrl} workId={workId} readOnly={readOnly}
            onChange={(buttonImageUrl) => patch({ buttonImageUrl }, '更换按钮图片')} />
        </>
      ) : null}

      {spec.type === 'hotspot' ? <HotspotEditor spec={spec} workId={workId} readOnly={readOnly} orientation={orientation} onChange={patch} onRemove={(zoneId) => story?.actions.removeInteractionHandle(id, zoneId) ?? Promise.resolve(false)} /> : null}

      {spec.type === 'choice' ? (
        <StoryChoicePanelFields
          data={data}
          mode="interaction"
          mounted={Boolean(mount)}
          disabled={readOnly}
          variables={variables}
          manageVariables={manageVariables}
          shop={story?.story.config.shop}
          personalityEnabled={story?.story.config.personality?.enabled === true}
          onOpenGameplay={story && !readOnly ? () => story.setPanel('gameplay') : undefined}
          workId={workId}
          orientation={orientation}
          onRemoveOption={story && !readOnly ? (optionId) => story.actions.removeInteractionHandle(id, optionId) : undefined}
          patch={patch}
          onDurationChange={(durationSec) => setDuration(durationSec, '设置互动时长')}
        />
      ) : null}

      <TextField label="提示文字" value={interaction.hint} placeholder={STORY_INTERACTION_DEFAULT_HINT[spec.type]} disabled={readOnly}
        onChange={(hint) => patch({ hint })} />

      {spec.type === 'choice' ? null : (
        <ol className="nori-story-options nori-story-results">
          {interactionHandles(spec).map((handle) => {
            const result = interaction.results[handle] ?? DEFAULT_RESULT
            const label = interactionHandleLabel(spec, handle)
            return (
              <li key={handle} className="nori-story-option is-result">
                <div className="nori-story-row">
                  <span className="nori-story-result-label">{label}</span>
                  <button
                    type="button"
                    className={`nori-story-chip nodrag${result.effects.length ? ' is-active' : ''}`}
                    aria-expanded={openEffects === handle}
                    onClick={() => setOpenEffects((current) => (current === handle ? null : handle))}
                  >
                    效果{result.effects.length ? ` ${result.effects.length}` : ''}
                  </button>
                  {mount ? (
                    <select
                      className="nodrag nori-story-select"
                      aria-label={`${label}切换时机`}
                      value={result.when}
                      disabled={readOnly}
                      onChange={(event) => updateResult(handle, { when: event.target.value === 'after' ? 'after' : 'now' }, '设置结果切换时机')}
                    >
                      <option value="now">立即切</option>
                      <option value="after">本段播完再切</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    className={`nori-story-chip nodrag${result.retry ? ' is-active is-retry' : ''}`}
                    aria-pressed={result.retry}
                    disabled={readOnly}
                    title="失败后回到互动前 2 秒重来"
                    onClick={() => updateResult(handle, { retry: !result.retry }, '设置失败重来')}
                  >
                    失败重来
                  </button>
                  <WeightField label={label} value={result.weight ?? 0} disabled={readOnly} onChange={(weight) => updateResult(handle, { weight }, '设置随机权重')} />
                  <StoryHandle id={handle} side="out" />
                </div>
                {openEffects === handle ? (
                  <StoryEffectsEditor
                    effects={result.effects}
                    variables={variables}
                    disabled={readOnly}
                    onManageVariables={manageVariables}
                    onChange={(effects) => updateResult(handle, { effects }, '编辑结果效果')}
                  />
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </StoryNodeShell>
  )
})
