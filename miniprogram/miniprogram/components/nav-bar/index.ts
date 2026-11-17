Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false },
  },
  data: {
    statusBarHeight: 0,
    barHeight: 44,
  },
  lifetimes: {
    attached() {
      const win = wx.getWindowInfo()
      const menu = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = win.statusBarHeight || 0
      const barHeight = (menu.height || 32) + 2 * ((menu.top || statusBarHeight) - statusBarHeight)
      this.setData({ statusBarHeight, barHeight })
    },
  },
  methods: {
    onBack() {
      this.triggerEvent('back')
    },
  },
})
