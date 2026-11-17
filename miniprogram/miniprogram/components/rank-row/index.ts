Component({
  properties: {
    rank: { type: Number, value: 0 },
    card: { type: Object, value: {} },
    metric: { type: String, value: '' },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { slug: (this.data.card as { slug: string }).slug })
    },
  },
})
