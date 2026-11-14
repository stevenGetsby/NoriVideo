'use client'

import { useEffect, useRef } from 'react'
import { X } from '@/components/ui/icons'
import { shopItemViews, type StoryRun } from '@/lib/interactive/engine'
import type { StoryProgram, StoryVariable } from '@/lib/interactive/types'
import { StoryIcon } from './player/StoryIcon'
import './player/economy.css'

function currencyOf(program: StoryProgram): StoryVariable | null {
  const currencyId = program.shop?.currencyVariableId
  const variable = currencyId ? program.variables.find((item) => item.id === currencyId) : undefined
  return variable?.type === 'number' ? variable : null
}

/**
 * The story shop. Buying never leaves the current stop: the parent swaps the run while the stage
 * (and any running countdown) stays mounted. Built as a bottom sheet in portrait and a centred
 * panel in landscape; Esc is handled by the player so it closes this before the whole player.
 */
export function ShopSheet({ program, run, orientation, focusItemId, error, ownedRewards = [], onPurchase, onClose }: {
  program: StoryProgram
  run: StoryRun
  orientation: 'portrait' | 'landscape'
  /** A locked choice card sent the viewer here: scroll to and highlight that item. */
  focusItemId?: string | null
  /** Why the last purchase refused, already localised. */
  error?: string | null
  /** Shop item ids whose title or frame the viewer already keeps from any play: sold out forever. */
  ownedRewards?: readonly string[]
  onPurchase: (itemId: string) => void
  onClose: () => void
}) {
  const shop = program.shop?.enabled ? program.shop : null
  const views = shopItemViews(program, run, ownedRewards)
  const currency = currencyOf(program)
  const balance = currency ? run.vars[currency.id] ?? currency.initial : null
  const itemRefs = useRef(new Map<string, HTMLLIElement>())

  useEffect(() => {
    if (!focusItemId) return
    const item = itemRefs.current.get(focusItemId)
    item?.scrollIntoView?.({ block: 'nearest' })
  }, [focusItemId])

  if (!shop) return null

  return (
    <div className={`nori-shop is-${orientation}`} data-testid="shop-sheet" role="dialog" aria-modal="true" aria-label="商城">
      <button type="button" className="nori-shop-backdrop" aria-label="关闭商城" onClick={onClose} />
      <section className="nori-shop-panel">
        <header className="nori-shop-head">
          <h3>商城</h3>
          {currency ? (
            <span className="nori-shop-balance" data-testid="shop-balance" title={currency.name}>
              <StoryIcon icon={currency.icon} />
              <span>{balance}</span>
              {currency.icon ? null : <span>{currency.name}</span>}
            </span>
          ) : null}
          <button type="button" className="nori-shop-close" aria-label="关闭商城" data-testid="shop-close" onClick={onClose}><X /></button>
        </header>
        {currency ? null : <p className="nori-shop-note">未设置付款数值：购买只是模拟，不扣除数值</p>}
        {error ? <p className="nori-shop-error" role="alert" data-testid="shop-error">{error}</p> : null}
        {views.length === 0 ? <p className="nori-shop-empty">商城还没有商品</p> : (
          <ul className="nori-shop-list">
            {views.map(({ item, owned, soldOut, affordable }) => {
              const focused = item.id === focusItemId
              const label = soldOut ? '已售罄' : !affordable ? '余额不足' : '购买'
              return (
                <li
                  key={item.id}
                  ref={(element) => {
                    if (element) itemRefs.current.set(item.id, element)
                    else itemRefs.current.delete(item.id)
                  }}
                  className={`nori-shop-item${focused ? ' is-focused' : ''}`}
                  data-testid={`shop-item-${item.id}`}
                  data-item-id={item.id}
                  data-focused={focused ? 'true' : undefined}
                >
                  <span className="nori-shop-item-icon" aria-hidden="true">
                    {item.icon ? <StoryIcon icon={item.icon} /> : (item.name.trim().slice(0, 1) || '物')}
                  </span>
                  <div className="nori-shop-item-info">
                    <span className="nori-shop-item-name">
                      {item.name || '未命名商品'}
                      {owned > 0 ? <em className="nori-shop-item-owned">已拥有 ×{owned}</em> : null}
                    </span>
                    {item.description ? <p className="nori-shop-item-desc">{item.description}</p> : null}
                    <span className="nori-shop-item-price">
                      {currency?.icon ? <StoryIcon icon={currency.icon} /> : null}
                      <span>售价 {item.price}</span>
                      {currency ? <i>{currency.name}</i> : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`nori-shop-buy${soldOut ? ' is-sold-out' : ''}`}
                    data-testid={`shop-buy-${item.id}`}
                    disabled={soldOut || !affordable}
                    aria-label={`${item.name || '商品'}：${label}`}
                    onClick={() => onPurchase(item.id)}
                  >
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
