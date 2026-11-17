Component({
  properties: {
    scene: { type: Object, value: {} },
  },
  methods: {
    onContinue() {
      this.triggerEvent('continue')
    },
  },
})