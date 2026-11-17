import { mediaContainBox } from '../../../runtime/story-runtime'

interface Rect {
  left: number
  top: number
  w: number
  h: number
}

interface TouchLike {
  clientX: number
  clientY: number
}

interface TouchEventLike {
  touches: TouchLike[]
  changedTouches: TouchLike[]
}

/**
 * 互动层：采集手势转发给 controller（pointerDown/Move/Up），按 kind 渲染对应互动垫。
 * 舞台 rect 由 story-player 量好传入；热区 contain-box 在此计算。判定公式全部在 controller，不在此重写。
 */
Component({
  properties: {
    interaction: { type: Object, value: {} },
    mediaW: { type: Number, value: 0 },
    mediaH: { type: Number, value: 0 },
    orientation: { type: String, value: 'portrait' },
    lockedHint: { type: Boolean, value: false },
    stageRect: { type: Object, value: { left: 0, top: 0, w: 0, h: 0 } },
  },
  data: {
    box: null as null | { left: number; top: number; width: number; height: number },
    showCountdown: false,
    countdownLeft: 0,
  },
  observers: {
    'interaction, mediaW, mediaH, stageRect'(
      ix: { kind?: string; countdownPercent?: number; durationSec?: number } | null,
      mw: number,
      mh: number,
      rect: Rect,
    ) {
      if (ix && ix.kind === 'hotspot' && rect.w > 0 && rect.h > 0 && mw > 0 && mh > 0) {
        this.setData({ box: mediaContainBox(rect.w, rect.h, mw, mh) })
      } else if (this.data.box) {
        this.setData({ box: null })
      }
      if (ix && ix.kind !== 'choice' && typeof ix.countdownPercent === 'number' && (ix.durationSec ?? 0) > 0) {
        this.setData({
          showCountdown: true,
          countdownLeft: Math.ceil((ix.countdownPercent / 100) * (ix.durationSec ?? 0)),
        })
      } else if (this.data.showCountdown) {
        this.setData({ showCountdown: false })
      }
    },
  },
  methods: {
    point(e: TouchEventLike) {
      const touch = e.touches[0] || e.changedTouches[0]
      const rect = this.data.stageRect as Rect
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    },
    onTouchStart(e: TouchEventLike) {
      this.triggerEvent('pointerdown', this.point(e))
    },
    onTouchMove(e: TouchEventLike) {
      this.triggerEvent('pointermove', this.point(e))
    },
    onTouchEnd(e: TouchEventLike) {
      this.triggerEvent('pointerup', this.point(e))
    },
    onChoose(e: { detail: { optionId: string } }) {
      this.triggerEvent('choose', e.detail)
    },
  },
})