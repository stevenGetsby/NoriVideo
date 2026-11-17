import {
  ACHIEVEMENT_TOAST_MS,
  achievementConditionText,
  achievementProgress,
  achievementRewardText,
  advanceRun,
  applyBeatOutcome,
  autoSaveFor,
  beatHint,
  beatPlaybackRate,
  beatTimeoutHandle,
  checkpointFor,
  choiceTimeoutOption,
  countdownPercent,
  cosmeticsOf,
  createResolutionGate,
  dueBeat,
  emptyProfile,
  endingKeys,
  enqueueToasts,
  equipCosmetic,
  equippedLook,
  hasRandomResults,
  holdFrameAt,
  holdRelease,
  holdStart,
  holdStop,
  holdTimeout,
  initialHoldSession,
  initialTapSession,
  interactionHandles,
  interactionTimeoutHandle,
  isCountdownExpired,
  isOptionOpen,
  isRunFinished,
  lockedOptionPress,
  nextAttempt,
  nextSpeed,
  normalizeSpeed,
  observeRun,
  permanentValues,
  personalityView,
  playbackSpeeds,
  purchaseShopItem,
  reachKey,
  readPermanentValues,
  readStoredProfile,
  readStoredSaves,
  recordShopReward,
  recordsEnabled,
  registerTap,
  resolveBeat,
  resolveRandomHandle,
  restoreRun,
  saveTimeText,
  shopItemViews,
  snapshotLabel,
  snapshotRun,
  speedLabel,
  startRun,
  storyMap,
  storyPlaces,
  swipeMoveTo,
  swipeStart,
  tapHandle,
  tapPercent,
  timingFrameAt,
  timingTapAt,
  visibleOptions,
  withManualSave,
  withoutManualSave,
  writePermanentValues,
  writeStoredProfile,
  writeStoredSaves,
  STORY_SAVE_SLOTS,
  type BeatPlan,
  type FiredBeats,
  type HoldSession,
  type PermanentStorage,
  type PermanentValues,
  type PersonalityView,
  type PurchaseFailure,
  type ResolutionGate,
  type StoryAchievement,
  type StoryBeatDuring,
  type StoryChoiceNode,
  type StoryEndingType,
  type StoryInteractionNode,
  type StoryInteractionSpec,
  type StoryMedia,
  type StoryProfile,
  type StoryProgram,
  type StoryRun,
  type StoryRunSnapshot,
  type StorySaves,
  type StorySceneNode,
  type StoryStop,
  type StorySwipeDirection,
  type StoryToast,
  type StoryVariables,
  type SwipeSession,
  type TapSession,
} from '../../runtime/story-runtime'
import { PausableClock, VideoClock, VIDEO_TICK_MS } from './clock'
import { hotspotHandleAt } from './hotspot-geo'
import { pickPreloadTarget, preloadCandidates, WaitingTracker, type BranchStats, type PreloadCandidate } from './preload'
import { toWxRate } from './rates'

export interface VideoPort {
  load(slot: 'a' | 'b', src: string, poster: string | null, initialSec: number): void
  play(slot: 'a' | 'b'): void
  pause(slot: 'a' | 'b'): void
  seek(slot: 'a' | 'b', sec: number): void
  setRate(slot: 'a' | 'b', rate: number): void
  show(slot: 'a' | 'b'): void
  setLastFrame(url: string | null): void
}

export interface PlayerViewPort {
  set(patch: Record<string, unknown>): void
}

export interface MpEventIn {
  name: string
  w?: string
  r?: string
  n?: string
  o?: string
  v?: number
  f?: boolean
}

export type SyncReason = 'ending' | 'checkpoint' | 'manual' | 'hide' | 'unload'

export interface PlayerDeps {
  program: StoryProgram
  media: Record<string, { kind: 'video' | 'image'; w: number; h: number; dur?: number; v720?: string; v480?: string; poster?: string; last?: string; img?: string }>
  slug: string
  releaseId: string
  storage: PermanentStorage
  permanent: PermanentStorage
  video: VideoPort
  view: PlayerViewPort
  clock: PausableClock
  now: () => number
  quality: () => '720' | '480'
  track: (e: MpEventIn) => void
  haptic: () => void
  branchStats: () => BranchStats | null
  sync: (reason: SyncReason) => void
}

interface ResolvedMedia {
  kind: 'video' | 'image'
  url: string
  poster: string | null
  w: number
  h: number
  dur: number
  last: string | null
}

interface ActiveInteraction {
  node: StoryInteractionNode
  startedAt: number
  mounted: boolean
  gate: ResolutionGate<string>
}

type SheetKind = 'shop' | 'saves' | 'map' | 'achievements'

const ENDING_LABEL: Record<StoryEndingType, string> = {
  good: '圆满结局',
  normal: '普通结局',
  bad: '遗憾结局',
  hidden: '隐藏结局',
}

const PURCHASE_ERROR: Record<PurchaseFailure, string> = {
  no_shop: '商城还没有开启',
  unknown_item: '找不到这件商品',
  sold_out: '这件商品已经售罄',
  cannot_afford: '余额不足，买不起这件商品',
}

const SYNC_THROTTLE_MS = 15000
const NOTICE_MS = 5000
const LOCKED_HINT_MS = 2200
const LAST_FRAME_MS = 100
const PRELOAD_AHEAD_SEC = 3

/** 画面节奏（移植 playback-plan.pictureState，F.2 不导出该模块）。 */
function pictureState(baseRate: number, during: StoryBeatDuring | null, sheetPaused: boolean): { rate: number; playing: boolean } {
  if (during === 'freeze') return { rate: 1, playing: false }
  return { rate: during === null ? baseRate : beatPlaybackRate(during), playing: !sheetPaused }
}

/** 独立互动底图（移植 playback-plan.standaloneBackdrop）。 */
function standaloneBackdrop(node: StoryInteractionNode, previous: StoryMedia | null): { media: StoryMedia | null; freeze: boolean } {
  if (node.picture) return { media: node.picture, freeze: false }
  if (previous) return { media: previous, freeze: true }
  return { media: null, freeze: true }
}

function lastSceneMedia(program: StoryProgram, run: StoryRun): StoryMedia | null {
  for (let index = run.trail.length - 1; index >= 0; index -= 1) {
    const step = run.trail[index]
    if (step.kind !== 'scene') continue
    const node = program.chapters.find((chapter) => chapter.projectId === step.projectId)?.nodes.find((item) => item.id === step.nodeId)
    if (node?.kind === 'scene' && node.media) return node.media
  }
  return null
}

/**
 * 播放器纯 TS 控制器：所有平台能力经依赖注入，所有判定调用运行时纯函数，不重写任何公式。
 * 组件层只采集手势、渲染画面、转发视频事件。
 */
export class PlayerController {
  run: StoryRun
  profile: StoryProfile
  saves: StorySaves
  speed = 1
  sheet: SheetKind | null = null
  promptMode: 'none' | 'shown' = 'none'
  prompt: { chapter: string; node: string; savedAt: number } | null = null
  toasts: StoryToast[] = []
  currentToast: StoryToast | null = null
  active: ActiveInteraction | null = null
  fired: FiredBeats = new Set()
  videoPlaying = false
  endedFlag = false
  degraded = false
  watchSec = 0
  disposed = false
  continueNotice: string | null = null
  sheetNotice: string | null = null
  shopError: string | null = null
  lockedHint = false
  loading = false
  mediaError = false
  imageOverlay: string | null = null
  lastFrameUrl: string | null = null
  activeSlot: 'a' | 'b' = 'a'
  spareSlot: 'a' | 'b' = 'b'

  private readonly program: StoryProgram
  private readonly media: PlayerDeps['media']
  private readonly slug: string
  private readonly releaseId: string
  private readonly storage: PermanentStorage
  private readonly permanentStorage: PermanentStorage
  private readonly video: VideoPort
  private readonly view: PlayerViewPort
  private readonly clock: PausableClock
  private readonly now: () => number
  private readonly quality: () => '720' | '480'
  private readonly track: (e: MpEventIn) => void
  private readonly haptic: () => void
  private readonly branchStats: () => BranchStats | null
  private readonly sync: (reason: SyncReason) => void
  private readonly storageKey: string
  private readonly speeds: number[]
  private readonly recordsEnabled: boolean
  private readonly videoClock: VideoClock
  private readonly waitingTracker = new WaitingTracker()

  private permanent: StoryVariables
  private stopId = 0
  private attempt = 0
  private promptReturn = false
  private appHidden = false
  private clockPaused = false
  private shopFocusItemId: string | null = null
  private currentMedia: ResolvedMedia | null = null
  private currentRef: StoryMedia | null = null
  private backdropFrozen = false
  private choiceStartedAt: number | null = null
  private choiceGate: ResolutionGate<string> | null = null
  private stopStartedAt = 0
  private tapSession: TapSession = initialTapSession
  private swipeSession: SwipeSession | null = null
  private holdSession: HoldSession = initialHoldSession
  private stageRect = { w: 0, h: 0 }
  private preload: { target: PreloadCandidate; slot: 'a' | 'b'; ready: boolean } | null = null
  private pendingSwitch: { slot: 'a' | 'b' } | null = null
  private errorRetried = false
  private toastSeq = 0
  private endingReached = new Set<string>()
  private lastSyncAt = 0
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private lockedHintTimer: ReturnType<typeof setTimeout> | null = null
  private lastFrameTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: PlayerDeps) {
    this.program = deps.program
    this.media = deps.media
    this.slug = deps.slug
    this.releaseId = deps.releaseId
    this.storage = deps.storage
    this.permanentStorage = deps.permanent
    this.video = deps.video
    this.view = deps.view
    this.clock = deps.clock
    this.now = deps.now
    this.quality = deps.quality
    this.track = deps.track
    this.haptic = deps.haptic
    this.branchStats = deps.branchStats
    this.sync = deps.sync
    this.storageKey = `mp:${deps.slug}`
    this.speeds = playbackSpeeds(deps.program.playback)
    this.recordsEnabled = recordsEnabled(deps.program)
    this.profile = readStoredProfile(this.storage, this.storageKey)
    this.saves = readStoredSaves(this.storage, this.storageKey)
    this.permanent = readPermanentValues(this.permanentStorage, this.storageKey, this.program.variables)
    this.videoClock = new VideoClock(this.now, () => this.tick())
    this.run = this.begin()

    const auto = this.saves.auto
    const restored = auto ? restoreRun(this.program, auto.snapshot, { permanent: this.permanent }) : null
    if (this.recordsEnabled && auto && restored) {
      const label = snapshotLabel(this.program, auto.snapshot)
      this.run = restored
      this.promptMode = 'shown'
      this.promptReturn = false
      this.prompt = { chapter: label?.chapter ?? '', node: label?.node ?? '', savedAt: auto.savedAt }
    } else {
      if (this.recordsEnabled && auto && !restored) {
        this.saves = { ...this.saves, auto: null }
        this.continueNotice = '上次的进度已失效，将从头开始'
        this.scheduleNotice()
      }
      this.presentStop()
      this.videoClock.start()
    }
    this.updateClockPause()
    this.pushView()
  }

  /* ---------- 入口 ---------- */

  start(from: 'new' | 'resume' | `slot:${number}` | `checkpoint:${string}`): void {
    if (from === 'new') {
      this.permanent = readPermanentValues(this.permanentStorage, this.storageKey, this.program.variables)
      this.enterRun(this.begin())
      return
    }
    if (from === 'resume') {
      const auto = this.saves.auto
      const restored = auto ? restoreRun(this.program, auto.snapshot, { permanent: this.permanent }) : null
      if (restored) {
        this.enterRun(restored)
      } else {
        this.saves = { ...this.saves, auto: null }
        this.enterRun(this.begin())
        this.continueNotice = '上次的进度已失效，将从头开始'
        this.scheduleNotice()
      }
      return
    }
    if (from.startsWith('slot:')) {
      const index = Number(from.slice(5))
      const slot = this.saves.slots[index]
      const restored = slot ? restoreRun(this.program, slot.snapshot, { permanent: this.permanent }) : null
      if (restored) this.enterRun(restored)
      else { this.sheetNotice = '此存档来自旧版本，无法继续'; this.pushView() }
      return
    }
    if (from.startsWith('checkpoint:')) {
      const key = from.slice('checkpoint:'.length)
      const slot = this.saves.checkpoints[key]
      const restored = slot ? restoreRun(this.program, slot.snapshot, { permanent: this.permanent }) : null
      if (restored) this.enterRun(restored)
      else { this.sheetNotice = '此存档来自旧版本，无法继续'; this.pushView() }
    }
  }

  /** appShow 的「继续」：原地恢复播放，不重新读档。初始 prompt 的「继续」则呈现恢复后的停靠点。 */
  resume(): void {
    const wasReturn = this.promptReturn
    this.promptMode = 'none'
    this.prompt = null
    this.promptReturn = false
    this.updateClockPause()
    this.videoClock.start()
    if (wasReturn) {
      this.resumeVideo()
      this.pushView()
    } else {
      this.attempt = 0
      this.stopId += 1
      this.presentStop()
      this.track({ name: 'play_start', f: true })
    }
  }

  restart(): void {
    this.permanent = readPermanentValues(this.permanentStorage, this.storageKey, this.program.variables)
    this.waitingTracker.reset()
    this.degraded = false
    this.sheet = null
    this.shopError = null
    this.sheetNotice = null
    this.enterRun(this.begin())
  }

  private begin(): StoryRun {
    return startRun(this.program, { mode: 'story', permanent: this.permanent })
  }

  private enterRun(run: StoryRun, trackStart = true): void {
    this.run = run
    this.attempt = 0
    this.stopId += 1
    this.promptMode = 'none'
    this.prompt = null
    this.promptReturn = false
    this.updateClockPause()
    this.presentStop()
    this.videoClock.start()
    if (trackStart) this.track({ name: 'play_start', f: false })
  }

  /* ---------- 视频事件 ---------- */

  onTimeUpdate(slot: 'a' | 'b', currentSec: number, durationSec: number): void {
    if (slot === this.spareSlot && this.preload && !this.preload.ready) {
      this.video.pause(slot)
      this.video.seek(slot, 0)
      this.preload.ready = true
      return
    }
    if (slot !== this.activeSlot) return
    this.videoClock.update(currentSec, durationSec)
    this.loading = false
  }

  onEnded(slot: 'a' | 'b'): void {
    if (slot !== this.activeSlot) return
    this.endedFlag = true
    this.videoPlaying = false
    this.videoClock.ended()
    if (this.currentMedia?.last) {
      this.video.setLastFrame(this.currentMedia.last)
      this.lastFrameUrl = this.currentMedia.last
    }
    if (this.active?.mounted) {
      const handle = beatTimeoutHandle(this.active.node.spec, this.run.vars, this.program.variables)
      if (handle) this.finishBeat(this.active.node, handle, true)
      else this.continueFrom()
      return
    }
    if (this.run.stop.kind === 'scene') {
      this.continueFrom()
      return
    }
    this.video.pause(this.activeSlot)
  }

  onWaiting(slot: 'a' | 'b'): void {
    if (slot !== this.activeSlot) return
    this.videoClock.pause()
    this.loading = true
    if (this.waitingTracker.note(this.now())) this.degraded = true
    this.pushView()
  }

  onPlaying(slot: 'a' | 'b'): void {
    if (this.pendingSwitch && this.pendingSwitch.slot === slot) {
      this.pendingSwitch = null
      this.swapSlots()
      this.video.show(this.activeSlot)
      this.videoPlaying = true
      this.loading = false
      this.videoClock.resume()
      this.refreshPictureRate()
      this.removeLastFrameSoon()
      this.pushView()
      return
    }
    if (slot !== this.activeSlot) return
    this.videoPlaying = true
    this.loading = false
    this.videoClock.resume()
    this.removeLastFrameSoon()
    this.pushView()
  }

  onError(slot: 'a' | 'b'): void {
    if (slot !== this.activeSlot) return
    if (!this.errorRetried && this.currentMedia?.kind === 'video') {
      this.errorRetried = true
      const resolved = this.resolveMedia(this.currentRef, true)
      if (resolved?.url) {
        this.video.load(this.activeSlot, resolved.url, resolved.poster, 0)
        this.video.play(this.activeSlot)
        return
      }
    }
    this.mediaError = true
    this.videoPlaying = false
    this.pushView()
  }

  /** 「跳过这一段」/ 图片片段继续：等同该 scene 自然播完。 */
  skipSegment(): void {
    if (this.run.stop.kind !== 'scene') return
    this.continueFrom()
  }

  /** 媒体失败后的「重试」。 */
  retryMedia(): void {
    this.mediaError = false
    this.errorRetried = false
    const resolved = this.resolveMedia(this.currentRef, this.degraded)
    if (resolved?.kind === 'video' && resolved.url) {
      this.video.load(this.activeSlot, resolved.url, resolved.poster, 0)
      this.video.play(this.activeSlot)
      this.videoPlaying = true
      this.videoClock.resume()
    }
    this.pushView()
  }

  /* ---------- 选择与手势 ---------- */

  choose(optionId: string): void {
    const mounted = this.active
    if (mounted?.mounted && mounted.node.spec.type === 'choice') {
      const press = lockedOptionPress(mounted.node.spec.options, optionId, this.run.vars, this.program.variables)
      if (press.kind === 'shop') { this.openSheet('shop', press.itemId); return }
      if (press.kind === 'hint') { this.showLockedHint(); return }
      mounted.gate(optionId)
      return
    }
    const stop = this.run.stop
    if (stop.kind === 'choice') {
      const press = lockedOptionPress(stop.node.options, optionId, this.run.vars, this.program.variables)
      if (press.kind === 'shop') { this.openSheet('shop', press.itemId); return }
      if (press.kind === 'hint') { this.showLockedHint(); return }
      this.choiceGate?.(optionId)
      return
    }
    if (stop.kind === 'interaction') {
      const node = stop.node
      if (node.spec.type === 'choice') {
        const press = lockedOptionPress(node.spec.options, optionId, this.run.vars, this.program.variables)
        if (press.kind === 'shop') { this.openSheet('shop', press.itemId); return }
        if (press.kind === 'hint') { this.showLockedHint(); return }
      }
      this.active?.gate(optionId)
    }
  }

  pointerDown(x: number, y: number): void {
    const active = this.active
    if (!active || this.isPaused()) return
    const spec = active.node.spec
    const now = this.clock.now()
    if (spec.type === 'tap') {
      this.tapSession = registerTap(this.tapSession)
      this.haptic()
      const handle = tapHandle(this.tapSession, spec)
      if (handle) active.gate(handle)
      this.pushView()
    } else if (spec.type === 'swipe') {
      this.swipeSession = swipeStart(x, y)
    } else if (spec.type === 'timing') {
      active.gate(timingTapAt(active.startedAt, now, spec))
    } else if (spec.type === 'hold') {
      this.holdSession = holdStart(now)
      this.pushView()
    } else if (spec.type === 'hotspot') {
      const handle = this.hotspotHandle(spec, x, y)
      if (handle) active.gate(handle)
    }
  }

  pointerMove(x: number, y: number): void {
    const active = this.active
    if (!active || this.isPaused() || active.node.spec.type !== 'swipe' || !this.swipeSession) return
    const result = swipeMoveTo(this.swipeSession, x, y, active.node.spec.direction)
    this.swipeSession = result.session
    if (result.judgement !== 'pending') {
      this.swipeSession = null
      active.gate(result.judgement)
    }
    this.pushView()
  }

  pointerUp(x: number, y: number): void {
    const active = this.active
    if (!active || this.isPaused()) return
    const spec = active.node.spec
    if (spec.type === 'swipe' && this.swipeSession) {
      const result = swipeMoveTo(this.swipeSession, x, y, spec.direction)
      this.swipeSession = null
      if (result.judgement !== 'pending') active.gate(result.judgement)
      this.pushView()
    } else if (spec.type === 'hold' && this.holdSession.holding) {
      const session = this.holdSession
      this.holdSession = holdStop()
      active.gate(holdRelease(session, this.clock.now(), spec).judgement)
      this.pushView()
    }
  }

  setStageRect(w: number, h: number): void {
    this.stageRect = { w, h }
  }

  private hotspotHandle(spec: Extract<StoryInteractionSpec, { type: 'hotspot' }>, x: number, y: number): string | null {
    const media = this.currentMedia
    if (!media || this.stageRect.w <= 0 || this.stageRect.h <= 0) return null
    return hotspotHandleAt(spec.zones, this.stageRect.w, this.stageRect.h, media.w, media.h, x, y)
  }

  /* ---------- 弹层与商店 ---------- */

  openSheet(kind: SheetKind, itemId?: string | null): void {
    this.sheet = kind
    this.shopFocusItemId = itemId ?? null
    this.shopError = null
    this.sheetNotice = null
    this.updateClockPause()
    this.video.pause(this.activeSlot)
    this.videoPlaying = false
    this.videoClock.pause()
    this.pushView()
  }

  closeSheet(): void {
    this.sheet = null
    this.shopFocusItemId = null
    this.shopError = null
    this.sheetNotice = null
    this.updateClockPause()
    this.resumeVideo()
    this.pushView()
  }

  buy(itemId: string): void {
    const result = purchaseShopItem(this.program, this.run, itemId, this.profile.bought)
    if (!result.ok) {
      this.shopError = PURCHASE_ERROR[result.reason]
      this.pushView()
      return
    }
    this.shopError = null
    this.profile = recordShopReward(this.program, this.profile, itemId)
    writeStoredProfile(this.storage, this.storageKey, this.profile)
    this.commitRun(result.run, result.run.stop !== this.run.stop)
    this.pushView()
  }

  equip(part: 'title' | 'frame', cosmeticId: string | null): void {
    this.profile = equipCosmetic(this.program, this.profile, part, cosmeticId)
    writeStoredProfile(this.storage, this.storageKey, this.profile)
    this.pushView()
  }

  /* ---------- 存档 ---------- */

  saveSlot(index: number): void {
    const snapshot = snapshotRun(this.run)
    if (!snapshot) {
      this.sheetNotice = '现在还不能存档：先进入一个可继续的片段'
      this.pushView()
      return
    }
    this.saves = withManualSave(this.saves, index, snapshot, this.now())
    writeStoredSaves(this.storage, this.storageKey, this.saves)
    this.sheetNotice = `已保存到存档位 ${index + 1}`
    this.requestSync('manual')
    this.pushView()
  }

  loadSlot(index: number): void {
    const slot = this.saves.slots[index]
    if (slot) this.loadSnapshot(slot.snapshot)
  }

  jumpCheckpoint(key: string): void {
    const slot = this.saves.checkpoints[key]
    if (slot) this.loadSnapshot(slot.snapshot)
  }

  deleteSlot(index: number): void {
    this.saves = withoutManualSave(this.saves, index)
    writeStoredSaves(this.storage, this.storageKey, this.saves)
    this.sheetNotice = `已删除存档位 ${index + 1}`
    this.pushView()
  }

  private loadSnapshot(snapshot: StoryRunSnapshot): void {
    const restored = restoreRun(this.program, snapshot, { permanent: this.permanent })
    if (!restored) {
      this.sheetNotice = '此存档来自旧版本，无法继续'
      this.pushView()
      return
    }
    this.sheet = null
    this.shopError = null
    this.sheetNotice = null
    this.enterRun(restored, false)
  }

  /* ---------- 倍速 ---------- */

  cycleSpeed(): void {
    this.speed = nextSpeed(this.speeds, normalizeSpeed(this.speed, this.speeds))
    this.refreshPictureRate()
    this.pushView()
  }

  /* ---------- 前后台 ---------- */

  appHide(): void {
    this.appHidden = true
    this.updateClockPause()
    this.video.pause(this.activeSlot)
    this.videoPlaying = false
    this.videoClock.pause()
    this.videoClock.stop()
    this.requestSync('hide')
    this.pushView()
  }

  appShow(): void {
    this.appHidden = false
    this.videoClock.start()
    const snapshot = snapshotRun(this.run)
    if (snapshot) {
      const label = snapshotLabel(this.program, snapshot)
      this.promptMode = 'shown'
      this.promptReturn = true
      this.prompt = { chapter: label?.chapter ?? '', node: label?.node ?? '', savedAt: this.saves.auto?.savedAt ?? this.now() }
    } else {
      this.promptMode = 'none'
      this.resumeVideo()
    }
    this.updateClockPause()
    this.pushView()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.videoClock.stop()
    this.clearTimer('toast')
    this.clearTimer('notice')
    this.clearTimer('lockedHint')
    this.clearTimer('lastFrame')
    this.video.pause(this.activeSlot)
    this.flushRecords()
    const stop = this.run.stop
    const nodeId = stop.kind === 'halt' ? stop.nodeId ?? undefined : stop.node.id
    this.track({ name: 'play_exit', n: nodeId, v: Math.round(this.watchSec), f: isRunFinished(this.run) })
    this.requestSync('unload')
  }

  /* ---------- 云存档口径 ---------- */

  savePayload(): { releaseId: string; profile: StoryProfile; saves: StorySaves; permanent: PermanentValues; progress: number; endingsGot: number } {
    return {
      releaseId: this.releaseId,
      profile: this.profile,
      saves: this.saves,
      permanent: permanentValues(this.program.variables, this.run.vars) as PermanentValues,
      progress: this.progress(),
      endingsGot: this.endingsGot(),
    }
  }

  /** PUT 返回 merged 时的收敛：采纳服务端合并结果写回本地；永久值同步进当前 run，其余 run 状态不受影响。 */
  adoptMerged(state: { profile: StoryProfile; saves: StorySaves; permanent: PermanentValues }): void {
    this.profile = state.profile
    this.saves = state.saves
    writeStoredProfile(this.storage, this.storageKey, this.profile)
    writeStoredSaves(this.storage, this.storageKey, this.saves)
    writePermanentValues(this.permanentStorage, this.storageKey, this.program.variables, { ...this.run.vars, ...state.permanent } as StoryVariables)
    this.permanent = readPermanentValues(this.permanentStorage, this.storageKey, this.program.variables)
    this.run = { ...this.run, vars: { ...this.run.vars, ...this.permanent } }
    this.pushView()
  }

  private sceneKeys(): string[] {
    return this.program.chapters.flatMap((chapter) =>
      chapter.nodes.filter((node) => node.kind === 'scene').map((node) => reachKey(chapter.projectId, node.id)),
    )
  }

  private progress(): number {
    const keys = this.sceneKeys()
    if (!keys.length) return 0
    const reached = new Set(this.profile.segments)
    return keys.filter((key) => reached.has(key)).length / keys.length
  }

  private endingsGot(): number {
    const reached = new Set(this.profile.endings)
    return endingKeys(this.program).filter((key) => reached.has(key)).length
  }

  private requestSync(reason: SyncReason): void {
    const now = this.now()
    const force = reason === 'hide' || reason === 'unload'
    if (!force && now - this.lastSyncAt < SYNC_THROTTLE_MS) return
    this.lastSyncAt = now
    this.sync(reason)
  }

  /* ---------- 内部：run 推进 ---------- */

  private commitRun(next: StoryRun, stopChanged: boolean): void {
    this.run = next
    if (stopChanged) {
      this.stopId += 1
      this.presentStop()
    } else {
      this.observeRecords()
      this.pushView()
    }
  }

  private continueFrom(base?: StoryRun): void {
    const next = advanceRun(this.program, base ?? this.run)
    this.attempt = 0
    this.commitRun(next, true)
  }

  private resolveChoice(optionId: string): void {
    const stop = this.run.stop
    if (stop.kind !== 'choice') return
    this.track({ name: 'choice_made', n: stop.node.id, o: optionId, v: this.now() - this.stopStartedAt })
    const next = advanceRun(this.program, this.run, optionId)
    this.attempt = 0
    this.commitRun(next, next.stop !== this.run.stop)
  }

  private resolveStandalone(handle: string): void {
    const stop = this.run.stop
    if (stop.kind !== 'interaction') return
    const node = stop.node
    const settled = this.settleRandom(node, handle)
    if (!settled) return
    this.track({ name: 'interaction_result', n: node.id, o: settled })
    const next = advanceRun(this.program, this.run, settled)
    this.attempt = nextAttempt(this.attempt, this.run.stop, next)
    const same = next.stop === this.run.stop
    this.commitRun(next, !same)
    if (same) this.rearmStandalone()
  }

  private rearmStandalone(): void {
    const stop = this.run.stop
    if (stop.kind !== 'interaction') return
    this.tapSession = initialTapSession
    this.swipeSession = null
    this.holdSession = initialHoldSession
    this.stopStartedAt = this.now()
    this.active = {
      node: stop.node,
      startedAt: this.clock.now(),
      mounted: false,
      gate: createResolutionGate<string>((handle) => this.resolveStandalone(handle)),
    }
    this.pushView()
  }

  private settleRandom(node: StoryInteractionNode, handle: string): string | null {
    if (!hasRandomResults(node.results)) return handle
    const isOpen = (result: string) =>
      node.spec.type !== 'choice'
      || !node.spec.options.some((option) => option.id === result)
      || isOptionOpen(node.spec.options, result, this.run.vars, this.program.variables)
    return resolveRandomHandle(node.spec, node.results, Math.random(), isOpen) ?? handle
  }

  private beats(): StoryInteractionNode[] {
    const stop = this.run.stop
    return stop.kind === 'scene' && stop.node.media?.kind === 'video' ? stop.node.beats : []
  }

  private beginBeat(beat: StoryInteractionNode): void {
    if (this.active) return
    this.active = {
      node: beat,
      startedAt: this.clock.now(),
      mounted: true,
      gate: createResolutionGate<string>((handle) => this.finishBeat(beat, handle, false)),
    }
    this.applyPicture(pictureState(this.baseRate(), beat.during, this.isPaused()))
    this.pushView()
  }

  private finishBeat(beat: StoryInteractionNode, handle: string, fromEnded: boolean): void {
    const settled = this.settleRandom(beat, handle)
    if (!settled) return
    const outcome = resolveBeat(this.program, this.run, beat.id, settled)
    const plan: BeatPlan = applyBeatOutcome(outcome, beat, this.beats(), this.fired)
    this.fired = plan.fired
    this.active = null
    this.track({ name: 'interaction_result', n: beat.id, o: settled })
    if (plan.kind === 'cut') {
      this.commitRun(plan.run, true)
      return
    }
    if (plan.kind === 'retry') {
      this.commitRun(plan.run, false)
      this.endedFlag = false
      if (plan.seekSec !== null) {
        this.video.seek(this.activeSlot, plan.seekSec)
        this.videoClock.seek(plan.seekSec)
      }
      this.applyPicture(pictureState(this.baseRate(), null, this.isPaused()))
      this.pushView()
      return
    }
    if (fromEnded) {
      this.continueFrom(plan.run)
      return
    }
    this.commitRun(plan.run, false)
    this.applyPicture(pictureState(this.baseRate(), null, this.isPaused()))
    this.pushView()
  }

  /* ---------- 内部：停靠点呈现 ---------- */

  private presentStop(): void {
    this.fired = new Set()
    this.active = null
    this.choiceStartedAt = null
    this.choiceGate = null
    this.endedFlag = false
    this.mediaError = false
    this.errorRetried = false
    this.loading = false
    this.lastFrameUrl = null
    this.imageOverlay = null
    this.backdropFrozen = false
    this.pendingSwitch = null
    this.tapSession = initialTapSession
    this.swipeSession = null
    this.holdSession = initialHoldSession
    this.stopStartedAt = this.now()
    this.video.setLastFrame(null)
    const stop = this.run.stop
    if (stop.kind === 'scene') this.presentScene(stop.node)
    else if (stop.kind === 'choice') this.presentChoice(stop.node)
    else if (stop.kind === 'interaction') this.presentInteraction(stop.node)
    else this.presentCard(stop)
    this.observeRecords()
    this.pushView()
  }

  private presentScene(node: StorySceneNode): void {
    this.currentRef = node.media
    const resolved = this.resolveMedia(node.media)
    this.currentMedia = resolved
    this.videoClock.reset(resolved?.dur || node.media?.durationSec || 0)
    this.track({ name: 'segment_view', n: node.id })
    if (resolved?.kind === 'video') {
      this.presentSceneVideo(resolved, node.media as StoryMedia)
    } else if (resolved?.kind === 'image') {
      this.imageOverlay = resolved.url
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
    } else {
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
    }
  }

  private presentSceneVideo(resolved: ResolvedMedia, ref: StoryMedia): void {
    this.backdropFrozen = false
    const preload = this.preload
    if (preload && preload.ready && preload.target.url === ref.url) {
      this.preload = null
      this.swapSlots()
      this.video.show(this.activeSlot)
      this.video.play(this.activeSlot)
      this.videoPlaying = true
      this.videoClock.resume()
      this.refreshPictureRate()
      return
    }
    this.preload = null
    this.video.pause(this.activeSlot)
    const spare = this.spareSlot
    this.video.load(spare, resolved.url, resolved.poster, 0)
    this.video.show(spare)
    this.video.play(spare)
    this.pendingSwitch = { slot: spare }
    this.videoPlaying = false
    this.videoClock.pause()
  }

  private presentChoice(node: StoryChoiceNode): void {
    this.preload = null
    this.choiceStartedAt = typeof node.timeoutSec === 'number' && node.timeoutSec > 0 ? this.clock.now() : null
    this.choiceGate = createResolutionGate<string>((handle) => this.resolveChoice(handle))
    this.presentBackdrop(node.backdrop ?? lastSceneMedia(this.program, this.run), !node.backdrop)
    this.beginPreload()
  }

  private presentInteraction(node: StoryInteractionNode): void {
    this.preload = null
    const plan = standaloneBackdrop(node, lastSceneMedia(this.program, this.run))
    const frameUrl = node.spec.type === 'hotspot' && node.during !== 'play' ? node.spec.frameImageUrl : null
    const media: StoryMedia | null = !node.picture && frameUrl ? { kind: 'image', url: frameUrl, posterUrl: null } : plan.media
    const freeze = !node.picture && frameUrl ? false : plan.freeze
    this.presentBackdrop(media, freeze)
    this.active = {
      node,
      startedAt: this.clock.now(),
      mounted: false,
      gate: createResolutionGate<string>((handle) => this.resolveStandalone(handle)),
    }
    if (!this.backdropFrozen) this.applyPicture(pictureState(this.baseRate(), node.during, this.isPaused()))
    this.beginPreload()
  }

  private presentCard(stop: StoryStop): void {
    this.preload = null
    if (stop.kind === 'halt') {
      this.currentMedia = null
      this.currentRef = null
      this.imageOverlay = null
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
      return
    }
    this.presentBackdrop(lastSceneMedia(this.program, this.run), false)
  }

  private presentBackdrop(media: StoryMedia | null, freeze: boolean): void {
    this.currentRef = media
    const resolved = this.resolveMedia(media)
    this.currentMedia = resolved
    this.videoClock.reset(resolved?.dur || media?.durationSec || 0)
    if (resolved?.kind === 'video') {
      this.imageOverlay = null
      this.backdropFrozen = freeze
      const initial = freeze ? Math.max(0, resolved.dur - 0.04) : 0
      this.video.load(this.activeSlot, resolved.url, resolved.poster, initial)
      this.video.show(this.activeSlot)
      if (freeze) {
        this.video.seek(this.activeSlot, initial)
        this.video.pause(this.activeSlot)
        this.video.setLastFrame(resolved.last)
        this.lastFrameUrl = resolved.last
        this.videoPlaying = false
        this.videoClock.pause()
      } else {
        this.video.play(this.activeSlot)
        this.videoPlaying = true
        this.videoClock.resume()
      }
      this.refreshPictureRate()
    } else if (resolved?.kind === 'image') {
      this.imageOverlay = resolved.url
      this.backdropFrozen = true
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
    } else {
      this.imageOverlay = null
      this.backdropFrozen = true
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
    }
  }

  /* ---------- 内部：预加载 ---------- */

  private beginPreload(): void {
    if (this.preload || this.pendingSwitch) return
    const candidates = preloadCandidates(this.program, this.run)
    const stop = this.run.stop
    const nodeId = stop.kind === 'halt' ? '' : stop.node.id
    const target = pickPreloadTarget(candidates, nodeId, this.branchStats())
    if (!target) return
    const resolved = this.resolveMediaUrl(target.url)
    if (!resolved || resolved.kind !== 'video' || !resolved.url) return
    const spare = this.spareSlot
    this.video.load(spare, resolved.url, resolved.poster, 0)
    this.video.play(spare)
    this.preload = { target, slot: spare, ready: false }
  }

  /* ---------- 内部：画面节奏 ---------- */

  private baseRate(): number {
    return normalizeSpeed(this.speed, this.speeds)
  }

  private isPaused(): boolean {
    return this.sheet !== null || this.promptMode === 'shown' || this.appHidden
  }

  private updateClockPause(): void {
    const shouldPause = this.isPaused()
    if (shouldPause && !this.clockPaused) {
      this.clock.pause()
      this.clockPaused = true
    } else if (!shouldPause && this.clockPaused) {
      this.clock.resume()
      this.clockPaused = false
    }
  }

  private applyPicture(picture: { rate: number; playing: boolean }): void {
    const wx = toWxRate(picture.rate)
    this.video.setRate(this.activeSlot, wx)
    this.videoClock.setRate(wx)
    if (picture.playing && !this.endedFlag && !this.backdropFrozen) {
      this.video.play(this.activeSlot)
      this.videoPlaying = true
      this.videoClock.resume()
    } else {
      this.video.pause(this.activeSlot)
      this.videoPlaying = false
      this.videoClock.pause()
    }
  }

  private refreshPictureRate(): void {
    const stop = this.run.stop
    const during = this.active?.node.during ?? (stop.kind === 'interaction' ? stop.node.during : null)
    const wx = toWxRate(pictureState(this.baseRate(), during, this.isPaused()).rate)
    this.video.setRate(this.activeSlot, wx)
    this.videoClock.setRate(wx)
  }

  private resumeVideo(): void {
    if (this.isPaused() || this.endedFlag || this.backdropFrozen || this.currentMedia?.kind !== 'video') return
    const stop = this.run.stop
    const during = this.active?.node.during ?? (stop.kind === 'interaction' ? stop.node.during : null)
    this.applyPicture(pictureState(this.baseRate(), during, false))
  }

  private swapSlots(): void {
    const old = this.activeSlot
    this.activeSlot = this.spareSlot
    this.spareSlot = old
  }

  private removeLastFrameSoon(): void {
    this.clearTimer('lastFrame')
    this.lastFrameTimer = setTimeout(() => {
      this.lastFrameTimer = null
      this.video.setLastFrame(null)
      this.lastFrameUrl = null
      this.pushView()
    }, LAST_FRAME_MS)
  }

  /* ---------- 内部：媒体解析 ---------- */

  private resolveMedia(ref: StoryMedia | null, force480 = false): ResolvedMedia | null {
    if (!ref) return null
    const resolved = this.resolveMediaUrl(ref.url, force480)
    if (resolved && !resolved.dur && ref.durationSec) resolved.dur = ref.durationSec
    return resolved
  }

  private resolveMediaUrl(url: string, force480 = false): ResolvedMedia | null {
    const id = url.startsWith('mp:') ? url.slice(3) : url
    const entry = this.media[id]
    if (!entry) return null
    const quality = force480 || this.degraded ? '480' : this.quality()
    if (entry.kind === 'video') {
      const src = quality === '720' ? entry.v720 ?? entry.v480 ?? '' : entry.v480 ?? entry.v720 ?? ''
      return { kind: 'video', url: src, poster: entry.poster ?? null, w: entry.w, h: entry.h, dur: entry.dur ?? 0, last: entry.last ?? null }
    }
    return { kind: 'image', url: entry.img ?? url, poster: null, w: entry.w, h: entry.h, dur: 0, last: null }
  }

  /* ---------- 内部：记录与成就 ---------- */

  private observeRecords(): void {
    if (!this.recordsEnabled || this.promptMode !== 'none') return
    const now = this.now()
    const { profile, earned } = observeRun(this.program, this.profile, this.run)
    this.profile = profile
    if (earned.length) {
      this.toasts = enqueueToasts(this.toasts, earned, this.toastSeq)
      this.toastSeq += earned.length
      this.pumpToast()
    }
    const prevCheckpoints = this.saves.checkpoints
    this.saves = checkpointFor(autoSaveFor(this.saves, this.program, this.run, now), this.program, this.run, now)
    this.flushRecords()
    if (this.saves.checkpoints !== prevCheckpoints) this.requestSync('checkpoint')
    const stop = this.run.stop
    if (stop.kind === 'ending') {
      const key = reachKey(stop.projectId, stop.node.id)
      if (!this.endingReached.has(key)) {
        this.endingReached.add(key)
        this.track({ name: 'ending_reached', n: stop.node.id, f: true })
      }
      this.requestSync('ending')
    }
  }

  private flushRecords(): void {
    writeStoredProfile(this.storage, this.storageKey, this.profile)
    writeStoredSaves(this.storage, this.storageKey, this.saves)
    writePermanentValues(this.permanentStorage, this.storageKey, this.program.variables, this.run.vars)
  }

  private pumpToast(): void {
    if (this.toastTimer !== null) return
    if (!this.toasts.length) {
      this.currentToast = null
      this.pushView()
      return
    }
    this.currentToast = this.toasts[0]
    this.pushView()
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      this.toasts = this.toasts.slice(1)
      this.pumpToast()
    }, ACHIEVEMENT_TOAST_MS)
  }

  private scheduleNotice(): void {
    this.clearTimer('notice')
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null
      this.continueNotice = null
      this.pushView()
    }, NOTICE_MS)
  }

  private showLockedHint(): void {
    this.lockedHint = true
    this.clearTimer('lockedHint')
    this.lockedHintTimer = setTimeout(() => {
      this.lockedHintTimer = null
      this.lockedHint = false
      this.pushView()
    }, LOCKED_HINT_MS)
    this.pushView()
  }

  private clearTimer(which: 'toast' | 'notice' | 'lockedHint' | 'lastFrame'): void {
    const timer = which === 'toast' ? this.toastTimer : which === 'notice' ? this.noticeTimer : which === 'lockedHint' ? this.lockedHintTimer : this.lastFrameTimer
    if (timer !== null) clearTimeout(timer)
    if (which === 'toast') this.toastTimer = null
    else if (which === 'notice') this.noticeTimer = null
    else if (which === 'lockedHint') this.lockedHintTimer = null
    else this.lastFrameTimer = null
  }

  /* ---------- 内部：tick ---------- */

  private tick(): void {
    if (this.disposed) return
    const paused = this.isPaused()
    const stop = this.run.stop
    if (this.videoPlaying && !paused && !this.loading) this.watchSec += VIDEO_TICK_MS / 1000

    if (stop.kind === 'scene' && !paused && !this.active && this.videoPlaying && !this.endedFlag) {
      const beats = this.beats()
      const position = this.videoClock.position()
      if (beats.length) {
        const due = dueBeat(beats, this.fired, position)
        if (due) this.beginBeat(due)
      }
      const duration = this.videoClock.duration
      if (duration > 0 && !this.preload && !this.pendingSwitch && duration - position < PRELOAD_AHEAD_SEC) this.beginPreload()
    }

    if (this.active && !paused) {
      const node = this.active.node
      const now = this.clock.now()
      if (node.spec.type === 'hold' && this.holdSession.holding && holdFrameAt(this.holdSession, now, node.spec).overcharged) {
        this.active.gate('fail')
      }
      if (this.active && isCountdownExpired(this.active.startedAt, now, node.durationSec)) {
        const handle = node.spec.type === 'hold'
          ? holdTimeout(this.holdSession, now, node.spec)
          : node.spec.type === 'choice'
            ? beatTimeoutHandle(node.spec, this.run.vars, this.program.variables)
            : interactionTimeoutHandle(node.spec)
        if (handle) this.active.gate(handle)
      }
    }

    if (stop.kind === 'choice' && !paused && this.choiceStartedAt !== null) {
      const timeoutSec = stop.node.timeoutSec
      if (timeoutSec && timeoutSec > 0 && isCountdownExpired(this.choiceStartedAt, this.clock.now(), timeoutSec)) {
        const fallback = choiceTimeoutOption(stop.node, this.run.vars, this.program.variables)
        if (fallback) this.choose(fallback)
      }
    }

    this.pushView()
  }

  /* ---------- 内部：视图 ---------- */

  private pushView(): void {
    this.view.set(this.buildView())
  }

  private buildView(): Record<string, unknown> {
    const stop = this.run.stop
    const variables = this.program.variables
    const backdrop = lastSceneMedia(this.program, this.run)
    const view: Record<string, unknown> = {
      stopKind: stop.kind,
      activeSlot: this.activeSlot,
      spareSlot: this.spareSlot,
      mediaKind: this.currentMedia?.kind ?? null,
      mediaUrl: this.currentMedia?.url ?? null,
      mediaPoster: this.currentMedia?.poster ?? null,
      mediaW: this.currentMedia?.w ?? 0,
      mediaH: this.currentMedia?.h ?? 0,
      imageOverlay: this.imageOverlay,
      lastFrameUrl: this.lastFrameUrl,
      loading: this.loading,
      mediaError: this.mediaError,
      videoPlaying: this.videoPlaying,
      aigc: 'AI 生成',
      promptMode: this.promptMode,
      prompt: this.prompt ? { ...this.prompt, timeText: saveTimeText(this.prompt.savedAt) } : null,
      continueNotice: this.continueNotice,
      lockedHint: this.lockedHint,
      sheet: this.sheet,
      sheetNotice: this.sheetNotice,
      toast: this.currentToast ? { name: this.currentToast.achievement.name, rewardText: achievementRewardText(this.currentToast.achievement.reward) } : null,
      hud: this.buildHud(),
      scene: null,
      choice: null,
      interaction: null,
      ending: null,
      card: null,
    }

    if (stop.kind === 'scene') {
      view.scene = {
        nodeId: stop.node.id,
        title: stop.node.title,
        lines: stop.node.lines,
        pendingLabel: this.run.pending?.label ?? null,
        canContinue: stop.node.media?.kind !== 'video',
      }
    } else if (stop.kind === 'choice') {
      const timeoutSec = typeof stop.node.timeoutSec === 'number' && stop.node.timeoutSec > 0 ? stop.node.timeoutSec : null
      view.choice = {
        nodeId: stop.node.id,
        prompt: stop.node.prompt || stop.node.title,
        panelStyle: stop.node.panelStyle,
        layout: stop.node.layout,
        options: visibleOptions(stop.node.options, this.run.vars, variables).map((entry) => ({ ...entry.option, locked: entry.locked, shopItemId: entry.shopItemId })),
        timeoutSec,
        countdownPercent: timeoutSec && this.choiceStartedAt !== null ? countdownPercent(this.choiceStartedAt, this.clock.now(), timeoutSec) : null,
      }
    } else if (stop.kind === 'interaction') {
      view.interaction = this.buildInteraction(stop.node, false)
    } else if (stop.kind === 'ending') {
      const personality: PersonalityView | null = stop.node.showPersonality ? personalityView(this.program.personality, this.run.personality) : null
      view.ending = {
        nodeId: stop.node.id,
        type: stop.node.endingType,
        typeLabel: ENDING_LABEL[stop.node.endingType],
        title: stop.node.title,
        description: stop.node.description,
        personality,
        got: this.endingsGot(),
        total: endingKeys(this.program).length,
        hasSaves: this.saves.slots.some(Boolean) || Object.keys(this.saves.checkpoints).length > 0,
      }
    } else if (stop.kind === 'exit') {
      view.card = { kind: 'exit', kicker: '本章结束', title: `到达出口「${stop.node.title}」` }
    } else if (stop.kind === 'halt') {
      view.card = { kind: 'halt', kicker: '试玩中断', title: stop.message }
    }

    if (this.active?.mounted) view.interaction = this.buildInteraction(this.active.node, true)

    if (this.sheet === 'shop') view.shop = this.buildShop()
    else if (this.sheet === 'saves') view.savesSheet = this.buildSavesSheet()
    else if (this.sheet === 'map') view.mapSheet = { map: storyMap(this.program, this.profile, this.run), saves: this.buildSavesSheet() }
    else if (this.sheet === 'achievements') view.achievementsSheet = this.buildAchievements()

    void backdrop
    return view
  }

  private buildHud(): Record<string, unknown> {
    return {
      vars: this.program.variables.filter((variable) => variable.showInHud).map((variable) => ({
        id: variable.id,
        name: variable.name,
        icon: variable.icon ?? null,
        type: variable.type,
        value: this.run.vars[variable.id] ?? variable.initial,
      })),
      speedLabel: speedLabel(this.baseRate()),
      showSaves: recordsEnabled(this.program) && this.program.map?.enabled === true,
      showShop: this.program.shop?.enabled === true,
      showAchievements: (this.program.achievements?.length ?? 0) > 0,
    }
  }

  private buildInteraction(node: StoryInteractionNode, mounted: boolean): Record<string, unknown> {
    const spec = node.spec
    const startedAt = this.active?.startedAt ?? this.clock.now()
    const now = this.clock.now()
    const base: Record<string, unknown> = {
      nodeId: node.id,
      kind: spec.type,
      mounted,
      hint: beatHint(node),
      durationSec: node.durationSec,
      during: node.during,
      countdownPercent: countdownPercent(startedAt, now, node.durationSec),
      spec,
    }
    if (spec.type === 'tap') {
      base.taps = this.tapSession.taps
      base.tapPercent = tapPercent(this.tapSession, spec)
    } else if (spec.type === 'timing') {
      base.timingPosition = timingFrameAt(startedAt, now, spec).position
    } else if (spec.type === 'hold') {
      base.holdPercent = holdFrameAt(this.holdSession, now, spec).percent
    } else if (spec.type === 'choice') {
      base.options = visibleOptions(spec.options, this.run.vars, this.program.variables).map((entry) => ({ ...entry.option, locked: entry.locked, shopItemId: entry.shopItemId }))
      base.prompt = spec.prompt || node.title
    }
    return base
  }

  private buildShop(): Record<string, unknown> {
    const currencyId = this.program.shop?.currencyVariableId ?? null
    const currency = currencyId ? this.program.variables.find((variable) => variable.id === currencyId && variable.type === 'number') : undefined
    return {
      items: shopItemViews(this.program, this.run, this.profile.bought),
      currency: currency ? { id: currency.id, name: currency.name, icon: currency.icon ?? null } : null,
      balance: currency ? this.run.vars[currency.id] ?? currency.initial : null,
      error: this.shopError,
      focusItemId: this.shopFocusItemId,
      notice: this.sheetNotice,
    }
  }

  private buildSavesSheet(): Record<string, unknown> {
    const slotView = (slot: { savedAt: number; snapshot: StoryRunSnapshot } | null) => {
      if (!slot) return null
      const label = snapshotLabel(this.program, slot.snapshot)
      const valid = restoreRun(this.program, slot.snapshot, { permanent: this.permanent }) !== null
      return { savedAt: slot.savedAt, timeText: saveTimeText(slot.savedAt), chapter: label?.chapter ?? '', node: label?.node ?? '', valid }
    }
    return {
      auto: slotView(this.saves.auto),
      slots: this.saves.slots.map((slot, index) => ({ index, ...(slotView(slot) ?? { empty: true }) })),
      checkpoints: Object.entries(this.saves.checkpoints).map(([key, slot]) => ({ key, ...slotView(slot) })),
      canSave: snapshotRun(this.run) !== null,
      notice: this.sheetNotice,
      slotCount: STORY_SAVE_SLOTS,
    }
  }

  private buildAchievements(): Record<string, unknown> {
    const progress = achievementProgress(this.program, this.profile)
    const context = { places: storyPlaces(this.program.chapters), variables: this.program.variables }
    return {
      progress,
      cosmetics: cosmeticsOf(this.program, this.profile),
      equipped: equippedLook(this.program, this.profile),
      equippedIds: { title: this.profile.equipped.title, frame: this.profile.equipped.frame },
      items: (this.program.achievements ?? []).map((achievement: StoryAchievement) => ({
        id: achievement.id,
        name: achievement.name,
        description: achievement.description || achievementConditionText(achievement.condition, context),
        icon: achievement.icon,
        earned: this.profile.achievements.includes(achievement.id),
        rewardText: achievementRewardText(achievement.reward),
      })),
    }
  }
}
