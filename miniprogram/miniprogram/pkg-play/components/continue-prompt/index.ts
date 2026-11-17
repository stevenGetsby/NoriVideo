Component({
  properties: {
    promptMode: { type: String, value: 'none' },
    prompt: { type: Object, value: {} },
  },
  methods: {
    onResume() {
      this.triggerEvent('resume')
    },
    onRestart() {
      this.triggerEvent('restart')
    },
  },
})
