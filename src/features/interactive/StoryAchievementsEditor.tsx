'use client'

import { useState } from 'react'
import { Plus, X } from '@/components/ui/icons'
import { achievementConditionText, achievementRewardText, COMPARE_PHRASES } from '@/lib/interactive/achievement-text'
import { findPlace, placeLabel, type StoryPlaces } from '@/lib/interactive/places'
import {
  STORY_ACHIEVEMENT_CONDITION_TYPES,
  STORY_COMPARE_OPS,
  type StoryAchievement,
  type StoryAchievementCondition,
  type StoryCompareOp,
  type StoryVariable,
} from '@/lib/interactive/types'
import { StoryImageField } from '@/features/canvas/story/StoryImageField'
import {
  ACHIEVEMENT_CONDITION_LABELS,
  ACHIEVEMENT_DESCRIPTION_MAX,
  ACHIEVEMENT_LIMIT,
  ACHIEVEMENT_NAME_MAX,
  achievementId,
  achievementSaveProblem,
  moveAchievement,
  newAchievement,
  normalizeAchievementsDraft,
  placeConditionOf,
  REWARD_TITLE_MAX,
  sanitizeAchievements,
  setAchievementConditionType,
  setAchievementValueVariable,
} from './gameplay-edit'
import { StoryIconField } from './StoryVariablesEditor'
import './story-gameplay.css'

/** Draft editor for the 成就 tab; nothing is saved until 保存. */
export function StoryAchievementsEditor({ achievements, places, variables, workId = null, readOnly, onSave, onSaved }: {
  achievements: StoryAchievement[] | undefined
  places: StoryPlaces
  variables: StoryVariable[]
  workId?: string | null
  readOnly: boolean
  onSave: (achievements: StoryAchievement[]) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<StoryAchievement[]>(() => normalizeAchievementsDraft(achievements))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = normalizeAchievementsDraft(achievements)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const update = (id: string, patch: Partial<StoryAchievement>) => setDraft((current) => (
    current.map((item) => (item.id === id ? { ...item, ...patch } : item))
  ))
  const updateCondition = (id: string, condition: StoryAchievementCondition) => update(id, { condition })

  const save = async () => {
    const problem = achievementSaveProblem(draft)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizeAchievements(draft))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const append = () => {
    const created = newAchievement(achievementId(crypto.randomUUID().slice(0, 8)), `成就${draft.length + 1}`, places)
    setDraft((current) => [...current, created])
  }

  return (
    <div className="nori-story-vars nori-ix-achievements">
      <p className="nori-story-vars-hint">
        观众达成条件后获得称号或头像框；商城里购买的商品也能单独设置奖励，在「商城」标签中按商品编辑。
      </p>
      {places.endings.length === 0 && places.segments.length === 0 ? (
        <p className="nori-ix-note is-warning">还没有任何结局或剧情片段，先到画布上写一段剧情。</p>
      ) : null}
      {draft.length === 0 ? <p className="nori-story-vars-empty">还没有成就。比如「第一次到达好结局」「金币攒到 100」。</p> : (
        <ul className="nori-ix-ach-list">
          {draft.map((achievement, index) => {
            const condition = achievement.condition
            const variable = condition.type === 'value' ? variables.find((item) => item.id === condition.variableId) : undefined
            const booleanCondition = condition.type === 'value' && variable?.type === 'boolean'
            return (
              <li key={achievement.id} className="nori-ix-ach-card" data-achievement={achievement.id}>
                <div className="nori-ix-ach-head">
                  <StoryIconField label="成就图标" value={achievement.icon} workId={workId} readOnly={readOnly}
                    onChange={(icon) => update(achievement.id, { icon: icon ?? null })} />
                  <input value={achievement.name} placeholder="成就名称" maxLength={ACHIEVEMENT_NAME_MAX} readOnly={readOnly}
                    aria-label="成就名称" onChange={(event) => update(achievement.id, { name: event.target.value })} />
                  <span className="nori-ix-ach-moves">
                    <button type="button" aria-label="上移成就" disabled={readOnly || index === 0}
                      onClick={() => setDraft((current) => moveAchievement(current, index, -1))}>↑</button>
                    <button type="button" aria-label="下移成就" disabled={readOnly || index === draft.length - 1}
                      onClick={() => setDraft((current) => moveAchievement(current, index, 1))}>↓</button>
                  </span>
                  {readOnly ? null : (
                    <button type="button" className="nori-ix-ach-remove" aria-label="删除成就"
                      onClick={() => setDraft((current) => current.filter((item) => item.id !== achievement.id))}><X /></button>
                  )}
                </div>
                <input value={achievement.description} placeholder="描述（可选）" maxLength={ACHIEVEMENT_DESCRIPTION_MAX}
                  readOnly={readOnly} aria-label="成就描述" onChange={(event) => update(achievement.id, { description: event.target.value })} />

                <div className="nori-ix-ach-condition">
                  <select aria-label="达成条件" value={condition.type} disabled={readOnly}
                    onChange={(event) => updateCondition(achievement.id, setAchievementConditionType(
                      condition, event.target.value as StoryAchievementCondition['type'], places, variables,
                    ))}>
                    {STORY_ACHIEVEMENT_CONDITION_TYPES.map((type) => (
                      <option key={type} value={type}>{ACHIEVEMENT_CONDITION_LABELS[type]}</option>
                    ))}
                  </select>
                  {condition.type === 'ending' || condition.type === 'segment' ? (
                    <select
                      aria-label={condition.type === 'ending' ? '选择结局' : '选择片段'}
                      value={condition.projectId && condition.nodeId ? `${condition.projectId}:${condition.nodeId}` : ''}
                      disabled={readOnly}
                      onChange={(event) => {
                        const place = [...places.endings, ...places.segments].find((entry) => entry.key === event.target.value)
                        if (place) updateCondition(achievement.id, placeConditionOf(place.kind, place.projectId, place.nodeId))
                      }}
                    >
                      <option value="">{condition.type === 'ending' ? '选择结局' : '选择片段'}</option>
                      {(condition.type === 'ending' ? places.endings : places.segments).map((place) => (
                        <option key={place.key} value={place.key}>{place.label}</option>
                      ))}
                      {condition.projectId && condition.nodeId && !findPlace(places, condition.type, condition.projectId, condition.nodeId) ? (
                        <option value={`${condition.projectId}:${condition.nodeId}`}>{placeLabel(null, condition.type)}</option>
                      ) : null}
                    </select>
                  ) : null}
                  {condition.type === 'value' ? (
                    <>
                      <select aria-label="条件数值" value={condition.variableId} disabled={readOnly}
                        onChange={(event) => updateCondition(achievement.id, setAchievementValueVariable(
                          condition, variables.find((item) => item.id === event.target.value),
                        ))}>
                        <option value="">选择数值</option>
                        {variables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        {condition.variableId && !variable ? <option value={condition.variableId}>未知数值</option> : null}
                      </select>
                      <select aria-label="比较方式" value={condition.op} disabled={readOnly}
                        onChange={(event) => updateCondition(achievement.id, { ...condition, op: event.target.value as StoryCompareOp })}>
                        {STORY_COMPARE_OPS.map((op) => (
                          <option key={op} value={op}>{booleanCondition ? (op === '!=' ? '不为' : op === '==' ? '为' : COMPARE_PHRASES[op]) : COMPARE_PHRASES[op]}</option>
                        ))}
                      </select>
                      {booleanCondition ? (
                        <select aria-label="目标值" value={condition.value === true ? 'true' : 'false'} disabled={readOnly}
                          onChange={(event) => updateCondition(achievement.id, { ...condition, value: event.target.value === 'true' })}>
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      ) : (
                        <input type="number" aria-label="目标值" value={typeof condition.value === 'number' ? condition.value : Number(condition.value)}
                          readOnly={readOnly}
                          onChange={(event) => updateCondition(achievement.id, {
                            ...condition,
                            value: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0,
                          })} />
                      )}
                    </>
                  ) : null}
                </div>

                <div className="nori-ix-ach-reward">
                  <label className="nori-ix-ach-title">
                    <span>称号</span>
                    <input value={achievement.reward.title} placeholder="如 最强王者" maxLength={REWARD_TITLE_MAX} readOnly={readOnly}
                      aria-label="奖励称号" onChange={(event) => update(achievement.id, { reward: { ...achievement.reward, title: event.target.value } })} />
                  </label>
                  <div className="nori-ix-ach-frame">
                    <span>头像框</span>
                    <StoryImageField compact label="头像框" value={achievement.reward.frameUrl} workId={workId} readOnly={readOnly}
                      onChange={(frameUrl) => update(achievement.id, { reward: { ...achievement.reward, frameUrl } })} />
                  </div>
                </div>

                <p className="nori-ix-ach-summary">
                  条件：{achievementConditionText(condition, { places, variables })} · 奖励：{achievementRewardText(achievement.reward)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <p className="nori-ix-ach-count">已添加 {draft.length} / {ACHIEVEMENT_LIMIT} 个成就</p>
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" disabled={draft.length >= ACHIEVEMENT_LIMIT} onClick={append}><Plus />添加成就</button>
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
