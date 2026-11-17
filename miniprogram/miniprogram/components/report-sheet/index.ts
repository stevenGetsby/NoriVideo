import { request } from '../../lib/api'

const REASONS = [
  { value: 'vulgar', label: '低俗色情' },
  { value: 'violence', label: '暴力血腥' },
  { value: 'politics', label: '政治敏感' },
  { value: 'copyright', label: '侵犯版权' },
  { value: 'minor', label: '不适合未成年人' },
  { value: 'other', label: '其他' },
]

Component({
  properties: {
    show: { type: Boolean, value: false },
    slug: { type: String, value: '' },
  },
  data: {
    reasons: REASONS,
    reason: '',
    detail: '',
    submitting: false,
  },
  methods: {
    onReason(e: WechatMiniprogram.TouchEvent) {
      this.setData({ reason: String(e.currentTarget.dataset.value) })
    },
    onDetail(e: WechatMiniprogram.Input) {
      this.setData({ detail: e.detail.value })
    },
    onClose() {
      this.triggerEvent('close')
    },
    noop() {},
    async onSubmit() {
      if (!this.data.reason || this.data.submitting) return
      this.setData({ submitting: true })
      try {
        await request('POST', '/api/mp/reports', {
          slug: this.data.slug,
          reason: this.data.reason,
          detail: this.data.detail || undefined,
        }, { auth: 'required' })
        wx.showToast({ title: '已收到，我们会尽快处理', icon: 'none' })
        this.setData({ reason: '', detail: '', submitting: false })
        this.triggerEvent('close')
      } catch (err) {
        this.setData({ submitting: false })
        wx.showToast({ title: (err as { message?: string }).message || '提交失败，请重试', icon: 'none' })
      }
    },
  },
})
