interface MapPoint {
  key: string
  name: string
  coverUrl: string | null
  unlocked: boolean
  current: boolean
  rank: number
}

interface MapRoute {
  from: string
  to: string
  lit: boolean
}

interface PlacedPoint extends MapPoint {
  x: number
  y: number
  cover: string
  canResume: boolean
}

interface PlacedRoute {
  key: string
  lit: boolean
  x1: number
  y1: number
  length: number
  angle: number
}

const POINT_W = 200
const POINT_H = 140
const COL_GAP = 240
const ROW_GAP = 180
const PAD = 24

Component({
  properties: {
    mapSheet: { type: Object, value: {} },
    orientation: { type: String, value: 'portrait' },
  },
  data: {
    tab: 'map',
    points: [] as PlacedPoint[],
    routes: [] as PlacedRoute[],
    width: 0,
    height: 0,
    pointW: POINT_W,
    pointH: POINT_H,
  },
  observers: {
    mapSheet(ms: {
      map?: { points?: MapPoint[]; routes?: MapRoute[] }
      saves?: { checkpoints?: { key: string }[] }
    } | null) {
      if (!ms || !ms.map) return
      const rows = new Map<number, number>()
      const cpKeys = new Set((ms.saves?.checkpoints || []).map((slot) => slot.key))
      const placed: PlacedPoint[] = (ms.map.points || []).map((point) => {
        const row = rows.get(point.rank) ?? 0
        rows.set(point.rank, row + 1)
        return {
          ...point,
          x: PAD + point.rank * COL_GAP,
          y: PAD + row * ROW_GAP,
          cover: point.unlocked && point.coverUrl ? point.coverUrl : '',
          canResume: point.unlocked && cpKeys.has(point.key),
        }
      })
      const at = new Map(placed.map((point) => [point.key, point]))
      const maxRank = placed.reduce((max, point) => Math.max(max, point.rank), 0)
      const maxRows = [...rows.values()].reduce((max, count) => Math.max(max, count), 1)
      const routes: PlacedRoute[] = []
      for (const route of ms.map.routes || []) {
        const from = at.get(route.from)
        const to = at.get(route.to)
        if (!from || !to) continue
        const x1 = from.x + POINT_W
        const y1 = from.y + POINT_H / 2
        const dx = to.x - x1
        const dy = to.y + POINT_H / 2 - y1
        routes.push({
          key: `${route.from}->${route.to}`,
          lit: route.lit,
          x1,
          y1,
          length: Math.hypot(dx, dy),
          angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        })
      }
      this.setData({
        points: placed,
        routes,
        width: PAD * 2 + (maxRank + 1) * COL_GAP - (COL_GAP - POINT_W),
        height: PAD * 2 + maxRows * ROW_GAP,
      })
    },
  },
  methods: {
    onTabMap() {
      this.setData({ tab: 'map' })
    },
    onTabSaves() {
      this.setData({ tab: 'saves' })
    },
    onCheckpoint(e: { detail: { key: string } }) {
      this.triggerEvent('checkpoint', e.detail)
    },
    onResume() {
      this.triggerEvent('resume')
    },
    onSave(e: { detail: { index: number } }) {
      this.triggerEvent('save', e.detail)
    },
    onLoad(e: { detail: { index: number } }) {
      this.triggerEvent('load', e.detail)
    },
    onDelete(e: { detail: { index: number } }) {
      this.triggerEvent('delete', e.detail)
    },
    onClose() {
      this.triggerEvent('close')
    },
  },
})