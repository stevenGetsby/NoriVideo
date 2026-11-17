Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
  },
  data: {
    selected: 0,
    stars: [1, 2, 3, 4, 5],
  },
  methods: {
    onStar(e: WechatMiniprogram.TouchEvent) {
      this.setData({ selected: Number(e.currentTarget.dataset.score) })
    },
    onSubmit() {
      if (this.data.selected > 0) this.triggerEvent('submit', { score: this.data.selected })
    },
    onClose() {
      this.triggerEvent('close')
    },
    noop() {},
  },
})
