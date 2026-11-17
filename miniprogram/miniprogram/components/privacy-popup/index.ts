import { onPrivacyPrompt, openPrivacyContract, resolvePrivacy } from '../../lib/privacy'

let unsub: (() => void) | null = null

Component({
  data: {
    show: false,
  },
  lifetimes: {
    attached() {
      unsub = onPrivacyPrompt((show) => this.setData({ show }))
    },
    detached() {
      if (unsub) {
        unsub()
        unsub = null
      }
    },
  },
  methods: {
    onContract() {
      openPrivacyContract()
    },
    onDisagree() {
      resolvePrivacy('disagree')
    },
    onAgree() {
      resolvePrivacy('agree', 'agree-btn')
    },
  },
})
