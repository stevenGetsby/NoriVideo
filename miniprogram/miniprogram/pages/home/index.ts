import { BRAND_NAME } from '../../config'
import { request } from '../../lib/api'
import { ensureLogin } from '../../lib/auth'
import { formatCount, formatDate } from '../../lib/format'
import { track } from '../../lib/track'
import type { Card, ContinueCard, HomeResponse, Slot, TopicCard } from '../../lib/types'

interface HotRow {
  rank: number
  card: Card
  metric: string
}

interface UpcomingCard extends Card {
  dateText: string
  reserveText: string
  reserved: boolean
}

Page({
  data: {
    brand: BRAND_NAME,
    loading: true,
    error: false,
    hero: [] as Slot[],
    picks: [] as Slot[],
    continue: [] as ContinueCard[],
    hotRows: [] as HotRow[],
    newest: [] as Card[],
    upcoming: [] as UpcomingCard[],
    topics: [] as TopicCard[],
    reserved: {} as Record<string, boolean>,
  },

  onLoad() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: false })
    await ensureLogin().catch(() => null)
    try {
      const data = await request<HomeResponse>('GET', '/api/mp/home', undefined, { auth: 'optional' })
      const hotRows: HotRow[] = (data.hot || []).map((card, i) => ({
        rank: i + 1,
        card,
        metric: `${formatCount(card.players)}人玩过`,
      }))
      const upcoming: UpcomingCard[] = (data.upcoming || []).map((card) => ({
        ...card,
        dateText: card.scheduledAt ? `${formatDate(card.scheduledAt)}上线` : '即将上线',
        reserveText: `${formatCount(card.reserveCount || 0)}人已预约`,
        reserved: !!this.data.reserved[card.slug],
      }))
      this.setData({
        loading: false,
        hero: data.hero || [],
        picks: data.picks || [],
        continue: data.continue || [],
        hotRows,
        newest: data.newest || [],
        upcoming,
        topics: data.topics || [],
      })
    } catch {
      this.setData({ loading: false, error: true })
    }
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' })
  },

  onHeroTap(e: WechatMiniprogram.TouchEvent) {
    const slot = this.data.hero[Number(e.currentTarget.dataset.index)]
    if (!slot) return
    this.openTarget(slot.target.type, slot.target.slug)
  },

  onPickTap(e: WechatMiniprogram.TouchEvent) {
    const slot = this.data.picks[Number(e.currentTarget.dataset.index)]
    if (!slot) return
    this.openTarget(slot.target.type, slot.target.slug)
  },

  onTopicTap(e: WechatMiniprogram.TouchEvent) {
    const slug = String(e.currentTarget.dataset.slug)
    wx.navigateTo({ url: `/pages/topic/index?t=${encodeURIComponent(slug)}` })
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as { slug?: string } | undefined
    const slug = String(detail?.slug || (e.currentTarget.dataset as { slug?: string }).slug || '')
    if (slug) wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  onContinueTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pkg-play/play-portrait/index?w=${encodeURIComponent(slug)}&from=resume` })
  },

  onHotMore() {
    wx.navigateTo({ url: '/pages/ranking/index?k=hot' })
  },

  async onReserve(e: WechatMiniprogram.TouchEvent) {
    const slug = String(e.currentTarget.dataset.slug)
    try {
      await ensureLogin()
      const res = await request<{ reserved: boolean; reserveCount: number }>(
        'PUT', `/api/mp/works/${encodeURIComponent(slug)}/reservation`, undefined, { auth: 'required' },
      )
      const reserved = { ...this.data.reserved, [slug]: res.reserved }
      const upcoming = this.data.upcoming.map((c) => c.slug === slug
        ? { ...c, reserved: res.reserved, reserveText: `${formatCount(res.reserveCount)}人已预约` }
        : c)
      this.setData({ reserved, upcoming })
      track('reserve', { w: slug, v: res.reserved ? 1 : 0 })
      wx.showToast({ title: res.reserved ? '已预约' : '已取消预约', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: (err as { message?: string }).message || '操作失败', icon: 'none' })
    }
  },

  openTarget(type: 'work' | 'topic', slug: string) {
    if (type === 'topic') wx.navigateTo({ url: `/pages/topic/index?t=${encodeURIComponent(slug)}` })
    else wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },
})
