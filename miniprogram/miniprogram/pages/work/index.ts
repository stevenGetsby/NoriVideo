import { BRAND_NAME, TPL_CHAPTER_UPDATE, TPL_WORK_LIVE } from '../../config'
import { request } from '../../lib/api'
import { parseScene } from '../../lib/attribution'
import { ensureLogin, getToken } from '../../lib/auth'
import { formatCount, formatDate, formatDuration } from '../../lib/format'
import { getSettings } from '../../lib/settings'
import { isWifi } from '../../lib/network'
import { syncDown } from '../../lib/save-sync'
import { generateShareId, registerShare, timelineQuery, workSharePath, workShareTitle } from '../../lib/share'
import type { PosterPayload } from '../../components/poster-maker/index'
import { storageKey, wxStorage } from '../../lib/storage'
import { readStoredSaves } from '../../runtime/story-runtime'
import { currentAttr, track } from '../../lib/track'
import type { WorkDetail } from '../../lib/types'

const SOURCE_POSITION: Record<string, string> = {
  share: 'share', qrcode: 'qrcode', subscribe: 'subscribe', search: 'search',
}

Page({
  data: {
    slug: '',
    timeline: false,
    loading: true,
    error: false,
    notFound: false,
    detail: null as WorkDetail | null,
    minutes: 0,
    playersText: '0',
    ratingText: '',
    synopsisExpanded: false,
    muted: true,
    showTrailer: false,
    favorited: false,
    reserved: false,
    hasSave: false,
    endingsGot: [] as string[],
    achievementsGot: [] as string[],
    endingGotCount: 0,
    achievementGotCount: 0,
    mainLabel: '开始游玩',
    showRestart: false,
    reserveDateText: '',
    reportShow: false,
    shareShow: false,
    ratingShow: false,
    ratingTitle: '',
    chapters: [] as { order: number; title: string; duration: string }[],
  },

  onLoad(options: Record<string, string | undefined>) {
    const scene = parseScene(options.scene)
    const slug = options.w || scene.w || ''
    let timeline = false
    try {
      timeline = wx.getLaunchOptionsSync().scene === 1154
    } catch {
      timeline = false
    }
    this.setData({ slug, timeline })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'], fail: () => {} })
    const attr = currentAttr()
    const o = (attr && SOURCE_POSITION[attr.source]) || 'direct'
    track('work_view', { w: slug, o })
    this.load()
  },

  onShow() {
    if (this.data.timeline) return
    const justKey = `mp.ending.just:${this.data.slug}`
    const promptedKey = `mp.rated.prompted:${this.data.slug}`
    if (wxStorage.getItem(justKey)) {
      wxStorage.removeItem(justKey)
      const viewer = this.data.detail?.viewer
      if (!wxStorage.getItem(promptedKey) && viewer && viewer.rating == null) this.setData({ ratingShow: true })
    }
    if (this.data.showTrailer) wx.createVideoContext('trailer', this).play()
    this.refreshSaveButton()
  },

  onHide() {
    if (this.data.showTrailer) wx.createVideoContext('trailer', this).pause()
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
      const viewer = detail.viewer
      const scheduled = detail.work.status === 'scheduled'
      let showTrailer = false
      if (detail.work.trailer) showTrailer = getSettings().autoplayOnCellular ? true : await isWifi()
      const endingsGot = viewer?.endingsGot ?? []
      const achievementsGot = viewer?.achievementsGot ?? []
      const hasSave = viewer?.hasSave ?? false
      const reserved = viewer?.reserved ?? false
      const reserveDateText = detail.work.scheduledAt ? formatDate(detail.work.scheduledAt) : ''
      const mainLabel = scheduled
        ? (reserved ? `已预约 · ${reserveDateText}上线` : '预约上线提醒')
        : (hasSave ? '继续游玩' : '开始游玩')
      this.setData({
        loading: false,
        detail,
        minutes: Math.ceil(detail.work.totalDurationSec / 60),
        playersText: formatCount(detail.work.players),
        ratingText: detail.work.ratingCount >= 10 ? `${detail.work.ratingScore}分` : '评分人数不足',
        favorited: viewer?.favorited ?? false,
        reserved,
        hasSave,
        endingsGot,
        achievementsGot,
        endingGotCount: endingsGot.length,
        achievementGotCount: achievementsGot.length,
        mainLabel,
        showRestart: hasSave && !scheduled,
        showTrailer,
        reserveDateText,
        ratingTitle: `给《${detail.work.title}》打个分`,
        chapters: detail.chapters.map((c) => ({ order: c.order, title: c.title, duration: formatDuration(c.durationSec) })),
      })
      wx.setNavigationBarTitle({ title: detail.work.title })
      if (!this.data.timeline && getToken()) syncDown(this.data.slug).then(() => this.refreshSaveButton()).catch(() => {})
    } catch (err) {
      const status = (err as { status?: number }).status
      this.setData({ loading: false, error: status !== 404, notFound: status === 404 })
    }
  },

  // F.7：主按钮跟着合并后的本地自动存档走；播放器清掉失效自动存档后回到「开始游玩」。
  refreshSaveButton() {
    const detail = this.data.detail
    if (!detail || this.data.timeline || detail.work.status === 'scheduled') return
    const hasSave = Boolean(readStoredSaves(wxStorage, storageKey(this.data.slug)).auto)
    this.setData({ hasSave, mainLabel: hasSave ? '继续游玩' : '开始游玩', showRestart: hasSave })
  },

  toggleSynopsis() {
    this.setData({ synopsisExpanded: !this.data.synopsisExpanded })
  },

  toggleMute() {
    this.setData({ muted: !this.data.muted })
  },

  playUrl(from: string): string {
    const ar = this.data.detail?.work.aspectRatio || ''
    const page = ar === '16:9' || ar === '4:3' ? 'play-landscape' : 'play-portrait'
    return `/pkg-play/${page}/index?w=${encodeURIComponent(this.data.slug)}&from=${from}`
  },

  async onMain() {
    if (!this.data.detail) return
    if (this.data.detail.work.status === 'scheduled') {
      await this.toggleReserve()
      return
    }
    wx.navigateTo({ url: this.playUrl(this.data.hasSave ? 'resume' : 'new') })
  },

  onRestart() {
    wx.showModal({
      title: '重新开始',
      content: '重新开始会覆盖自动存档，手动存档保留。',
      confirmText: '重新开始',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: this.playUrl('new') })
      },
    })
  },

  async toggleReserve() {
    if (this.data.reserved) {
      wx.showActionSheet({
        itemList: ['取消预约'],
        success: (res) => { if (res.tapIndex === 0) void this.cancelReserve() },
      })
      return
    }
    // requestSubscribeMessage 必须直接在点击回调里调用，前面不能有别的 await。
    const accepted = await new Promise<boolean>((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [TPL_WORK_LIVE],
        success: (res) => resolve(res[TPL_WORK_LIVE] === 'accept'),
        fail: () => resolve(false),
      })
    })
    try {
      const res = await request<{ reserved: boolean; reserveCount: number }>(
        'PUT', `/api/mp/works/${encodeURIComponent(this.data.slug)}/reservation`, undefined, { auth: 'required' },
      )
      if (accepted) {
        await request('POST', '/api/mp/subscriptions', { slug: this.data.slug, kind: 'work_live', accepted: true }, { auth: 'required' }).catch(() => {})
      }
      this.setData({ reserved: res.reserved, mainLabel: `已预约 · ${this.data.reserveDateText}上线` })
      track('reserve', { w: this.data.slug, v: 1 })
      wx.showToast({ title: accepted ? '预约成功，上线时会通知你' : '预约成功，开启通知后可以在上线时收到提醒', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: (err as { message?: string }).message || '操作失败', icon: 'none' })
    }
  },

  async cancelReserve() {
    try {
      const res = await request<{ reserved: boolean; reserveCount: number }>(
        'DELETE', `/api/mp/works/${encodeURIComponent(this.data.slug)}/reservation`, undefined, { auth: 'required' },
      )
      this.setData({ reserved: res.reserved, mainLabel: '预约上线提醒' })
      track('reserve', { w: this.data.slug, v: 0 })
    } catch (err) {
      wx.showToast({ title: (err as { message?: string }).message || '操作失败', icon: 'none' })
    }
  },

  onChapterUpdate() {
    wx.requestSubscribeMessage({
      tmplIds: [TPL_CHAPTER_UPDATE],
      success: (res) => {
        if (res[TPL_CHAPTER_UPDATE] !== 'accept') return
        request('POST', '/api/mp/subscriptions', { slug: this.data.slug, kind: 'chapter_update', accepted: true }, { auth: 'required' })
          .then(() => { wx.showToast({ title: '已开启，新章节上线时会通知你一次', icon: 'none' }) })
          .catch(() => { wx.showToast({ title: '操作失败', icon: 'none' }) })
      },
      fail: () => {},
    })
  },

  async onFavorite() {
    try {
      await ensureLogin()
      const method = this.data.favorited ? 'DELETE' : 'PUT'
      const res = await request<{ favorited: boolean }>(
        method, `/api/mp/works/${encodeURIComponent(this.data.slug)}/favorite`, undefined, { auth: 'required' },
      )
      this.setData({ favorited: res.favorited })
      track('favorite', { w: this.data.slug, v: res.favorited ? 1 : 0 })
    } catch (err) {
      wx.showToast({ title: (err as { message?: string }).message || '操作失败', icon: 'none' })
    }
  },

  onMenu() {
    wx.showActionSheet({
      itemList: ['举报'],
      success: (res) => {
        if (res.tapIndex === 0) this.setData({ reportShow: true })
      },
    })
  },

  onReportClose() {
    this.setData({ reportShow: false })
  },

  async onRatingSubmit(e: WechatMiniprogram.CustomEvent) {
    const score = Number((e.detail as { score: number }).score)
    const promptedKey = `mp.rated.prompted:${this.data.slug}`
    try {
      await request('PUT', `/api/mp/works/${encodeURIComponent(this.data.slug)}/rating`, { score }, { auth: 'required' })
      wxStorage.setItem(promptedKey, '1')
      this.setData({ ratingShow: false })
      track('rate', { w: this.data.slug, v: score })
      wx.showToast({ title: '已评分', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: (err as { message?: string }).message || '评分失败', icon: 'none' })
    }
  },

  onRatingClose() {
    wxStorage.setItem(`mp.rated.prompted:${this.data.slug}`, '1')
    this.setData({ ratingShow: false })
  },

  onShareTap() {
    this.setData({ shareShow: true })
  },

  onShareClose() {
    this.setData({ shareShow: false })
  },

  onSharePoster() {
    this.setData({ shareShow: false })
    const work = this.data.detail?.work
    if (!work) return
    const maker = this.selectComponent('#poster') as { make?: (payload: PosterPayload) => void } | null
    maker?.make?.({
      kind: 'work',
      slug: this.data.slug,
      workTitle: work.title,
      tagline: work.tagline,
      tags: work.tags,
      background: work.cover,
    })
  },

  onShareAppMessage() {
    const work = this.data.detail?.work
    if (!work) return { title: BRAND_NAME, path: '/pages/home/index' }
    const id = generateShareId()
    registerShare(id, this.data.slug, 'work')
    track('share_click', { w: this.data.slug, o: 'work' })
    return {
      title: workShareTitle(work.title, work.tagline),
      path: workSharePath(this.data.slug, id),
      imageUrl: work.shareCover,
    }
  },

  onShareTimeline() {
    const work = this.data.detail?.work
    if (!work) return { title: BRAND_NAME }
    const id = generateShareId()
    registerShare(id, this.data.slug, 'timeline')
    track('share_click', { w: this.data.slug, o: 'timeline' })
    return {
      title: workShareTitle(work.title, work.tagline),
      query: timelineQuery(this.data.slug, id),
      imageUrl: work.cover,
    }
  },

  goCollection() {
    wx.navigateTo({ url: `/pages/collection/index?w=${encodeURIComponent(this.data.slug)}` })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
