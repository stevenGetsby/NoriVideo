Component({
  properties: {
    ending: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  methods: {
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
