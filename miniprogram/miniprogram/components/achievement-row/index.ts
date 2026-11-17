interface AchievementItem {
  id: string
  name: string
  icon: string | null
  achieved: boolean
}

Component({
  properties: {
    achievements: { type: Array, value: [] },
    got: { type: Array, value: [] },
  },
  data: {
    items: [] as AchievementItem[],
  },
  observers: {
    'achievements, got'(achievements: Array<{ id: string; name: string; icon: string | null }>, got: string[]) {
      const gotSet = new Set(got || [])
      const items: AchievementItem[] = (achievements || []).map((a) => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        achieved: gotSet.has(a.id),
      }))
      this.setData({ items })
    },
  },
})
