import { getUser } from '../../../lib/auth'

interface AchievementItem {
  id: string
  name: string
  description: string
  icon: string | null
  earned: boolean
  rewardText: string
}

interface Cosmetic {
  id: string
  name: string
  reward: { title?: string; frameUrl?: string | null }
}

interface ItemView {
  id: string
  name: string
  description: string
  icon: string
  iconIsImage: boolean
  iconText: string
  earned: boolean
  rewardText: string
  state: string
}

interface CosmeticView {
  id: string
  name: string
  part: 'title' | 'frame'
  label: string
  swatchText: string
  frameUrl: string
  equipped: boolean
}

Component({
  properties: {
    achievements: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  data: {
    avatar: '',
    frameUrl: '',
    titleText: '',
    progressText: '',
    headProgress: '',
    items: [] as ItemView[],
    hasCosmetics: false,
    titles: [] as CosmeticView[],
    frames: [] as CosmeticView[],
    hasFrameEquipped: false,
    hasTitleEquipped: false,
  },
  observers: {
    achievements(payload: {
      progress?: { earned: number; total: number }
      cosmetics?: Cosmetic[]
      equipped?: { title: string | null; frameUrl: string | null }
      equippedIds?: { title: string | null; frame: string | null }
      items?: AchievementItem[]
    } | null) {
      if (!payload || !payload.progress) return
      const user = getUser()
      const progress = payload.progress
      const equipped = payload.equipped ?? { title: null, frameUrl: null }
      const equippedIds = payload.equippedIds ?? { title: null, frame: null }
      const cosmetics = payload.cosmetics ?? []
      const items: ItemView[] = (payload.items ?? []).map((item) => {
        const name = item.name || '未命名成就'
        const icon = item.icon || ''
        const iconIsImage = /^https?:\/\//.test(icon)
        return {
          id: item.id,
          name,
          description: item.description,
          icon,
          iconIsImage,
          iconText: iconIsImage ? '' : icon || (item.earned ? name.trim().slice(0, 1) || '成' : '锁'),
          earned: item.earned,
          rewardText: item.rewardText,
          state: item.earned ? '已达成' : '未达成',
        }
      })
      const toRow = (cosmetic: Cosmetic, part: 'title' | 'frame'): CosmeticView => ({
        id: cosmetic.id,
        name: cosmetic.name,
        part,
        label: part === 'title' ? `称号「${cosmetic.reward.title}」` : '头像框',
        swatchText: part === 'title' ? cosmetic.reward.title || '' : '',
        frameUrl: part === 'frame' ? cosmetic.reward.frameUrl || '' : '',
        equipped: (part === 'title' ? equippedIds.title : equippedIds.frame) === cosmetic.id,
      })
      const titles = cosmetics.filter((item) => Boolean(item.reward.title)).map((item) => toRow(item, 'title'))
      const frames = cosmetics.filter((item) => Boolean(item.reward.frameUrl)).map((item) => toRow(item, 'frame'))
      this.setData({
        avatar: user ? `/assets/avatars/a${user.avatarIndex}.png` : '',
        frameUrl: equipped.frameUrl || '',
        titleText: equipped.title ? `称号「${equipped.title}」` : '还没有佩戴称号',
        progressText: `已达成 ${progress.earned} / ${progress.total}`,
        headProgress: `${progress.earned}/${progress.total}`,
        items,
        hasCosmetics: cosmetics.length > 0,
        titles,
        frames,
        hasFrameEquipped: Boolean(equippedIds.frame),
        hasTitleEquipped: Boolean(equippedIds.title),
      })
    },
  },
  methods: {
    onEquip(e: { currentTarget: { dataset: { part: string; id: string; equipped: number } } }) {
      const { part, id, equipped } = e.currentTarget.dataset
      this.triggerEvent('equip', { part, cosmeticId: Number(equipped) === 1 ? null : id })
    },
    onUnequipGroup(e: { currentTarget: { dataset: { part: string } } }) {
      this.triggerEvent('equip', { part: e.currentTarget.dataset.part, cosmeticId: null })
    },
    onClose() {
      this.triggerEvent('close')
    },
  },
})
