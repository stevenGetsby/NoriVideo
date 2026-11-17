interface EndingCell {
  key: string
  label: string
  type: string
  locked: boolean
}

Component({
  properties: {
    endings: { type: Array, value: [] },
    got: { type: Array, value: [] },
    columns: { type: Number, value: 4 },
  },
  data: {
    cells: [] as EndingCell[],
  },
  observers: {
    'endings, got'(endings: Array<{ nodeId: string; endingType: string; title: string | null }>, got: string[]) {
      const gotSet = new Set(got || [])
      const cells: EndingCell[] = (endings || []).map((e) => {
        const achieved = gotSet.has(e.nodeId)
        const locked = e.endingType === 'hidden' && !achieved
        return {
          key: e.nodeId,
          label: achieved ? (e.title || '结局') : (locked ? '隐藏结局' : '???'),
          type: e.endingType,
          locked,
        }
      })
      this.setData({ cells })
    },
  },
})
