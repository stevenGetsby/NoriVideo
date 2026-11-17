import { request } from '../../lib/api'
import { track } from '../../lib/track'
import type { Card, ItemsResponse } from '../../lib/types'

let debounce: ReturnType<typeof setTimeout> | null = null

Page({
  data: {
    keyword: '',
    results: [] as Card[],
    hotWords: [] as string[],
    searching: false,
    searched: false,
    error: false,
  },

  onLoad() {
    this.loadHot()
  },

  async loadHot() {
    try {
      const data = await request<ItemsResponse>('GET', '/api/mp/rankings/hot', undefined, { auth: 'none' })
      this.setData({ hotWords: (data.items || []).slice(0, 8).map((c) => c.title) })
    } catch {
      // 热门搜索失败不影响搜索
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => this.doSearch(), 300)
  },

  onConfirm() {
    if (debounce) clearTimeout(debounce)
    this.doSearch()
  },

  onClear() {
    this.setData({ keyword: '', results: [], searched: false, error: false })
  },

  async doSearch() {
    const q = this.data.keyword.trim()
    if (!q) {
      this.setData({ results: [], searched: false, error: false })
      return
    }
    this.setData({ searching: true, error: false })
    track('search', { o: q.slice(0, 64) })
    try {
      const data = await request<ItemsResponse>('GET', `/api/mp/search?q=${encodeURIComponent(q)}`, undefined, { auth: 'none' })
      this.setData({ searching: false, searched: true, results: data.items || [] })
    } catch {
      this.setData({ searching: false, searched: true, error: true })
    }
  },

  onHotWord(e: WechatMiniprogram.TouchEvent) {
    this.setData({ keyword: String(e.currentTarget.dataset.word) })
    this.doSearch()
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  onRetry() {
    this.doSearch()
  },
})
