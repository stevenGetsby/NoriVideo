import { request } from '../../../lib/api'
import { resolveQuality } from '../../../lib/network'
import { loadProgram } from '../../../lib/program-cache'
import { pullSave, pushSave } from '../../../lib/save-sync'
import { wxStorage } from '../../../lib/storage'
import { flushTrack, track } from '../../../lib/track'
import type { PlayManifest } from '../../../lib/types'
import { PausableClock } from '../../lib/clock'
import { PlayerController, type SyncReason, type VideoPort } from '../../lib/player-controller'
import type { StoryProgram } from '../../../runtime/story-runtime'

const VIEW_THROTTLE_MS = 33
const MP_TOKEN = /^mp:([0-9a-f]{16})$/
const EXIT_MESSAGE = '退出前会自动存档，确定退出吗？'
const FROM_PATTERN = /^(new|resume|slot:\d+|checkpoint:.+)$/

/** 非序列化实例状态：controller、manifest、节流计时器等绝不进 data。 */
interface PlayerState {
  controller: PlayerController | null
  manifest: PlayManifest | null
  slug: string
  releaseId: string
  baseRev: number
  quality: '720' | '480'
  pendingView: Record<string, unknown> | null
  viewTimer: ReturnType<typeof setTimeout> | null
  lastViewFlush: number
  disposed: boolean
  booting: boolean
}

const states = new WeakMap<object, PlayerState>()

function stateOf(self: object): PlayerState {
  let state = states.get(self)
  if (!state) {
    state = {
      controller: null,
      manifest: null,
      slug: '',
      releaseId: '',
      baseRev: 0,
      quality: '720',
      pendingView: null,
      viewTimer: null,
      lastViewFlush: 0,
      disposed: false,
      booting: false,
    }
    states.set(self, state)
  }
  return state
}

Component({
  properties: {
    slug: { type: String, value: '' },
    from: { type: String, value: 'new' },
    orientation: { type: String, value: 'portrait' },
  },
  data: {
    ready: false,
    error: '',
    stageRect: { left: 0, top: 0, w: 0, h: 0 },
    stopKind: '',
    mediaW: 0,
    mediaH: 0,
    imageOverlay: '',
    loading: false,
    mediaError: false,
    aigc: 'AI 生成',
    promptMode: 'none',
    prompt: null as Record<string, unknown> | null,
    continueNotice: null as string | null,
    lockedHint: false,
    sheet: null as string | null,
    toast: null as Record<string, unknown> | null,
    hud: null as Record<string, unknown> | null,
    scene: null as Record<string, unknown> | null,
    choice: null as Record<string, unknown> | null,
    interaction: null as Record<string, unknown> | null,
    ending: null as Record<string, unknown> | null,
    card: null as Record<string, unknown> | null,
    shop: null as Record<string, unknown> | null,
    savesSheet: null as Record<string, unknown> | null,
    mapSheet: null as Record<string, unknown> | null,
  },
  lifetimes: {
    attached() {
      stateOf(this).slug = this.data.slug
      this.boot()
    },
    ready() {
      this.measureStage()
    },
    detached() {
      const state = stateOf(this)
      state.disposed = true
      if (state.viewTimer !== null) {
        clearTimeout(state.viewTimer)
        state.viewTimer = null
      }
      state.controller?.dispose()
      state.controller = null
      wx.setKeepScreenOn({ keepScreenOn: false })
      flushTrack()
    },
  },
  pageLifetimes: {
    show() {
      const state = stateOf(this)
      wx.setKeepScreenOn({ keepScreenOn: true })
      state.controller?.appShow()
      resolveQuality().then((quality) => {
        state.quality = quality === 480 ? '480' : '720'
      })
    },
    hide() {
      const state = stateOf(this)
      wx.setKeepScreenOn({ keepScreenOn: false })
      state.controller?.appHide()
      flushTrack()
    },
    resize() {
      this.measureStage()
    },
  },
  methods: {
    async boot() {
      const state = stateOf(this)
      if (state.booting || state.disposed) return
      state.booting = true
      this.setData({ ready: false, error: '' })
      const slug = this.data.slug
      if (!slug) {
        state.booting = false
        this.setData({ error: '缺少作品参数' })
        return
      }
      try {
        const [manifest, cloud] = await Promise.all([
          request<PlayManifest>('GET', `/api/mp/works/${encodeURIComponent(slug)}/play`, undefined, { auth: 'required' }),
          pullSave(slug).catch(() => null),
        ])
        const text = await loadProgram(manifest.releaseId, manifest.programHash, manifest.programUrl)
        const program = JSON.parse(text) as StoryProgram
        const quality = await resolveQuality()
        if (state.disposed) return
        state.manifest = manifest
        state.slug = slug
        state.releaseId = manifest.releaseId
        state.baseRev = cloud?.rev ?? 0
        state.quality = quality === 480 ? '480' : '720'
        this.setData({ ready: true }, () => this.initController(program))
      } catch (err) {
        if (state.disposed) return
        const message = (err as { message?: string }).message
        this.setData({ error: message || '加载失败，请重试' })
      } finally {
        state.booting = false
      }
    },

    initController(program: StoryProgram) {
      const state = stateOf(this)
      if (state.disposed || state.controller || !state.manifest) return
      const stage = this.selectComponent('#stage') as unknown as VideoPort | null
      if (!stage) {
        this.setData({ error: '播放器初始化失败' })
        return
      }
      const manifest = state.manifest
      state.controller = new PlayerController({
        program,
        media: manifest.media,
        slug: state.slug,
        releaseId: state.releaseId,
        storage: wxStorage,
        permanent: wxStorage,
        video: stage,
        view: { set: (patch) => this.queueView(patch) },
        clock: new PausableClock(() => Date.now()),
        now: () => Date.now(),
        quality: () => state.quality,
        track: (event) => track(event.name, { w: state.slug, r: state.releaseId, n: event.n, o: event.o, v: event.v, f: event.f }),
        haptic: () => { wx.vibrateShort({ type: 'light', fail: () => {} }) },
        branchStats: () => null,
        sync: (reason) => this.pushCloudSave(reason),
      })
      this.measureStage()
      wx.enableAlertBeforeUnload({ message: EXIT_MESSAGE })
      const from = this.data.from
      state.controller.start(FROM_PATTERN.test(from) ? (from as Parameters<PlayerController['start']>[0]) : 'new')
    },

    /* ---------- 视图端口：节流 + mp: 令牌解析 + 差量 setData ---------- */

    queueView(patch: Record<string, unknown>) {
      const state = stateOf(this)
      if (state.disposed) return
      const next = { ...patch }
      if ('sheet' in next) {
        if (next.sheet !== 'shop' && !('shop' in next)) next.shop = null
        if (next.sheet !== 'saves' && !('savesSheet' in next)) next.savesSheet = null
        if (next.sheet !== 'map' && !('mapSheet' in next)) next.mapSheet = null
        if (next.sheet !== 'achievements' && !('achievementsSheet' in next)) next.achievementsSheet = null
      }
      state.pendingView = next
      if (state.viewTimer !== null) return
      const delay = Math.max(0, VIEW_THROTTLE_MS - (Date.now() - state.lastViewFlush))
      state.viewTimer = setTimeout(() => {
        state.viewTimer = null
        this.flushView()
      }, delay)
    },

    flushView() {
      const state = stateOf(this)
      const patch = state.pendingView
      state.pendingView = null
      state.lastViewFlush = Date.now()
      if (!patch || state.disposed) return
      const resolved = this.resolveMediaTokens(patch)
      const current = this.data as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(resolved)) {
        const next = resolved[key]
        const prev = current[key]
        if (next === prev) continue
        if (next && prev && typeof next === 'object' && typeof prev === 'object' && JSON.stringify(next) === JSON.stringify(prev)) continue
        out[key] = next
      }
      if (Object.keys(out).length) this.setData(out as Partial<typeof this.data>)
    },

    /** released program 里的媒体引用是 mp:<16hex> 令牌，渲染前深解析成 CDN 地址。 */
    resolveMediaTokens(patch: Record<string, unknown>): Record<string, unknown> {
      const media = stateOf(this).manifest?.media
      const clone = JSON.parse(JSON.stringify(patch)) as unknown
      if (!media) return clone as Record<string, unknown>
      const walk = (node: unknown): unknown => {
        if (typeof node === 'string') {
          const match = MP_TOKEN.exec(node)
          if (!match) return node
          const entry = media[match[1]]
          return entry?.img ?? entry?.poster ?? ''
        }
        if (Array.isArray(node)) return node.map(walk)
        if (node && typeof node === 'object') {
          const out: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(node)) out[key] = walk(value)
          return out
        }
        return node
      }
      return walk(clone) as Record<string, unknown>
    },

    pushCloudSave(reason: SyncReason) {
      const state = stateOf(this)
      const controller = state.controller
      if (!controller) return
      pushSave(state.slug, { baseRev: state.baseRev, ...controller.savePayload() })
        .then((res) => { state.baseRev = Math.max(state.baseRev, res.rev) })
        .catch(() => {})
      if (reason === 'unload') flushTrack()
    },

    measureStage() {
      const state = stateOf(this)
      this.createSelectorQuery().select('.stage-wrap').boundingClientRect((rect) => {
        if (!rect || state.disposed) return
        this.setData({ stageRect: { left: rect.left, top: rect.top, w: rect.width, h: rect.height } })
        state.controller?.setStageRect(rect.width, rect.height)
      }).exec()
    },

    /* ---------- 视频事件 ---------- */

    onVideoTime(e: { detail: { slot: 'a' | 'b'; currentSec: number; durationSec: number } }) {
      stateOf(this).controller?.onTimeUpdate(e.detail.slot, e.detail.currentSec, e.detail.durationSec)
    },
    onVideoEnded(e: { detail: { slot: 'a' | 'b' } }) {
      stateOf(this).controller?.onEnded(e.detail.slot)
    },
    onVideoWaiting(e: { detail: { slot: 'a' | 'b' } }) {
      stateOf(this).controller?.onWaiting(e.detail.slot)
    },
    onVideoPlaying(e: { detail: { slot: 'a' | 'b' } }) {
      stateOf(this).controller?.onPlaying(e.detail.slot)
    },
    onVideoError(e: { detail: { slot: 'a' | 'b' } }) {
      stateOf(this).controller?.onError(e.detail.slot)
    },
    onVideoRetry() {
      stateOf(this).controller?.retryMedia()
    },
    onVideoSkip() {
      stateOf(this).controller?.skipSegment()
    },

    /* ---------- 剧情与互动 ---------- */

    onSceneContinue() {
      stateOf(this).controller?.skipSegment()
    },
    onPointerDown(e: { detail: { x: number; y: number } }) {
      stateOf(this).controller?.pointerDown(e.detail.x, e.detail.y)
    },
    onPointerMove(e: { detail: { x: number; y: number } }) {
      stateOf(this).controller?.pointerMove(e.detail.x, e.detail.y)
    },
    onPointerUp(e: { detail: { x: number; y: number } }) {
      stateOf(this).controller?.pointerUp(e.detail.x, e.detail.y)
    },
    onChoose(e: { detail: { optionId: string } }) {
      stateOf(this).controller?.choose(e.detail.optionId)
    },
    onPromptResume() {
      stateOf(this).controller?.resume()
    },
    onRestart() {
      stateOf(this).controller?.restart()
    },

    /* ---------- HUD 与弹层 ---------- */

    onSpeed() {
      stateOf(this).controller?.cycleSpeed()
    },
    onOpenSaves() {
      stateOf(this).controller?.openSheet('saves')
    },
    onOpenMap() {
      stateOf(this).controller?.openSheet('map')
    },
    onOpenShop() {
      stateOf(this).controller?.openSheet('shop')
    },
    onCloseSheet() {
      stateOf(this).controller?.closeSheet()
    },
    onBuy(e: { detail: { itemId: string } }) {
      stateOf(this).controller?.buy(e.detail.itemId)
    },
    onSaveSlot(e: { detail: { index: number } }) {
      stateOf(this).controller?.saveSlot(e.detail.index)
    },
    onLoadSlot(e: { detail: { index: number } }) {
      stateOf(this).controller?.loadSlot(e.detail.index)
    },
    onDeleteSlot(e: { detail: { index: number } }) {
      stateOf(this).controller?.deleteSlot(e.detail.index)
    },
    onCheckpoint(e: { detail: { key: string } }) {
      stateOf(this).controller?.jumpCheckpoint(e.detail.key)
    },
    onResumeAuto() {
      const controller = stateOf(this).controller
      if (!controller) return
      controller.closeSheet()
      controller.start('resume')
    },

    /* ---------- 退出 ---------- */

    onBack() {
      const kind = this.data.stopKind
      if (kind === 'ending' || kind === 'exit' || kind === 'halt') {
        this.leave()
        return
      }
      wx.showModal({
        content: EXIT_MESSAGE,
        confirmText: '退出',
        cancelText: '继续玩',
        success: (res) => {
          if (res.confirm) this.leave()
        },
      })
    },
    leave() {
      wx.disableAlertBeforeUnload({})
      wx.navigateBack({
        fail: () => { wx.switchTab({ url: '/pages/home/index' }) },
      })
    },
    onExitBack() {
      wx.navigateBack({
        fail: () => { wx.switchTab({ url: '/pages/home/index' }) },
      })
    },
    onRetryBoot() {
      this.boot()
    },
  },
})
