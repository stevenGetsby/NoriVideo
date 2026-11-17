import { request } from '../../lib/api'
import type { WorkDetail } from '../../lib/types'

Page({
  data: {
    slug: '',
    loading: true,
    error: false,
    notFound: false,
    detail: null as WorkDetail | null,
    endingsGot: [] as string[],
    achievementsGot: [] as string[],
    endingGotCount: 0,
    achievementGotCount: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ slug: options.w || '' })
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
      const detail = await request<WorkDetail>('GET', `/api/mp/works/${encodeURIComponent(this.data.slug)}`, undefined, { auth: 'optional' })
      const endingsGot = detail.viewer?.endingsGot ?? []
      const achievementsGot = detail.viewer?.achievementsGot ?? []
      this.setData({
        loading: false,
        detail,
        endingsGot,
        achievementsGot,
        endingGotCount: endingsGot.length,
        achievementGotCount: achievementsGot.length,
      })
      wx.setNavigationBarTitle({ title: `${detail.work.title} · 结局图鉴` })
    } catch (err) {
      const status = (err as { status?: number }).status
      this.setData({ loading: false, error: status !== 404, notFound: status === 404 })
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
