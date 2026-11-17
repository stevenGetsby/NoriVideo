import { choiceOptionParts, resolveChoiceLayout } from '../../../runtime/story-runtime'

interface OptionIn {
  id: string
  label: string
  imageUrl?: string | null
  locked?: boolean
}

interface OptionView {
  id: string
  label: string
  image: string | null
  showImage: boolean
  showText: boolean
  locked: boolean
}

Component({
  properties: {
    prompt: { type: String, value: '' },
    options: { type: Array, value: [] },
    panelStyle: { type: String, value: 'mixed' },
    layout: { type: String, value: 'auto' },
    orientation: { type: String, value: 'portrait' },
    countdownPercent: { type: Number, value: -1 },
    durationSec: { type: Number, value: 0 },
    lockedHint: { type: Boolean, value: false },
  },
  data: {
    resolved: 'vertical',
    textOnly: true,
    count: 1,
    views: [] as OptionView[],
    showCountdown: false,
    countdownLeft: 0,
  },
  observers: {
    'options, panelStyle, layout, orientation'(
      options: OptionIn[],
      panelStyle: string,
      layout: string,
      orientation: string,
    ) {
      const opts = options || []
      const resolved = resolveChoiceLayout(
        layout as Parameters<typeof resolveChoiceLayout>[0],
        orientation as Parameters<typeof resolveChoiceLayout>[1],
      )
      const views: OptionView[] = opts.map((option, index) => {
        const part = choiceOptionParts(panelStyle as Parameters<typeof choiceOptionParts>[0], option)
        return {
          id: option.id,
          label: (option.label || '').trim() || `选项${index + 1}`,
          image: part.image ? option.imageUrl || null : null,
          showImage: part.image && Boolean(option.imageUrl),
          showText: part.text || !option.imageUrl,
          locked: option.locked === true,
        }
      })
      this.setData({
        resolved,
        views,
        textOnly: views.every((view) => !view.showImage),
        count: Math.min(Math.max(opts.length, 1), 6),
      })
    },
    'countdownPercent, durationSec'(percent: number, durationSec: number) {
      if (percent >= 0 && durationSec > 0) {
        this.setData({ showCountdown: true, countdownLeft: Math.ceil((percent / 100) * durationSec) })
      } else {
        this.setData({ showCountdown: false })
      }
    },
  },
  methods: {
    onChoose(e: { currentTarget: { dataset: { id: string } } }) {
      this.triggerEvent('choose', { optionId: e.currentTarget.dataset.id })
    },
  },
})