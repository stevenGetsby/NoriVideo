import { request } from '../../lib/api'
import { ensureLogin } from '../../lib/auth'
import type { MpMe } from '../../lib/types'

Page({
  data: {
    user: null as MpMe | null,
    avatar: '',
    loading: true,
    error: false,
    needLogin: false,
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: false, needLogin: false })
    try {
      await ensureLogin()
      const user = await request<MpMe>('GET', '/api/mp/me', undefined, { auth: 'required' })
      this.setData({ loading: false, user, avatar: `/assets/avatars/a${user.avatarIndex}.png` })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'MP_TIMELINE') this.setData({ loading: false, needLogin: true })
      else this.setData({ loading: false, error: true })
    }
  },

  onLogin() {
    this.load()
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/profile-edit/index' })
  },
  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' })
  },
  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/index' })
  },
  goReservations() {
    wx.navigateTo({ url: '/pages/reservations/index' })
  },
  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },
})
