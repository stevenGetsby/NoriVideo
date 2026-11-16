'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, RotateCcw, X } from '@/components/ui/icons'
import { equipCosmetic, recordShopReward } from '@/lib/interactive/achievements'
import { STORY_KIND_LABEL } from '@/lib/interactive/compile'
import {
  advanceRun,
  initialVariables,
  isPermanentVariable,
  purchaseShopItem,
  startRun,
  type PurchaseFailure,
  type StoryRun,
} from '@/lib/interactive/engine'
import { nextSpeed, normalizeSpeed, playbackSpeeds } from '@/lib/interactive/playback'
import { hasRandomResults, resolveRandomHandle } from '@/lib/interactive/interaction'
import {
  restoreRun,
  snapshotLabel,
  snapshotRun,
  withManualSave,
  withoutManualSave,
  type StoryRunSnapshot,
} from '@/lib/interactive/saves'
import type { StoryAspectRatio, StoryMedia, StoryProgram, StoryVariables } from '@/lib/interactive/types'
import { AchievementSheet } from './player/AchievementSheet'
import { AchievementToast } from './player/AchievementToast'
import { ContinuePrompt } from './player/ContinuePrompt'
import { MapSheet } from './player/MapSheet'
import { autoSaveFor, checkpointFor, recordsEnabled } from './player/records'
import { useViewerRecords } from './player/use-viewer-records'
import { PlayerHud } from './PlayerHud'
import { PlayerStage } from './PlayerStage'
import { ShopSheet } from './ShopSheet'
import { nextAttempt } from './player/beat-scheduler'
import { browserPermanentStorage, clearPermanentValues, readPermanentValues, writePermanentValues } from './player/permanent-store'
import { pausePlayerClock, resumePlayerClock } from './player/player-clock'
import { directionMapping } from './player/stage-orientation'
import { useStageViewport } from './player/use-stage-viewport'
import './interactive.css'
import './player/records.css'

export type InteractivePlayerProps = {
  program: StoryProgram
  mode: 'story' | 'chapter'
  aspectRatio: StoryAspectRatio
  title: string
  projectId?: string
  entryNodeId?: string | null
  /** Scopes the browser-local storage of permanent values and viewer records; without it nothing is persisted. */
  storageKey?: string
  onClose: () => void
  onLocate?: (projectId: string, nodeId: string) => void
}

const PURCHASE_ERROR: Record<PurchaseFailure, string> = {
  no_shop: '商城还没有开启',
  unknown_item: '找不到这件商品',
  sold_out: '这件商品已经售罄',
  cannot_afford: '余额不足，买不起这件商品',
}

type PlayerSheet =
  | { kind: 'shop'; itemId: string | null }
  | { kind: 'achievements' }
  | { kind: 'map' }
  | null

/** `screen.orientation.lock` is absent on iPhone Safari and rejects on desktop, so both stay optional. */
type LockableOrientation = { lock?: (orientation: string) => Promise<void>; unlock?: () => void }

function lockLandscape() {
  try {
    const lock = (screen.orientation as unknown as LockableOrientation | undefined)?.lock?.('landscape')
    if (lock) void lock.catch(() => {})
  } catch {
    // No orientation lock here: the turned stage still fills the screen.
  }
}

function unlockOrientation() {
  try {
    (screen.orientation as unknown as LockableOrientation | undefined)?.unlock?.()
  } catch {
    // Nothing to unlock.
  }
}

type PromptMode = 'pending' | 'shown' | 'none'

function lastSceneMedia(program: StoryProgram, run: StoryRun): StoryMedia | null {
  for (let index = run.trail.length - 1; index >= 0; index -= 1) {
    const step = run.trail[index]
    if (step.kind !== 'scene') continue
    const node = program.chapters.find((chapter) => chapter.projectId === step.projectId)?.nodes.find((item) => item.id === step.nodeId)
    if (node?.kind === 'scene' && node.media) return node.media
  }
  return null
}

export function InteractivePlayer({ program, mode, aspectRatio, title, projectId, entryNodeId, storageKey, onClose, onLocate }: InteractivePlayerProps) {
  const entries = useMemo(() => (mode === 'chapter'
    ? program.chapters.find((chapter) => chapter.projectId === projectId)?.nodes.filter((node) => node.kind === 'entry') ?? []
    : []), [mode, program, projectId])
  const storage = useMemo(() => browserPermanentStorage(), [])
  const [entryId, setEntryId] = useState<string | null>(entryNodeId ?? entries[0]?.id ?? null)
  const [preset, setPreset] = useState<StoryVariables>(() => initialVariables(program.variables))
  /** Values kept from earlier plays; only read when a storageKey scopes them. */
  const [permanent, setPermanent] = useState<StoryVariables>(() => readPermanentValues(storage, storageKey, program.variables))
  const begin = useCallback((nextEntry = entryId, nextPreset = preset, nextPermanent = permanent) => startRun(program, {
    mode,
    projectId,
    entryNodeId: mode === 'chapter' ? nextEntry ?? undefined : entryNodeId ?? undefined,
    preset: nextPreset,
    permanent: nextPermanent,
  }), [entryId, entryNodeId, mode, permanent, preset, program, projectId])
  const [run, setRun] = useState<StoryRun>(() => begin())
  /** Re-mounts the stage only when the run actually moved to another stop; purchases keep it. */
  const [stopId, setStopId] = useState(0)
  /** A standalone interaction that chose 失败重来 settles onto the same stop; the overlay re-arms. */
  const [attempt, setAttempt] = useState(0)
  /** One of the player's sheets: shop, achievements, or map-and-saves. */
  const [sheet, setSheet] = useState<PlayerSheet>(null)
  const [shopError, setShopError] = useState<string | null>(null)
  const [sheetNotice, setSheetNotice] = useState<string | null>(null)
  /** The returning-viewer prompt and a short notice when an old save can no longer be restored. */
  const [promptMode, setPromptMode] = useState<PromptMode>(() => (recordsEnabled(program) ? 'pending' : 'none'))
  const [prompt, setPrompt] = useState<{ snapshot: StoryRunSnapshot; chapter: string; node: string; savedAt: number } | null>(null)
  const [continueNotice, setContinueNotice] = useState<string | null>(null)
  /** The viewer's speed: remembered across restarts, never persisted. */
  const [speed, setSpeed] = useState(1)
  const speeds = useMemo(() => playbackSpeeds(program.playback), [program.playback])
  const rate = normalizeSpeed(speed, speeds)
  const cycleSpeed = useCallback(() => {
    setSpeed((current) => nextSpeed(speeds, normalizeSpeed(current, speeds)))
  }, [speeds])
  const landscapeWork = aspectRatio !== '9:16'
  const viewport = useStageViewport(landscapeWork)
  const turn = viewport.turn
  const compact = viewport.compact || turn === 1
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  const [rotateHint, setRotateHint] = useState(false)
  const records = useViewerRecords({
    program,
    run,
    mode,
    storageKey,
    projectId,
    suspended: promptMode !== 'none',
  })
  const backdrop = useMemo(() => lastSceneMedia(program, run), [program, run])
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape'
  const sheetOpen = sheet !== null
  const paused = sheetOpen || promptMode === 'shown'
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const skipPermanentWrite = useRef(false)
  const promptDecided = useRef(false)
  const flushRecords = records.flush

  // Persist only the permanent values, after every run change that could have moved one.
  useEffect(() => {
    if (skipPermanentWrite.current) {
      skipPermanentWrite.current = false
      return
    }
    writePermanentValues(storage, storageKey, program.variables, run.vars)
  }, [program.variables, run.vars, storage, storageKey])

  // Any sheet or the continue prompt freezes the single player clock: every countdown / timer
  // resumes exactly where it was.
  useEffect(() => {
    if (!paused) return
    pausePlayerClock()
    return () => resumePlayerClock()
  }, [paused])

  // On opening, an automatic save offers to continue; one that no longer matches the edited story
  // says so and lets the story start normally.
  useEffect(() => {
    if (promptDecided.current) return
    if (!records.enabled) {
      promptDecided.current = true
      setPromptMode('none')
      return
    }
    if (!records.loaded) return
    promptDecided.current = true
    const auto = records.saves.auto
    if (!auto) {
      setPromptMode('none')
      return
    }
    const restored = restoreRun(program, auto.snapshot, { permanent })
    const label = snapshotLabel(program, auto.snapshot)
    if (!restored || !label) {
      records.setSaves((prev) => (prev.auto ? { ...prev, auto: null } : prev))
      setContinueNotice('上次的进度已失效，将从头开始')
      setPromptMode('none')
      return
    }
    setPrompt({ snapshot: auto.snapshot, chapter: label.chapter, node: label.node, savedAt: auto.savedAt })
    setPromptMode('shown')
  }, [records.enabled, records.loaded, records.saves.auto, records.setSaves, program, permanent])

  // The automatic continue point follows every resumable stop, and save-point segments unlock
  // their checkpoint as the run reaches them. Recording never advances or replays anything.
  useEffect(() => {
    if (!records.enabled || !records.loaded || promptMode !== 'none') return
    const now = Date.now()
    records.setSaves((prev) => checkpointFor(autoSaveFor(prev, program, run, now), program, run, now))
  }, [records.enabled, records.loaded, records.setSaves, promptMode, program, run])

  useEffect(() => {
    if (!continueNotice) return
    const timer = setTimeout(() => setContinueNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [continueNotice])

  useEffect(() => {
    const sync = () => {
      const active = document.fullscreenElement === frameRef.current
      setFullscreen(active)
      if (!active) unlockOrientation()
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // The hint only makes sense while the picture is turned and the phone is still upright.
  useEffect(() => {
    if (turn !== 1) {
      setRotateHint(false)
      return
    }
    setRotateHint(true)
    const timer = setTimeout(() => setRotateHint(false), 4200)
    return () => clearTimeout(timer)
  }, [turn])

  const closeSheet = useCallback(() => {
    setSheet(null)
    setShopError(null)
    setSheetNotice(null)
  }, [])

  const requestClose = useCallback(() => {
    flushRecords()
    onClose()
  }, [flushRecords, onClose])

  // Esc closes the open sheet first; only then the player.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (sheetRef.current) {
        event.preventDefault()
        event.stopPropagation()
        closeSheet()
        return
      }
      flushRecords()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSheet, flushRecords, onClose])

  const openShop = useCallback((itemId: string | null = null) => {
    setShopError(null)
    setSheetNotice(null)
    setSheet({ kind: 'shop', itemId })
  }, [])

  const openAchievements = useCallback(() => {
    setSheetNotice(null)
    setSheet({ kind: 'achievements' })
  }, [])

  const openMap = useCallback(() => {
    setSheetNotice(null)
    setSheet({ kind: 'map' })
  }, [])

  const toggleFullscreen = () => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    const request = frame.requestFullscreen?.()
    if (!request) return
    void request
      .then(() => {
        if (landscapeWork) lockLandscape()
      })
      .catch(() => {})
  }

  const restart = () => {
    const fresh = readPermanentValues(storage, storageKey, program.variables)
    setPermanent(fresh)
    setRun(begin(entryId, preset, fresh))
    setStopId((id) => id + 1)
    setAttempt(0)
    closeSheet()
    setContinueNotice(null)
  }

  const clearPermanentData = () => {
    clearPermanentValues(storage, storageKey)
    skipPermanentWrite.current = true
    setPermanent({})
    setRun(begin(entryId, preset, {}))
    setStopId((id) => id + 1)
    setAttempt(0)
    closeSheet()
  }

  const clearRecords = () => {
    records.clearRecords()
    closeSheet()
    setPrompt(null)
    setPromptMode('none')
    setContinueNotice(null)
  }

  const switchEntry = (nextEntry: string) => {
    setEntryId(nextEntry)
    setRun(begin(nextEntry))
    setStopId((id) => id + 1)
    setAttempt(0)
    closeSheet()
  }

  /** A mounted beat or a purchase changed the run: same stop means the video must keep its element and position. */
  const applyRun = (next: StoryRun) => {
    if (next.stop !== run.stop) setStopId((id) => id + 1)
    setRun(next)
  }

  /** The segment is over (video ended or 继续): always lands on another stop. */
  const continueFrom = (base?: StoryRun) => {
    const next = advanceRun(program, base ?? run)
    setRun(next)
    setStopId((id) => id + 1)
    setAttempt(0)
  }

  const choose = (handle: string) => {
    const node = run.stop.kind === 'interaction' ? run.stop.node : null
    const settled = node && hasRandomResults(node.results) ? resolveRandomHandle(node.spec, node.results, Math.random()) : handle
    if (!settled) return
    const next = advanceRun(program, run, settled)
    setAttempt(nextAttempt(attempt, run.stop, next))
    if (next.stop !== run.stop) setStopId((id) => id + 1)
    setRun(next)
  }

  const purchase = (itemId: string) => {
    const result = purchaseShopItem(program, run, itemId, records.profile.bought)
    if (!result.ok) {
      setShopError(PURCHASE_ERROR[result.reason])
      return
    }
    setShopError(null)
    records.setProfile((prev) => recordShopReward(program, prev, itemId))
    applyRun(result.run)
  }

  const equip = (part: 'title' | 'frame', cosmeticId: string | null) => {
    records.setProfile((prev) => equipCosmetic(program, prev, part, cosmeticId))
  }

  /** Loading a save replaces the run at its stop; restoreRun never re-applies that segment's effects. */
  const loadSnapshot = (snapshot: StoryRunSnapshot) => {
    const restored = restoreRun(program, snapshot, { permanent })
    if (!restored) {
      setSheetNotice('这个存档已失效，剧情可能已经更新')
      return
    }
    closeSheet()
    setRun(restored)
    setStopId((id) => id + 1)
    setAttempt(0)
  }

  const writeSlot = (index: number) => {
    const snapshot = snapshotRun(run)
    if (!snapshot) {
      setSheetNotice('现在还不能存档：先进入一个可继续的片段')
      return
    }
    const now = Date.now()
    records.setSaves((prev) => withManualSave(prev, index, snapshot, now))
    setSheetNotice(`已保存到存档位 ${index + 1}`)
  }

  const deleteSlot = (index: number) => {
    records.setSaves((prev) => withoutManualSave(prev, index))
    setSheetNotice(`已删除存档位 ${index + 1}`)
  }

  const resumePrompt = () => {
    const shown = prompt
    setPrompt(null)
    setPromptMode('none')
    if (!shown) return
    const restored = restoreRun(program, shown.snapshot, { permanent })
    if (!restored) {
      records.setSaves((prev) => (prev.auto ? { ...prev, auto: null } : prev))
      setContinueNotice('上次的进度已失效，将从头开始')
      return
    }
    setRun(restored)
    setStopId((id) => id + 1)
    setAttempt(0)
  }

  const restartPrompt = () => {
    setPrompt(null)
    setPromptMode('none')
    records.setSaves((prev) => (prev.auto ? { ...prev, auto: null } : prev))
    setStopId((id) => id + 1)
    setAttempt(0)
  }

  const hasPermanent = program.variables.some(isPermanentVariable)
  const turnStyle = turn === 1 ? {
    width: `${viewport.height}px`,
    height: `${viewport.width}px`,
    transform: `translateX(${viewport.width}px) rotate(90deg)`,
  } : undefined

  return createPortal(
    <>
      <div className={`nori-player-turn${turn === 1 ? ' is-turned' : ''}`} ref={frameRef} style={turnStyle}>
      <div className={`nori-player nori-force-dark${compact ? ' is-compact' : ''}`} role="dialog" aria-modal="true" aria-label={`试玩：${title}`}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key !== 'Escape') return
          if (sheetRef.current) closeSheet()
          else requestClose()
        }}
        onPointerDown={(event) => event.stopPropagation()}>
      {compact ? (
        <div className="nori-compact-bar">
          <button type="button" className="is-icon" aria-label="关闭试玩" title="关闭试玩" data-testid="close-player" onClick={requestClose}><X /></button>
          <button type="button" className="is-icon" aria-label="重新开始" title="重新开始" data-testid="compact-restart" onClick={restart}><RotateCcw /></button>
          {fullscreenSupported ? (
            <button type="button" className="is-icon" aria-label={fullscreen ? '退出全屏' : '全屏播放'} title={fullscreen ? '退出全屏' : '全屏播放'} data-testid="compact-fullscreen" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
          ) : null}
        </div>
      ) : (
      <header className="nori-player-head">
        <div>
          <span className="nori-player-mode">{mode === 'story' ? '全剧试玩' : '单章试玩'}</span>
          <strong>{title}</strong>
          <span className="nori-player-format">{aspectRatio === '9:16' ? '竖屏 9:16' : '横屏 16:9'}</span>
        </div>
        <div>
          <button type="button" onClick={restart}><RotateCcw />重新开始</button>
          <button type="button" className="is-icon" aria-label="关闭试玩" data-testid="close-player" onClick={requestClose}><X /></button>
        </div>
      </header>
      )}
      <div className="nori-player-body">
        <div className="nori-player-stage-wrap">
          <div className={`nori-player-stage is-${orientation}`}>
            {promptMode === 'none' ? (
              <PlayerStage
                key={`stop-${stopId}`}
                program={program}
                run={run}
                backdrop={backdrop}
                orientation={orientation}
                attempt={attempt}
                paused={paused}
                baseRate={rate}
                mapDirection={directionMapping(turn)}
                turn={turn}
                onOpenShop={openShop}
                onRunChange={applyRun}
                onContinue={continueFrom}
                onChoose={choose}
                onRestart={restart}
                onLocate={onLocate ? (chapterId, nodeId) => { requestClose(); onLocate(chapterId, nodeId) } : undefined}
              />
            ) : (
              <div className="nori-player-media is-empty" />
            )}
            {promptMode === 'shown' && prompt ? (
              <ContinuePrompt chapter={prompt.chapter} node={prompt.node} savedAt={prompt.savedAt} onResume={resumePrompt} onRestart={restartPrompt} />
            ) : null}
            {promptMode === 'none' ? (
              <PlayerHud
                program={program}
                run={run}
                orientation={orientation}
                profile={records.profile}
                speeds={speeds}
                rate={rate}
                onCycleSpeed={cycleSpeed}
                onOpenShop={() => openShop(null)}
                onOpenAchievements={openAchievements}
                onOpenMap={openMap}
              />
            ) : null}
            {promptMode === 'none' ? <AchievementToast toasts={records.toasts} /> : null}
            {continueNotice ? <p className="nori-continue-notice" role="status" data-testid="continue-notice">{continueNotice}</p> : null}
            {sheet?.kind === 'shop' ? (
              <ShopSheet
                program={program}
                run={run}
                orientation={orientation}
                focusItemId={sheet.itemId}
                error={shopError}
                ownedRewards={records.profile.bought}
                onPurchase={purchase}
                onClose={closeSheet}
              />
            ) : null}
            {sheet?.kind === 'achievements' ? (
              <AchievementSheet
                program={program}
                profile={records.profile}
                orientation={orientation}
                onEquip={equip}
                onClose={closeSheet}
              />
            ) : null}
            {sheet?.kind === 'map' ? (
              <MapSheet
                program={program}
                profile={records.profile}
                run={run}
                saves={records.saves}
                orientation={orientation}
                notice={sheetNotice}
                onResume={loadSnapshot}
                onWrite={writeSlot}
                onLoad={loadSnapshot}
                onDelete={deleteSlot}
                onClose={closeSheet}
              />
            ) : null}
          </div>
        </div>
        <aside className="nori-player-side">
          {mode === 'chapter' && entries.length > 1 ? (
            <section>
              <h3>入口</h3>
              <select value={entryId ?? ''} onChange={(event) => switchEntry(event.target.value)}>
                {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
              </select>
            </section>
          ) : null}
          <section>
            <h3>全局变量</h3>
            {program.variables.length === 0 ? <p className="nori-player-empty">没有全局变量</p> : (
              <table className="nori-player-vars">
                <thead><tr><th>变量</th><th>当前</th><th>起始</th></tr></thead>
                <tbody>
                  {program.variables.map((variable) => {
                    const value = run.vars[variable.id]
                    const changed = value !== preset[variable.id]
                    const isPermanent = isPermanentVariable(variable)
                    return (
                      <tr key={variable.id} className={changed ? 'is-changed' : ''} data-variable-id={variable.id} data-scope={isPermanent ? 'permanent' : 'run'}>
                        <td>
                          {variable.name}
                          {isPermanent ? <span className="nori-player-vars-tag" title="永久数值保存在浏览器中，跨次播放保留">永久</span> : null}
                        </td>
                        <td>{variable.type === 'boolean' ? (value ? '是' : '否') : String(value)}</td>
                        <td>
                          {isPermanent
                            ? <span className="nori-player-vars-saved" title="永久数值跟随浏览器存档">跟随存档</span>
                            : variable.type === 'boolean'
                              ? <input type="checkbox" checked={preset[variable.id] === true} onChange={(event) => setPreset({ ...preset, [variable.id]: event.target.checked })} />
                              : <input type="number" value={Number(preset[variable.id] ?? 0)} onChange={(event) => setPreset({ ...preset, [variable.id]: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })} />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {program.variables.length ? <button type="button" className="nori-player-side-action" onClick={restart}>用起始值重新开始</button> : null}
            {hasPermanent && storageKey ? (
              <button type="button" className="nori-player-side-action is-danger" data-testid="clear-permanent" onClick={clearPermanentData}>清除永久数据</button>
            ) : null}
          </section>
          {records.enabled && records.keyExists ? (
            <section>
              <h3>记录</h3>
              <button type="button" className="nori-player-side-action is-danger" data-testid="clear-records" onClick={clearRecords}>清除成就与存档</button>
            </section>
          ) : null}
          <section className="is-trail">
            <h3>路径</h3>
            <ol>
              {run.trail.map((step, index) => (
                <li key={`${index}:${step.nodeId}`}>
                  <span>{STORY_KIND_LABEL[step.kind]}</span>
                  <strong>{step.title}</strong>
                  {step.choice ? <em>→ {step.choice}</em> : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      </div>
      </div>
      {turn === 1 && rotateHint ? (
        <button type="button" className="nori-rotate-hint" data-testid="rotate-hint" onClick={() => setRotateHint(false)}>
          横屏观看更沉浸，把手机横过来即可
        </button>
      ) : null}
    </>,
    document.body,
  )
}
