import { BRAND_NAME } from '../../config'
import { clearProgramCache } from '../../lib/program-cache'
import { getSettings, setSettings, type Quality } from '../../lib/settings'

Page({
  data: {
    brand: BRAND_NAME,
    quality: 'auto' as Quality,
    qualityOptions: [
      { k: 'auto', label: '自动' },
      { k: '480', label: '流畅 480P' },
      { k: '720', label: '高清 720P' },
    ] as { k: Quality; label: string }[],
    autoplayOnCellular: false,
  },

  onLoad() {
    const s = getSettings()
    this.setData({ quality: s.quality, autoplayOnCellular: s.autoplayOnCellular })
  },

  onQuality(e: WechatMiniprogram.TouchEvent) {
    const quality = String(e.currentTarget.dataset.k) as Quality
    setSettings({ quality })
    this.setData({ quality })
  },

  onAutoplay(e: WechatMiniprogram.SwitchChange) {
    const autoplayOnCellular = e.detail.value
    setSettings({ autoplayOnCellular })
    this.setData({ autoplayOnCellular })
  },

  onClearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '只清除作品缓存，不会删除你的存档。',
      confirmText: '清除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        clearProgramCache()
        wx.showToast({ title: '已清除', icon: 'none' })
      },
    })
  },

  goDoc(e: WechatMiniprogram.TouchEvent) {
    const k = String(e.currentTarget.dataset.k)
    wx.navigateTo({ url: `/pages/doc/index?k=${k}` })
  },
})
