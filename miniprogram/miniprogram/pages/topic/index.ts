import { BRAND_NAME } from '../../config'
import { request } from '../../lib/api'
import { generateShareId, topicSharePath, topicShareTitle } from '../../lib/share'
import { track } from '../../lib/track'
import type { Card, TopicResponse } from '../../lib/types'

Page({
  data: {
    slug: '',
    topic: null as TopicResponse['topic'] | null,
    items: [] as Card[],
    loading: true,
    error: false,
    notFound: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const slug = options.t || ''
    this.setData({ slug })
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    if (!this.data.slug) {
      this.setData({ loading: false, notFound: true })
      return
    }
    this.setData({ loading: true, error: false, notFound: false })
    try {
      const data = await request<TopicResponse>('GET', `/api/mp/topics/${encodeURIComponent(this.data.slug)}`, undefined, { auth: 'none' })
      this.setData({ loading: false, topic: data.topic, items: data.items || [] })
      wx.setNavigationBarTitle({ title: data.topic.title })
    } catch (err) {
      const status = (err as { status?: number }).status
      this.setData({ loading: false, error: status !== 404, notFound: status === 404 })
    }
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const slug = String((e.detail as { slug: string }).slug)
    wx.navigateTo({ url: `/pages/work/index?w=${encodeURIComponent(slug)}` })
  },

  onShareAppMessage() {
    const topic = this.data.topic
    if (!topic) return { title: BRAND_NAME, path: '/pages/home/index' }
    const id = generateShareId()
    track('share_click', { w: topic.slug, o: 'topic' })
    return {
      title: topicShareTitle(topic.title, BRAND_NAME),
      path: topicSharePath(topic.slug, id),
      imageUrl: topic.cover,
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
