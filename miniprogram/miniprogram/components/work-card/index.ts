import { formatCount } from '../../lib/format'

Component({
  properties: {
    card: { type: Object, value: {} },
    progress: { type: Number, value: -1 },
    endingsGot: { type: Number, value: 0 },
    variant: { type: String, value: 'grid' },
  },
  data: {
    playersText: '0',
  },
  observers: {
    card(card: { players?: number }) {
      this.setData({ playersText: formatCount(card && card.players ? card.players : 0) })
    },
  },
  methods: {
    onTap() {
      const card = this.data.card as { slug: string; status: string }
      this.triggerEvent('tap', { slug: card.slug, status: card.status })
    },
  },
})
