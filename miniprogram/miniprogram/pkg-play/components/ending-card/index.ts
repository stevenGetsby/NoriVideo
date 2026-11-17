Component({
  properties: {
    ending: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  methods: {
    onPoster() {
      this.triggerEvent('poster')
    },
    onRestart() {
      this.triggerEvent('restart')
    },
    onSaves() {
      this.triggerEvent('saves')
    },
    onBack() {
      this.triggerEvent('back')
    },
  },
})
