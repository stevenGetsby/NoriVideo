import { request } from '../../lib/api'
import { formatCount, formatDate } from '../../lib/format'
import type { Card, ItemsResponse, ListResponse } from '../../lib/types'

type RankKind = 'hot' | 'rating' | 'new' | 'reserve'
type Sort = 'hot' | 'new' | 'rating'

interface RankRow {
  rank: number
  card: Card
  metric: string
}

const TAGS = ['悬疑', '恋爱', '奇幻', '科幻', '都市', '古风', '惊悚', '喜剧', '冒险', '治愈', '职场', '校园']

function metricOf(kind: RankKind, card: Card): string {
  if (kind === 'hot') return `${formatCount(card.players)}人玩过`
  if (kind === 'rating') return card.ratingScore != null ? `${card.ratingScore}分` : '暂无评分'
  if (kind === 'new') return card.scheduledAt ? `${formatDate(card.scheduledAt)}上线` : ''
  return `${formatCount(card.reserveCount || 0)}人预约`
}

Page({
  data: {
    tab: 'rank' as 'rank' | 'tag',
    rankKinds: [
      { k: 'hot', label: '热玩榜' },
      { k: 'rating', label: '好评榜' },
      { k: 'new', label: '新作榜' },
      { k: 'reserve', label: '预约榜' },
    ] as { k: RankKind; label: string }[],
    rankKind: 'hot' as RankKind,
    rankRows: [] as RankRow[],
    rankLoading: true,
    rankError: false,
    tags: TAGS,
    tag: TAGS[0],
    sorts: [
      { k: 'hot', label: '最热' },
      { k: 'new', label: '最新' },
      { k: 'rating', label: '好评' },
    ] as { k: Sort; label: string }[],
    sort: 'hot' as Sort,
    items: [] as Card[],
    cursor: null as string | null,
    listLoading: true,
    listError: false,
    loadingMore: false,
  },

  onLoad() {
    this.loadRank()
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    if (this.data.tab === 'rank') this.loadRank().finally(done)
    else this.loadList(true).finally(done)
  },

  onReachBottom() {
    if (this.data.tab === 'tag' && this.data.cursor && !this.data.loadingMore) this.loadList(false)
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const tab = String(e.currentTarget.dataset.tab) as 'rank' | 'tag'
    if (tab === this.data.tab) return
    this.setData({ tab })
    if (tab === 'rank' && !this.data.rankRows.length) this.loadRank()
    if (tab === 'tag' && !this.data.items.length) this.loadList(true)
  },

  onRankKind(e: WechatMiniprogram.TouchEvent) {
    const rankKind = String(e.currentTarget.dataset.k) as RankKind
    this.setData({ rankKind })
    this.loadRank()
  },

  async loadRank() {
    this.setData({ rankLoading: true, rankError: false })
    try {
      const data = await request<ItemsResponse>('GET', `/api/mp/rankings/${this.data.rankKind}`, undefined, { auth: 'none' })
      const rankRows: RankRow[] = (data.items || []).map((card, i) => ({ rank: i + 1, card, metric: metricOf(this.data.rankKind, card) }))
      this.setData({ rankLoading: false, rankRows })
    } catch {
      this.setData({ rankLoading: false, rankError: true })
    }
  },

  onTag(e: WechatMiniprogram.TouchEvent) {
    const tag = String(e.currentTarget.dataset.tag)
    this.setData({ tag })
    this.loadList(true)
  },

  onSort(e: WechatMiniprogram.TouchEvent) {
    const sort = String(e.currentTarget.dataset.k) as Sort
    this.setData({ sort })
    this.loadList(true)
  },

  async loadList(reset: boolean) {
    if (reset) this.setData({ listLoading: true, listError: false, cursor: null })
    else this.setData({ loadingMore: true })
    const cursor = reset ? '' : (this.data.cursor || '')
    const url = `/api/mp/works?sort=${this.data.sort}&tag=${encodeURIComponent(this.data.tag)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    try {
      const data = await request<ListResponse>('GET', url, undefined, { auth: 'none' })
      const items = reset ? (data.items || []) : [...this.data.items, ...(data.items || [])]
      this.setData({ items, cursor: data.nextCursor, listLoading: false, loadingMore: false })
    } catch {
      this.setData({ listLoading: false, loadingMore: false, listError: reset })
    }
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  onListRetry() {
    this.loadList(true)
  },
})
