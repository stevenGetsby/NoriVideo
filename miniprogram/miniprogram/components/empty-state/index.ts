Component({
  properties: {
    text: { type: String, value: '' },
    button: { type: String, value: '' },
  },
  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
