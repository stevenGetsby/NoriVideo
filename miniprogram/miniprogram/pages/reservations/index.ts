import { request } from '../../lib/api'
import { ensureLogin } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import type { Card, ItemsResponse } from '../../lib/types'

interface ReservationItem extends Card {
  dateText: string
}

Page({
  data: {
    items: [] as ReservationItem[],
    loading: true,
    error: false,
    needLogin: false,
  },

  onLoad() {
    this.load()
  },

  onShow() {
    if (!this.data.loading) this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: false, needLogin: false })
    try {
      await ensureLogin()
      const data = await request<ItemsResponse>('GET', '/api/mp/me/reservations', undefined, { auth: 'required' })
      const items: ReservationItem[] = (data.items || []).map((card) => ({
        ...card,
        dateText: card.scheduledAt ? `${formatDate(card.scheduledAt)}上线` : '即将上线',
      }))
      this.setData({ loading: false, items })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'MP_TIMELINE') this.setData({ loading: false, needLogin: true })
      else this.setData({ loading: false, error: true })
    }
  },

  onLogin() {
    this.load()
  },

  onRetry() {
    this.load()
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
