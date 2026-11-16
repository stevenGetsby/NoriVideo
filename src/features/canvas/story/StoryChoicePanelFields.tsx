'use client'

import { useState } from 'react'
import { Plus, X } from '@/components/ui/icons'
import { ChoicePanel } from '@/features/interactive/ChoicePanel'
import { readChoiceData } from '@/lib/interactive/compile'
import {
  readInteractionData,
  STORY_CHOICE_COUNTDOWNS,
  STORY_MOUNTED_CHOICE_MAX_OPTIONS,
} from '@/lib/interactive/interaction'
import {
  STORY_CHOICE_LAYOUTS,
  STORY_CHOICE_PANELS,
  STORY_PERSONALITY_AXES,
  STORY_TIMEOUT_HANDLE,
  STORY_TIMEOUT_MODES,
  type StoryChoiceLayout,
  type StoryChoiceOption,
  type StoryChoicePanel,
  type StoryOptionUnlock,
  type StoryPersonalityTag,
  type StoryResultConfig,
  type StoryShop,
  type StoryTimeoutMode,
  type StoryVariable,
} from '@/lib/interactive/types'
import { everyOptionGated, newOptionUnlock, togglePersonalityTag, withOptionTags, withOptionUnlock } from '@/features/interactive/gameplay-edit'
import { StoryEffectsEditor } from './StoryFields'
import { StoryOptionUnlockEditor } from './StoryOptionUnlockEditor'
import { addChoiceOption, removeChoiceOption, choiceCountdownOptions, choiceOrdinal, STANDALONE_CHOICE_MAX_OPTIONS } from './story-choice-edit'
import { StoryImageField } from './StoryImageField'
import { StoryHandle } from './StoryNodeShell'

const PANEL_LABEL: Record<StoryChoicePanel, string> = { text: '文字', image: '图片', both: '图文' }
const LAYOUT_LABEL: Record<StoryChoiceLayout, string> = { auto: '自动', horizontal: '左右', vertical: '上下' }
const TIMEOUT_MODE_LABEL: Record<StoryTimeoutMode, string> = { default: '默认选项', exit: '单独出口' }
const DEFAULT_RESULT: StoryResultConfig = { effects: [], when: 'now', retry: false }
const newOptionId = () => `opt_${crypto.randomUUID().slice(0, 8)}`

type ChoiceFieldsMode = 'choice' | 'interaction'

/**
 * The shared choice editor: the standalone 选择 node and a mounted 限时抉择 interaction write the
 * same keys (prompt / options / panelStyle / layout / timeoutMode), so both use this component.
 * The mounted variant stores its countdown in `durationSec` and gives every option its own
 * cut / retry settings; the standalone one uses `timeoutSec`.
 */
export function StoryChoicePanelFields({ data, mode, mounted = false, disabled, variables, manageVariables, shop, personalityEnabled = false, onOpenGameplay, workId, orientation, onDurationChange, onRemoveOption, patch }: {
  data: Record<string, unknown>
  mode: ChoiceFieldsMode
  /** True when the interaction is hung on a scene's timeline. */
  mounted?: boolean
  disabled: boolean
  variables: StoryVariable[]
  manageVariables?: () => void
  /** The story's shop, so a locked option can point at one of its items. */
  shop?: StoryShop
  /** Shows the personality letter chips on every option once the test is on. */
  personalityEnabled?: boolean
  onOpenGameplay?: () => void
  workId: string | null
  orientation: 'portrait' | 'landscape'
  /** The mounted interaction re-clamps its start when its length grows. */
  onDurationChange?: (durationSec: number) => void
  onRemoveOption?: (optionId: string) => Promise<boolean>
  patch: (patch: Record<string, unknown>, label?: string) => void
}) {
  const choice = readChoiceData(data)
  const interaction = mode === 'interaction' ? readInteractionData(data) : null
  const minOptions = mode === 'interaction' ? 2 : 1
  const maxOptions = mode === 'interaction' ? STORY_MOUNTED_CHOICE_MAX_OPTIONS : STANDALONE_CHOICE_MAX_OPTIONS
  const countdown = mode === 'interaction' ? interaction?.durationSec ?? 3 : choice.timeoutSec
  const countdownOptions = choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, countdown, { unlimited: mode === 'choice' })
  const timeoutResult = interaction ? interaction.results[STORY_TIMEOUT_HANDLE] ?? DEFAULT_RESULT : null
  const [openEffects, setOpenEffects] = useState<string | null>(null)
  const [openUnlock, setOpenUnlock] = useState<string | null>(null)

  const updateOptions = (options: StoryChoiceOption[], label: string, extra: Record<string, unknown> = {}) =>
    patch({ options, ...extra }, label)
  const updateOption = (optionId: string, next: Partial<StoryChoiceOption>, label?: string) => {
    const options = choice.options.map((option) => (option.id === optionId ? { ...option, ...next } : option))
    patch({ options }, label)
  }
  /** The unlock key must vanish when cleared, so it gets its own option writer. */
  const updateUnlock = (optionId: string, unlock: StoryOptionUnlock | null) => {
    const options = choice.options.map((option) => (option.id === optionId ? withOptionUnlock(option, unlock) : option))
    patch({ options }, '编辑解锁条件')
  }
  /** Same rule for tags: an empty selection removes the key instead of writing `tags: []`. */
  const updateTags = (optionId: string, tags: StoryPersonalityTag[]) => {
    const options = choice.options.map((option) => (option.id === optionId ? withOptionTags(option, tags) : option))
    patch({ options }, '设置人格标签')
  }
  const toggleUnlock = (option: StoryChoiceOption) => {
    const open = openUnlock === option.id
    setOpenEffects(null)
    setOpenUnlock(open ? null : option.id)
    // Opening the editor creates the rule; read-only may still inspect an existing one.
    if (!disabled && !open && !option.unlock) {
      const rule = newOptionUnlock(variables)
      if (rule) updateOption(option.id, { unlock: rule }, '编辑解锁条件')
    }
  }
  const deleteOption = async (optionId: string) => {
    if (onRemoveOption) {
      await onRemoveOption(optionId)
      return
    }
    const next = removeChoiceOption(choice.options, optionId, choice.defaultOptionId, minOptions)
    if (next.options === choice.options) return
    updateOptions(next.options, '删除选项', next.defaultOptionId !== choice.defaultOptionId ? { defaultOptionId: next.defaultOptionId } : {})
  }
  const appendOption = () => {
    const next = addChoiceOption(choice.options, newOptionId(), maxOptions)
    if (next === choice.options) return
    updateOptions(next, '添加选项')
  }
  const setCountdown = (value: number) => {
    if (mode === 'interaction') {
      if (onDurationChange) onDurationChange(value)
      else patch({ durationSec: value }, '设置互动时长')
      return
    }
    patch({ timeoutSec: value > 0 ? value : null }, '设置选择限时')
  }
  const updateTimeoutResult = (next: Partial<StoryResultConfig>, label?: string) => {
    if (!interaction || !timeoutResult) return
    patch({ results: { ...interaction.results, [STORY_TIMEOUT_HANDLE]: { ...timeoutResult, ...next } } }, label)
  }

  return (
    <>
      <input
        className="nodrag nori-story-input"
        value={choice.prompt}
        placeholder={mode === 'interaction' ? '抉择问题（可选）' : '向玩家提问（可选）'}
        readOnly={disabled}
        onChange={(event) => patch({ prompt: event.target.value })}
      />
      <ol className="nori-story-options">
        {choice.options.map((option, index) => (
          <li key={option.id} className="nori-story-option is-choice-option">
            <div className="nori-story-row">
              <span className="nori-story-row-index">{index + 1}</span>
              <input
                className="nodrag nori-story-input"
                value={option.label}
                placeholder={`选项${choiceOrdinal(index)}`}
                readOnly={disabled}
                onChange={(event) => updateOption(option.id, { label: event.target.value })}
              />
              {choice.panelStyle !== 'text' ? (
                <StoryImageField
                  compact
                  label="选项图片"
                  value={option.imageUrl}
                  workId={workId}
                  readOnly={disabled}
                  onChange={(imageUrl) => updateOption(option.id, { imageUrl }, '更换选项图片')}
                />
              ) : null}
              <button
                type="button"
                className={`nori-story-chip nodrag${option.effects.length ? ' is-active' : ''}`}
                aria-expanded={openEffects === option.id}
                onClick={() => {
                  setOpenUnlock(null)
                  setOpenEffects((current) => (current === option.id ? null : option.id))
                }}
              >
                效果{option.effects.length ? ` ${option.effects.length}` : ''}
              </button>
              <button
                type="button"
                className={`nori-story-chip nodrag${option.unlock ? ' is-active' : ''}`}
                aria-expanded={openUnlock === option.id}
                onClick={() => toggleUnlock(option)}
              >
                解锁条件{option.unlock ? ` ${option.unlock.conditions.length}` : ''}
              </button>
              {disabled || choice.options.length <= minOptions ? null : (
                <button type="button" className="nori-story-icon-button nodrag" aria-label="删除选项" onClick={() => void deleteOption(option.id)}><X /></button>
              )}
              <StoryHandle id={option.id} side="out" />
            </div>
            {mode === 'interaction' ? <label className="nori-story-weight">
              <span>权重</span>
              <input className="nodrag nori-story-input is-number" type="number" min={0} max={999} step={1} value={option.weight ?? 0} disabled={disabled} aria-label={`选项${index + 1}随机权重`} onChange={(event) => {
                const weight = Math.max(0, Math.min(999, event.target.valueAsNumber || 0))
                updateOption(option.id, weight > 0 ? { weight } : { weight: undefined }, '设置随机权重')
              }} />
              <span>大于 0 参与随机</span>
            </label> : null}
            {personalityEnabled || option.tags?.length ? (
              <div className="nori-story-tag-chips nodrag" role="group" aria-label={`选项${index + 1}人格标签`}>
                {STORY_PERSONALITY_AXES.map(([left, right]) => (
                  <span key={left} className="nori-story-tag-pair">
                    {[left, right].map((tag) => {
                      const active = option.tags?.includes(tag) ?? false
                      return (
                        <button
                          key={tag}
                          type="button"
                          className={`nori-story-tag-chip nodrag${active ? ' is-active' : ''}`}
                          aria-pressed={active}
                          aria-label={`人格标签 ${tag}`}
                          disabled={disabled}
                          onClick={() => updateTags(option.id, togglePersonalityTag(option.tags, tag))}
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </span>
                ))}
              </div>
            ) : null}
            {mounted ? (
              <div className="nori-story-option-meta">
                <select
                  className="nodrag nori-story-select"
                  aria-label="选项切换时机"
                  value={option.when}
                  disabled={disabled}
                  onChange={(event) => updateOption(option.id, { when: event.target.value === 'after' ? 'after' : 'now' }, '设置选项切换时机')}
                >
                  <option value="now">立即切</option>
                  <option value="after">本段播完再切</option>
                </select>
                <button
                  type="button"
                  className={`nori-story-chip nodrag${option.retry ? ' is-active is-retry' : ''}`}
                  aria-pressed={option.retry}
                  disabled={disabled}
                  title="失败后回到互动前 2 秒重来"
                  onClick={() => updateOption(option.id, { retry: !option.retry }, '设置失败重来')}
                >
                  失败重来
                </button>
              </div>
            ) : null}
            {openEffects === option.id ? (
              <StoryEffectsEditor
                effects={option.effects}
                variables={variables}
                disabled={disabled}
                onManageVariables={manageVariables}
                onChange={(effects) => updateOption(option.id, { effects }, '编辑选项效果')}
              />
            ) : null}
            {openUnlock === option.id ? (
              <StoryOptionUnlockEditor
                unlock={option.unlock}
                variables={variables}
                shop={shop}
                disabled={disabled}
                onManageVariables={manageVariables}
                onOpenGameplay={onOpenGameplay}
                onChange={(unlock) => updateUnlock(option.id, unlock)}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {everyOptionGated(choice.options) ? (
        <p className="nori-story-note nori-ix-warning">每个选项都有解锁条件，条件都不满足时观众会无路可选。请至少留一个始终可选的选项。</p>
      ) : null}
      {disabled || choice.options.length >= maxOptions ? null : (
        <button type="button" className="nori-story-add-rule nodrag" onClick={appendOption}><Plus />选项</button>
      )}

      <div className="nori-story-footer">
        <label>
          <span>样式</span>
          <select
            className="nodrag"
            data-testid="choice-style"
            value={choice.panelStyle}
            disabled={disabled}
            onChange={(event) => patch({ panelStyle: event.target.value as StoryChoicePanel }, '设置抉择样式')}
          >
            {STORY_CHOICE_PANELS.map((panel) => <option key={panel} value={panel}>{PANEL_LABEL[panel]}</option>)}
          </select>
        </label>
        <label>
          <span>排版</span>
          <select
            className="nodrag"
            data-testid="choice-layout"
            value={choice.layout}
            disabled={disabled}
            onChange={(event) => patch({ layout: event.target.value as StoryChoiceLayout }, '设置抉择排版')}
          >
            {STORY_CHOICE_LAYOUTS.map((layout) => <option key={layout} value={layout}>{LAYOUT_LABEL[layout]}</option>)}
          </select>
        </label>
      </div>

      <div className="nori-story-footer">
        <label>
          <span>限时</span>
          <select
            className="nodrag"
            data-testid="choice-countdown"
            value={countdown ?? 0}
            disabled={disabled}
            onChange={(event) => setCountdown(Number(event.target.value) || 0)}
          >
            {countdownOptions.map((sec) => <option key={sec} value={sec}>{sec ? `${sec} 秒` : '不限时'}</option>)}
          </select>
        </label>
        {countdown ? (
          <label>
            <span>超时</span>
            <select
              className="nodrag"
              data-testid="choice-timeout-mode"
              value={choice.timeoutMode}
              disabled={disabled}
              onChange={(event) => patch({ timeoutMode: event.target.value as StoryTimeoutMode }, '设置超时方式')}
            >
              {STORY_TIMEOUT_MODES.map((timeoutMode) => <option key={timeoutMode} value={timeoutMode}>{TIMEOUT_MODE_LABEL[timeoutMode]}</option>)}
            </select>
          </label>
        ) : null}
        {countdown && choice.timeoutMode === 'default' ? (
          <label>
            <span>超时选</span>
            <select
              className="nodrag"
              data-testid="choice-default-option"
              value={choice.defaultOptionId ?? ''}
              disabled={disabled}
              onChange={(event) => patch({ defaultOptionId: event.target.value || null }, '设置默认选项')}
            >
              <option value="">第一个选项</option>
              {choice.options.map((option, index) => <option key={option.id} value={option.id}>{option.label || `选项${index + 1}`}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {countdown && choice.timeoutMode === 'exit' ? (
        <div className="nori-story-option is-timeout">
          <div className="nori-story-row">
            <span className="nori-story-result-label">超时出口</span>
            {mode === 'interaction' ? <label className="nori-story-weight is-inline"><span>权重</span><input className="nodrag nori-story-input is-number" type="number" min={0} max={999} step={1} value={timeoutResult?.weight ?? 0} disabled={disabled} aria-label="超时随机权重" onChange={(event) => {
            const weight = Math.max(0, Math.min(999, event.target.valueAsNumber || 0))
            updateTimeoutResult(weight > 0 ? { weight } : { weight: undefined }, '设置随机权重')
          }} /></label> : null}
            {mode === 'interaction' ? (
              <>
                <button
                  type="button"
                  className={`nori-story-chip nodrag${timeoutResult?.effects.length ? ' is-active' : ''}`}
                  aria-expanded={openEffects === STORY_TIMEOUT_HANDLE}
                  onClick={() => setOpenEffects((current) => (current === STORY_TIMEOUT_HANDLE ? null : STORY_TIMEOUT_HANDLE))}
                >
                  效果{timeoutResult?.effects.length ? ` ${timeoutResult.effects.length}` : ''}
                </button>
                {mounted ? (
                  <select
                    className="nodrag nori-story-select"
                    aria-label="超时切换时机"
                    value={timeoutResult?.when ?? 'now'}
                    disabled={disabled}
                    onChange={(event) => updateTimeoutResult({ when: event.target.value === 'after' ? 'after' : 'now' }, '设置超时切换时机')}
                  >
                    <option value="now">立即切</option>
                    <option value="after">本段播完再切</option>
                  </select>
                ) : null}
                <button
                  type="button"
                  className={`nori-story-chip nodrag${timeoutResult?.retry ? ' is-active is-retry' : ''}`}
                  aria-pressed={timeoutResult?.retry ?? false}
                  disabled={disabled}
                  title="失败后回到互动前 2 秒重来"
                  onClick={() => updateTimeoutResult({ retry: !(timeoutResult?.retry ?? false) }, '设置失败重来')}
                >
                  失败重来
                </button>
              </>
            ) : null}
            <StoryHandle id={STORY_TIMEOUT_HANDLE} side="out" />
          </div>
          {mode === 'interaction' && openEffects === STORY_TIMEOUT_HANDLE ? (
            <StoryEffectsEditor
              effects={timeoutResult?.effects ?? []}
              variables={variables}
              disabled={disabled}
              onManageVariables={manageVariables}
              onChange={(effects) => updateTimeoutResult({ effects }, '编辑超时效果')}
            />
          ) : null}
        </div>
      ) : null}

      <div
        className="nori-story-choice-preview"
        data-testid="story-choice-preview"
        style={{ aspectRatio: orientation === 'landscape' ? '16 / 9' : '9 / 16' }}
      >
        <ChoicePanel
          preview
          prompt={choice.prompt}
          options={choice.options}
          panelStyle={choice.panelStyle}
          layout={choice.layout}
          orientation={orientation}
        />
      </div>
    </>
  )
}
