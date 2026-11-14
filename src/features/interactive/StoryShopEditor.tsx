'use client'

import { useState } from 'react'
import { Plus, X } from '@/components/ui/icons'
import { StoryEffectsEditor } from '@/features/canvas/story/StoryFields'
import { StoryImageField } from '@/features/canvas/story/StoryImageField'
import type { StoryShop, StoryShopItem, StoryVariable } from '@/lib/interactive/types'
import {
  moveShopItem,
  normalizeShopDraft,
  REWARD_TITLE_MAX,
  sanitizeShop,
  SHOP_ITEM_DESCRIPTION_MAX,
  SHOP_ITEM_LIMIT,
  SHOP_ITEM_NAME_MAX,
  SHOP_ITEM_PURCHASE_MAX,
  SHOP_NO_CURRENCY_NOTE,
  SHOP_PRICE_MAX,
  shopItemId,
  shopItemNameProblem,
} from './gameplay-edit'
import { StoryIconField } from './StoryVariablesEditor'
import './interactive.css'

const priceOf = (value: number) => (Number.isFinite(value) ? value : 0)
const limitOf = (value: number) => (Number.isFinite(value) ? Math.min(SHOP_ITEM_PURCHASE_MAX, Math.max(0, Math.round(value))) : 0)

/** Draft editor for the story shop; nothing is saved until 保存. */
export function StoryShopEditor({ shop, variables, workId = null, readOnly, onSave, onSaved, onManageVariables }: {
  shop: StoryShop | undefined
  variables: StoryVariable[]
  workId?: string | null
  readOnly: boolean
  onSave: (shop: StoryShop) => Promise<void>
  onSaved?: () => void
  onManageVariables?: () => void
}) {
  const [draft, setDraft] = useState<StoryShop>(() => normalizeShopDraft(shop))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = normalizeShopDraft(shop)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const numberVariables = variables.filter((variable) => variable.type === 'number')
  const currencyKnown = !draft.currencyVariableId || numberVariables.some((variable) => variable.id === draft.currencyVariableId)
  const update = (patch: Partial<StoryShop>) => setDraft((current) => ({ ...current, ...patch }))
  const updateItem = (id: string, patch: Partial<StoryShopItem>) => setDraft((current) => ({
    ...current,
    items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }))

  const save = async () => {
    const problem = shopItemNameProblem(draft)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizeShop(draft))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const appendItem = () => {
    const item: StoryShopItem = {
      id: shopItemId(crypto.randomUUID().slice(0, 8)),
      name: `商品${draft.items.length + 1}`,
      icon: null,
      description: '',
      price: 0,
      limit: 1,
      effects: [],
    }
    update({ items: [...draft.items, item] })
  }

  return (
    <div className="nori-story-vars nori-ix-shop">
      <label className="nori-ix-shop-enable">
        <input type="checkbox" checked={draft.enabled} disabled={readOnly} aria-label="开启商城"
          onChange={(event) => update({ enabled: event.target.checked })} />
        <span><strong>开启商城</strong><small>观众在播放器里可以用数值购买商品。</small></span>
      </label>
      <label className="nori-ix-var-field">
        <span>货币</span>
        <select aria-label="商城货币" value={draft.currencyVariableId ?? ''} disabled={readOnly}
          onChange={(event) => update({ currencyVariableId: event.target.value || null })}>
          <option value="">不扣数值（仅模拟）</option>
          {numberVariables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
          {currencyKnown ? null : <option value={draft.currencyVariableId ?? ''}>该数值已失效</option>}
        </select>
      </label>
      <p className="nori-story-vars-hint">{draft.currencyVariableId ? '购买时会从这个数值里扣除价格。' : SHOP_NO_CURRENCY_NOTE}</p>

      {draft.items.length === 0 ? <p className="nori-story-vars-empty">还没有商品。先加一件，比如「钥匙」「补血药」。</p> : (
        <ul className="nori-ix-shop-list">
          {draft.items.map((item, index) => (
            <li key={item.id} className="nori-ix-shop-item">
              <div className="nori-ix-shop-head">
                <StoryIconField label="商品图标" value={item.icon} workId={workId} readOnly={readOnly}
                  onChange={(icon) => updateItem(item.id, { icon: icon ?? null })} />
                <input value={item.name} placeholder="商品名称" maxLength={SHOP_ITEM_NAME_MAX} readOnly={readOnly} aria-label="商品名称"
                  onChange={(event) => updateItem(item.id, { name: event.target.value })} />
                <span className="nori-ix-shop-moves">
                  <button type="button" aria-label="上移商品" disabled={readOnly || index === 0} onClick={() => update({ items: moveShopItem(draft.items, index, -1) })}>↑</button>
                  <button type="button" aria-label="下移商品" disabled={readOnly || index === draft.items.length - 1} onClick={() => update({ items: moveShopItem(draft.items, index, 1) })}>↓</button>
                </span>
                {readOnly ? null : <button type="button" className="nori-ix-shop-remove" aria-label="删除商品" onClick={() => update({ items: draft.items.filter((entry) => entry.id !== item.id) })}><X /></button>}
              </div>
              <input value={item.description} placeholder="描述（可选）" maxLength={SHOP_ITEM_DESCRIPTION_MAX} readOnly={readOnly} aria-label="商品描述"
                onChange={(event) => updateItem(item.id, { description: event.target.value })} />
              <div className="nori-ix-shop-numbers">
                <label>
                  <span>价格</span>
                  <input type="number" min={0} max={SHOP_PRICE_MAX} step={0.01} value={item.price} readOnly={readOnly} aria-label="商品价格"
                    onChange={(event) => updateItem(item.id, { price: priceOf(event.target.valueAsNumber) })} />
                </label>
                <label>
                  <span>每局限购</span>
                  <input type="number" min={0} max={SHOP_ITEM_PURCHASE_MAX} step={1} value={item.limit} readOnly={readOnly} aria-label="每局限购"
                    onChange={(event) => updateItem(item.id, { limit: limitOf(event.target.valueAsNumber) })} />
                </label>
                <small>0 = 不限</small>
              </div>
              <StoryEffectsEditor
                effects={item.effects}
                variables={variables}
                disabled={readOnly}
                onManageVariables={onManageVariables}
                onChange={(effects) => updateItem(item.id, { effects })}
              />
              <div className="nori-ix-shop-reward">
                <label className="nori-ix-ach-title">
                  <span>购买奖励</span>
                  <input value={item.reward?.title ?? ''} placeholder="称号（可选），如 最强王者" maxLength={REWARD_TITLE_MAX} readOnly={readOnly}
                    aria-label="商品奖励称号"
                    onChange={(event) => updateItem(item.id, { reward: { title: event.target.value, frameUrl: item.reward?.frameUrl ?? null } })} />
                </label>
                <div className="nori-ix-ach-frame">
                  <span>头像框</span>
                  <StoryImageField compact label="商品头像框" value={item.reward?.frameUrl ?? null} workId={workId} readOnly={readOnly}
                    onChange={(frameUrl) => updateItem(item.id, { reward: { title: item.reward?.title ?? '', frameUrl } })} />
                </div>
              </div>
              <p className="nori-ix-shop-reward-hint">买下后永久获得称号或头像框，观众可在播放器里佩戴。</p>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" disabled={draft.items.length >= SHOP_ITEM_LIMIT} onClick={appendItem}><Plus />添加商品</button>
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
