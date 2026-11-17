import { STORY_SWIPE_LABEL } from '../../../runtime/story-runtime'

Component({
  properties: {
    interaction: { type: Object, value: {} },
  },
  data: {
    btnText: '',
    tip: '',
  },
  observers: {
    interaction(ix: { kind?: string; spec?: { direction?: string; buttonText?: string } } | null) {
      if (!ix || ix.kind !== 'swipe' || !ix.spec) return
      const label = STORY_SWIPE_LABEL[(ix.spec.direction || 'up') as keyof typeof STORY_SWIPE_LABEL] || '向上'
      this.setData({
        btnText: (ix.spec.buttonText || '').trim() || `${label}滑动`,
        tip: `按住拖动，${label}`,
      })
    },
  },
})