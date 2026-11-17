import { setupPrivacy } from './lib/privacy'
import { flushTrack, initTrack, noteShow } from './lib/track'

App({
  onLaunch(options) {
    setupPrivacy()
    initTrack(options)
  },
  onShow(options) {
    noteShow(options)
  },
  onHide() {
    flushTrack()
  },
})
