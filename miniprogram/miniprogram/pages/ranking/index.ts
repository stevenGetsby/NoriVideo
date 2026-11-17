import { request } from '../../lib/api'
import { formatCount, formatDate } from '../../lib/format'
import type { Card, ItemsResponse } from '../../lib/types'

type RankKind = 'hot' | 'rating' | 'new' | 'reserve'

interface RankRow {
  rank: number
  card: Card
  metric: string
}

const TITLES: Record<RankKind, string> = { hot: '热玩榜', rating: '好评榜', new: '新作榜', reserve: '预约榜' }

function metricOf(kind: RankKind, card: Card): string {
  if (kind === 'hot') return `${formatCount(card.players)}人玩过`
  if (kind === 'rating') return card.ratingScore != null ? `${card.ratingScore}分` : '暂无评分'
  if (kind === 'new') return card.scheduledAt ? `${formatDate(card.scheduledAt)}上线` : ''
  return `${formatCount(card.reserveCount || 0)}人预约`
}

Page({
  data: {
    kind: 'hot' as RankKind,
    rows: [] as RankRow[],
    loading: true,
    error: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const k = (options.k || 'hot') as RankKind
    const kind: RankKind = TITLES[k] ? k : 'hot'
    this.setData({ kind })
    wx.setNavigationBarTitle({ title: TITLES[kind] })
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: false })
    try {
      const data = await request<ItemsResponse>('GET', `/api/mp/rankings/${this.data.kind}`, undefined, { auth: 'none' })
      const rows: RankRow[] = (data.items || []).map((card, i) => ({ rank: i + 1, card, metric: metricOf(this.data.kind, card) }))
      this.setData({ loading: false, rows })
    } catch {
      this.setData({ loading: false, error: true })
    }
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },
})
