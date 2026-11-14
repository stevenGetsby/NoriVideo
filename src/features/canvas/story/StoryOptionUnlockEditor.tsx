'use client'

import type { StoryOptionUnlock, StoryShop, StoryVariable } from '@/lib/interactive/types'
import { newOptionUnlock, setUnlockMode } from '@/features/interactive/gameplay-edit'
import { StoryConditionsEditor } from './StoryFields'
import '@/features/interactive/story-gameplay.css'

/**
 * The unlock rule of one choice option: conditions on values plus what the viewer sees while
 * they are unmet (nothing at all, or a locked card that can send them to the shop).
 */
export function StoryOptionUnlockEditor({ unlock, variables, shop, disabled, onManageVariables, onOpenGameplay, onChange }: {
  unlock: StoryOptionUnlock | undefined
  variables: StoryVariable[]
  shop: StoryShop | undefined
  disabled: boolean
  onManageVariables?: () => void
  onOpenGameplay?: () => void
  onChange: (unlock: StoryOptionUnlock | null) => void
}) {
  if (!unlock) {
    return (
      <div className="nori-ix-unlock">
        <p className="nori-ix-unlock-note">
          {variables.length ? '条件不满足时，可以隐藏这个选项，或显示成一把锁。' : '先创建至少一个全局变量，才能给选项设置解锁条件。'}
        </p>
        <button
          type="button"
          className="nori-story-hint-button nodrag"
          disabled={disabled || !onManageVariables}
          onClick={onManageVariables}
        >
          先添加全局变量
        </button>
      </div>
    )
  }

  const items = shop?.enabled ? shop.items : []
  const knownItem = !unlock.shopItemId || items.some((item) => item.id === unlock.shopItemId)

  return (
    <div className="nori-ix-unlock">
      <div className="nori-ix-unlock-head">
        <select aria-label="条件不满足时" value={unlock.mode} disabled={disabled}
          onChange={(event) => onChange(setUnlockMode(unlock, event.target.value === 'locked' ? 'locked' : 'hidden'))}>
          <option value="hidden">隐藏选项</option>
          <option value="locked">显示为锁定</option>
        </select>
        <select aria-label="条件满足方式" value={unlock.match} disabled={disabled}
          onChange={(event) => onChange({ ...unlock, match: event.target.value === 'any' ? 'any' : 'all' })}>
          <option value="all">全部满足</option>
          <option value="any">满足任一</option>
        </select>
        <button type="button" className="nori-story-hint-button nodrag" disabled={disabled} onClick={() => onChange(null)}>清除</button>
      </div>

      <StoryConditionsEditor
        conditions={unlock.conditions}
        variables={variables}
        disabled={disabled}
        onManageVariables={onManageVariables}
        onChange={(conditions) => onChange({ ...unlock, conditions })}
      />
      {unlock.conditions.length === 0 ? <p className="nori-ix-unlock-note nori-ix-warning">至少需要一个条件，否则解锁规则不生效。</p> : null}

      {unlock.mode !== 'locked' ? null : items.length ? (
        <label className="nori-ix-unlock-shop">
          <span>去商城购买</span>
          <select aria-label="关联商品" value={unlock.shopItemId ?? ''} disabled={disabled}
            onChange={(event) => onChange({ ...unlock, shopItemId: event.target.value || null })}>
            <option value="">不关联商品</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name.trim() || '未命名商品'}</option>)}
            {knownItem ? null : <option value={unlock.shopItemId ?? ''}>商品已不存在</option>}
          </select>
        </label>
      ) : (
        <div className="nori-ix-unlock-shop">
          <p className="nori-ix-unlock-note">先在玩法设置里开启商城并添加商品</p>
          {onOpenGameplay ? (
            <button type="button" className="nori-story-hint-button nodrag" disabled={disabled} onClick={onOpenGameplay}>打开玩法设置</button>
          ) : null}
        </div>
      )}
      {unlock.mode === 'locked' && !unlock.shopItemId && items.length ? (
        <p className="nori-ix-unlock-note">不关联商品时，观众只能自己把数值攒够后再选。</p>
      ) : null}
    </div>
  )
}
