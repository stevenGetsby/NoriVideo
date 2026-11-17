type Slot = 'a' | 'b'

interface VideoDetail {
  currentTime: number
  duration: number
}

interface SlotEvent {
  currentTarget: { dataset: { slot: Slot } }
  detail: VideoDetail
}

interface SlotOnlyEvent {
  currentTarget: { dataset: { slot: Slot } }
}

/**
 * 双视频槽舞台：同一时刻只有 a、b 两个 <video>，永不超过 2 个。
 * 实现 VideoPort，由 story-player 通过 selectComponent 调用；视频事件经 triggerEvent 转发给 controller。
 * 切槽用 opacity / z-index，不用 wx:if。备用槽（预加载）静音。
 */
Component({
  properties: {
    imageOverlay: { type: String, value: '' },
    mediaError: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  data: {
    aSrc: '',
    aPoster: '',
    bSrc: '',
    bPoster: '',
    activeSlot: 'a' as Slot,
    lastFrameUrl: '',
  },
  methods: {
    context(slot: Slot) {
      return wx.createVideoContext(slot, this)
    },
    load(slot: Slot, src: string, poster: string | null, initialSec: number) {
      if (slot === 'a') this.setData({ aSrc: src, aPoster: poster || '' })
      else this.setData({ bSrc: src, bPoster: poster || '' })
      if (initialSec > 0) this.context(slot).seek(initialSec)
    },
    play(slot: Slot) {
      this.context(slot).play()
    },
    pause(slot: Slot) {
      this.context(slot).pause()
    },
    seek(slot: Slot, sec: number) {
      this.context(slot).seek(sec)
    },
    setRate(slot: Slot, rate: number) {
      this.context(slot).playbackRate(rate)
    },
    show(slot: Slot) {
      this.setData({ activeSlot: slot })
    },
    setLastFrame(url: string | null) {
      this.setData({ lastFrameUrl: url || '' })
    },
    onTimeUpdate(e: SlotEvent) {
      this.triggerEvent('timeupdate', {
        slot: e.currentTarget.dataset.slot,
        currentSec: e.detail.currentTime,
        durationSec: e.detail.duration,
      })
    },
    onEnded(e: SlotOnlyEvent) {
      this.triggerEvent('ended', { slot: e.currentTarget.dataset.slot })
    },
    onWaiting(e: SlotOnlyEvent) {
      this.triggerEvent('waiting', { slot: e.currentTarget.dataset.slot })
    },
    onPlaying(e: SlotOnlyEvent) {
      this.triggerEvent('playing', { slot: e.currentTarget.dataset.slot })
    },
    onError(e: SlotOnlyEvent) {
      this.triggerEvent('error', { slot: e.currentTarget.dataset.slot })
    },
    onLoadedMetadata(e: SlotOnlyEvent) {
      this.triggerEvent('loadedmetadata', { slot: e.currentTarget.dataset.slot })
    },
    onRetry() {
      this.triggerEvent('retry')
    },
    onSkip() {
      this.triggerEvent('skip')
    },
  },
})