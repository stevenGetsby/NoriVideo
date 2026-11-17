Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  methods: {
    onClose() {
      this.triggerEvent('close')
    },
    onPoster() {
      this.triggerEvent('poster')
    },
    noop() {},
  },
})
