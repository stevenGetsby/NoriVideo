interface SlotView {
  savedAt?: number
  timeText?: string
  chapter?: string
  node?: string
  valid?: boolean
  empty?: boolean
  index?: number
  key?: string
}

interface Row {
  index: number
  filled: boolean
  valid: boolean
  label: string
  timeText: string
}

interface CheckpointRow {
  key: string
  valid: boolean
  label: string
  timeText: string
}

Component({
  properties: {
    saves: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
    embedded: { type: Boolean, value: false },
  },
  data: {
    autoView: { filled: false, valid: false, label: '还没有自动存档', timeText: '到达可继续的剧情时会自动保存' },
    slotViews: [] as Row[],
    checkpointViews: [] as CheckpointRow[],
  },
  observers: {
    saves(saves: { auto?: SlotView | null; slots?: SlotView[]; checkpoints?: SlotView[] } | null) {
      if (!saves) return
      const auto = saves.auto
      this.setData({
        autoView: {
          filled: Boolean(auto),
          valid: auto?.valid === true,
          label: auto ? `${auto.chapter} · ${auto.node}` : '还没有自动存档',
          timeText: auto ? auto.timeText || '' : '到达可继续的剧情时会自动保存',
        },
        slotViews: (saves.slots || []).map((slot) => {
          const filled = slot.empty !== true
          return {
            index: slot.index ?? 0,
            filled,
            valid: slot.valid === true,
            label: filled ? `${slot.chapter} · ${slot.node}` : '空存档位',
            timeText: filled ? slot.timeText || '' : '随时保存当前进度',
          }
        }),
        checkpointViews: (saves.checkpoints || []).map((slot) => ({
          key: slot.key ?? '',
          valid: slot.valid === true,
          label: `${slot.chapter} · ${slot.node}`,
          timeText: slot.timeText || '',
        })),
      })
    },
  },
  methods: {
    onResume() {
      this.triggerEvent('resume')
    },
    onSave(e: { currentTarget: { dataset: { index: number } } }) {
      this.triggerEvent('save', { index: Number(e.currentTarget.dataset.index) })
    },
    onLoad(e: { currentTarget: { dataset: { index: number } } }) {
      this.triggerEvent('load', { index: Number(e.currentTarget.dataset.index) })
    },
    onDelete(e: { currentTarget: { dataset: { index: number } } }) {
      this.triggerEvent('delete', { index: Number(e.currentTarget.dataset.index) })
    },
    onCheckpoint(e: { currentTarget: { dataset: { key: string } } }) {
      this.triggerEvent('checkpoint', { key: e.currentTarget.dataset.key })
    },
    onClose() {
      this.triggerEvent('close')
    },
  },
})