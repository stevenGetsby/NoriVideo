import { BRAND_NAME } from '../../config'
import { request } from '../../lib/api'
import { endingShareTitle, generateShareId, registerShare, timelineQuery, workSharePath, workShareTitle } from '../../lib/share'
import { track } from '../../lib/track'
import type { WorkDetail } from '../../lib/types'
import type { PosterPayload } from '../../components/poster-maker/index'

interface ShareMeta {
  title: string
  tagline: string
  cover: string
  shareCover: string
}

interface EndingInfo {
  nodeId: string
  title: string
  type: string
  rarityText?: string
}

Page({
  data: {
    slug: '',
    from: 'new',
    shareMeta: null as ShareMeta | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    const slug = options.w || ''
    this.setData({ slug, from: options.from || 'new' })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'], fail: () => {} })
    if (!slug) return
    request<WorkDetail>('GET', `/api/mp/works/${encodeURIComponent(slug)}`, undefined, { auth: 'optional' })
      .then((detail) => {
        const work = detail.work
        this.setData({ shareMeta: { title: work.title, tagline: work.tagline, cover: work.cover, shareCover: work.shareCover } })
      })
      .catch(() => {})
  },

  endingInfo(): EndingInfo | null {
    const player = this.selectComponent('#player') as { sharePayload?: () => { ending: EndingInfo | null; background: string } } | null
    return player?.sharePayload ? player.sharePayload().ending : null
  },

  onShareAppMessage() {
    const meta = this.data.shareMeta
    const slug = this.data.slug
    const id = generateShareId()
    const ending = this.endingInfo()
    if (ending && meta) {
      registerShare(id, slug, 'ending', ending.nodeId)
      track('share_click', { w: slug, o: 'ending' })
      return {
        title: endingShareTitle(meta.title, ending.title),
        path: workSharePath(slug, id),
        imageUrl: meta.shareCover || meta.cover,
      }
    }
    registerShare(id, slug, 'work')
    track('share_click', { w: slug, o: 'work' })
    return {
      title: meta ? workShareTitle(meta.title, meta.tagline) : BRAND_NAME,
      path: workSharePath(slug, id),
      imageUrl: meta?.shareCover || meta?.cover || '',
    }
  },

  onShareTimeline() {
    const meta = this.data.shareMeta
    const id = generateShareId()
    registerShare(id, this.data.slug, 'timeline')
    track('share_click', { w: this.data.slug, o: 'timeline' })
    return {
      title: meta ? workShareTitle(meta.title, meta.tagline) : BRAND_NAME,
      query: timelineQuery(this.data.slug, id),
      imageUrl: meta?.cover || '',
    }
  },

  onEndingPoster(e: { detail: EndingInfo & { background: string } }) {
    const meta = this.data.shareMeta
    if (!meta) {
      wx.showToast({ title: '海报生成失败，请重试', icon: 'none' })
      return
    }
    const maker = this.selectComponent('#poster') as { make?: (payload: PosterPayload) => void } | null
    maker?.make?.({
      kind: 'ending',
      slug: this.data.slug,
      workTitle: meta.title,
      tagline: meta.tagline,
      tags: [],
      background: e.detail.background || meta.cover,
      endingTitle: e.detail.title,
      endingType: e.detail.type,
      endingNodeId: e.detail.nodeId,
      rarityText: e.detail.rarityText || '',
    })
  },
})
