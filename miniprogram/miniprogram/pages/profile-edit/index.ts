import { request } from '../../lib/api'
import { ensureLogin, setUser } from '../../lib/auth'
import type { MpMe } from '../../lib/types'

const AVATARS = Array.from({ length: 8 }, (_, i) => ({ index: i, src: `/assets/avatars/a${i}.png` }))

Page({
  data: {
    avatars: AVATARS,
    nickname: '',
    avatarIndex: 0,
    loading: true,
    error: false,
    needLogin: false,
    saving: false,
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: false, needLogin: false })
    try {
      const user = await ensureLogin()
      this.setData({ loading: false, nickname: user.nickname, avatarIndex: user.avatarIndex })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'MP_TIMELINE') this.setData({ loading: false, needLogin: true })
      else this.setData({ loading: false, error: true })
    }
  },

  onLogin() {
    this.load()
  },

  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value })
  },

  onPickAvatar(e: WechatMiniprogram.TouchEvent) {
    this.setData({ avatarIndex: Number(e.currentTarget.dataset.index) })
  },

  async onSave() {
    if (this.data.saving) return
    const nickname = this.data.nickname.trim()
    const len = [...nickname].length
    if (len < 2 || len > 16) {
      wx.showToast({ title: '昵称需要 2–16 字', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const user = await request<MpMe>('PATCH', '/api/mp/me', { nickname, avatarIndex: this.data.avatarIndex }, { auth: 'required' })
      setUser(user)
      wx.showToast({ title: '已保存', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (err) {
      const code = (err as { code?: string }).code
      const message = code === 'MP_CONTENT_RISKY' ? '昵称包含不合适的内容，请修改' : ((err as { message?: string }).message || '保存失败')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
