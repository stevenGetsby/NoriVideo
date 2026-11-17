interface HudVar {
  id: string
  name: string
  icon: string | null
  type: string
  value: unknown
}

interface VarView {
  id: string
  name: string
  icon: string
  iconIsImage: boolean
  valueText: string
}

Component({
  properties: {
    hud: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  data: {
    varViews: [] as VarView[],
  },
  observers: {
    hud(hud: { vars?: HudVar[] } | null) {
      const vars = hud?.vars || []
      this.setData({
        varViews: vars.map((variable) => ({
          id: variable.id,
          name: variable.name,
          icon: variable.icon || '',
          iconIsImage: /^https?:\/\//.test(variable.icon || ''),
          valueText: variable.type === 'boolean' ? (variable.value ? '是' : '否') : String(variable.value),
        })),
      })
    },
  },
  methods: {
    onBack() {
      this.triggerEvent('back')
    },
    onSpeed() {
      this.triggerEvent('speed')
    },
    onSaves() {
      this.triggerEvent('saves')
    },
    onShop() {
      this.triggerEvent('shop')
    },
    onAchievements() {
      this.triggerEvent('achievements')
    },
  },
})