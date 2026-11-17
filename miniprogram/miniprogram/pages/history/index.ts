import { request } from '../../lib/api'
import { ensureLogin } from '../../lib/auth'
import { formatRelative } from '../../lib/format'
import type { ContinueCard, HistoryResponse } from '../../lib/types'

interface HistoryItem extends ContinueCard {
  key: string
  timeText: string
}

Page({
  data: {
    items: [] as HistoryItem[],
    cursor: null as string | null,
    loading: true,
    error: false,
    needLogin: false,
    loadingMore: false,
  },

  onLoad() {
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.cursor && !this.data.loadingMore) this.load(false)
  },

  async load(reset: boolean) {
    if (reset) this.setData({ loading: true, error: false, needLogin: false, cursor: null })
    else this.setData({ loadingMore: true })
    try {
      await ensureLogin()
      const cursor = reset ? '' : (this.data.cursor || '')
      const url = `/api/mp/me/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const data = await request<HistoryResponse>('GET', url, undefined, { auth: 'required' })
      const now = Date.now()
      const mapped: HistoryItem[] = (data.items || []).map((it) => ({ ...it, key: it.card.slug, timeText: formatRelative(it.lastPlayedAt, now) }))
      const items = reset ? mapped : [...this.data.items, ...mapped]
      this.setData({ items, cursor: data.nextCursor, loading: false, loadingMore: false })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'MP_TIMELINE') this.setData({ loading: false, loadingMore: false, needLogin: true })
      else this.setData({ loading: false, loadingMore: false, error: reset })
    }
  },

  onLogin() {
    this.load(true)
  },

  onRetry() {
    this.load(true)
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
