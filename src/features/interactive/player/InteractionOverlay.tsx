'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { ArrowRight } from '@/components/ui/icons'
import { beatTimeoutHandle, visibleOptions, type StoryRun } from '@/lib/interactive/engine'
import { interactionTimeoutHandle, STORY_SWIPE_LABEL } from '@/lib/interactive/interaction'
import type { StoryInteractionNode, StoryInteractionSpec, StorySwipeDirection, StoryVariable } from '@/lib/interactive/types'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { ChoicePanel } from '../ChoicePanel'
import { HotspotOverlay } from './HotspotOverlay'
import { InteractionCountdown } from './InteractionCountdown'
import { lockedOptionPress } from './locked-choice'
import {
  beatHint,
  holdFrameAt,
  holdRelease,
  holdStart,
  holdStop,
  holdTimeout,
  identityDirection,
  initialHoldSession,
  initialTapSession,
  registerTap,
  swipeMoveTo,
  swipeStart,
  tapHandle,
  tapPercent,
  timingFrameAt,
  timingTapAt,
  type DirectionMapping,
  type HoldSession,
  type SwipeSession,
  type TapSession,
} from './interaction-sessions'
import { playerNow } from './player-clock'
import { unturnDelta, type StageTurn } from './stage-orientation'

type TapSpec = Extract<StoryInteractionSpec, { type: 'tap' }>
type SwipeSpec = Extract<StoryInteractionSpec, { type: 'swipe' }>
type TimingSpec = Extract<StoryInteractionSpec, { type: 'timing' }>
type HoldSpec = Extract<StoryInteractionSpec, { type: 'hold' }>

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)

function capturePointer(target: Element, pointerId: number) {
  try {
    target.setPointerCapture?.(pointerId)
  } catch {
    // A synthetic pointer event (tests, automation) has no active pointer to capture.
  }
}

function vibrate() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(15)
}

/** Pads read the latest emit through a stable callback so rAF loops never capture a stale one. */
function useStableEmit(onResult: (handle: string) => void) {
  const callback = useRef(onResult)
  useEffect(() => {
    callback.current = onResult
  })
  return useCallback((handle: string) => callback.current(handle), [])
}

export interface InteractionOverlayProps {
  node: StoryInteractionNode
  orientation: 'portrait' | 'landscape'
  /** `playerNow()` when the interaction appeared; every timer counts from here. */
  startedAt: number
  onResult: (handle: string) => void
  /** Overrides the node's own limit, used by tests and by the standalone stop. */
  durationSec?: number
  /** Seam for rotated screens: remaps the expected swipe direction. Identity for now. */
  mapDirection?: DirectionMapping
  /** How far the picture is turned clockwise; only affects how a swipe drag is drawn. */
  turn?: StageTurn
  /** The play as it stands: choice cards unlock live when a value changes (e.g. after a purchase). */
  run?: StoryRun
  /** The story's values, used to evaluate unlock rules. */
  variables?: StoryVariable[]
  /** A locked choice card linked to a shop item; absent falls back to the unlock hint. */
  onOpenShop?: (itemId: string) => void
  className?: string
}

/**
 * The shared viewer overlay for all five interactions. Mounted beats and standalone
 * interaction stops render this same component over the picture.
 */
export function InteractionOverlay({
  node,
  orientation,
  startedAt,
  onResult,
  durationSec = node.durationSec,
  mapDirection = identityDirection,
  turn = 0,
  run,
  variables = [],
  onOpenShop,
  className,
}: InteractionOverlayProps) {
  const spec = node.spec
  const emit = useStableEmit(onResult)
  const holdSessionRef = useRef<HoldSession>(initialHoldSession)
  const timingPressRef = useRef<(() => void) | null>(null)
  const hint = beatHint(node)
  const [lockedHint, setLockedHint] = useState(0)
  // A choice resolves on its timeout through the run's values, so a locked default is never auto-picked.
  const timeoutHandle = spec.type === 'choice'
    ? beatTimeoutHandle(spec, run?.vars ?? {}, variables)
    : interactionTimeoutHandle(spec)
  const choiceViews = useMemo(
    () => (spec.type === 'choice' ? visibleOptions(spec.options, run?.vars ?? {}, variables) : []),
    [spec, run?.vars, variables],
  )
  useEffect(() => {
    if (!lockedHint) return
    const timer = setTimeout(() => setLockedHint(0), 2200)
    return () => clearTimeout(timer)
  }, [lockedHint])
  const handleTimeout = () => {
    if (spec.type === 'hold') {
      emit(holdTimeout(holdSessionRef.current, playerNow(), spec))
      return
    }
    if (timeoutHandle) emit(timeoutHandle)
  }
  const handleLocked = (optionId: string) => {
    if (spec.type !== 'choice') return
    const press = lockedOptionPress(spec.options, optionId, run?.vars ?? {}, variables)
    if (press.kind === 'shop' && onOpenShop) onOpenShop(press.itemId)
    else if (press.kind !== 'none') setLockedHint((count) => count + 1)
  }
  const rootClass = `nori-int-overlay is-${spec.type} is-${orientation}${className ? ` ${className}` : ''}`

  if (spec.type === 'hotspot') {
    return <HotspotOverlay node={node} orientation={orientation} startedAt={startedAt} durationSec={durationSec} turn={turn} className={className} onResult={emit} />
  }

  if (spec.type === 'choice') {
    return (
      <div className={rootClass} data-testid="interaction-overlay" data-kind="choice">
        <ChoicePanel
          prompt={spec.prompt || node.title}
          options={choiceViews.map((view) => ({ ...view.option, locked: view.locked }))}
          panelStyle={spec.panelStyle}
          layout={spec.layout}
          orientation={orientation}
          onChoose={emit}
          onLockedPress={handleLocked}
          className="nori-int-choice-panel"
          header={(
            <>
              <InteractionCountdown startedAt={startedAt} durationSec={durationSec} onTimeout={handleTimeout} inline />
              {lockedHint ? <p className="nori-choice-lock-hint" role="status" data-testid="locked-hint">还没有解锁</p> : null}
            </>
          )}
        />
      </div>
    )
  }

  return (
    <div
      className={rootClass}
      data-testid="interaction-overlay"
      data-kind={spec.type}
      onPointerDown={spec.type === 'timing' ? (event) => { event.preventDefault(); timingPressRef.current?.() } : undefined}
    >
      <InteractionCountdown startedAt={startedAt} durationSec={durationSec} onTimeout={handleTimeout} />
      <div className="nori-int-body">
        <p className="nori-int-hint">{hint}</p>
        {spec.type === 'tap' ? <TapPad spec={spec} emit={emit} /> : null}
        {spec.type === 'swipe' ? <SwipePad spec={spec} mapDirection={mapDirection} turn={turn} emit={emit} /> : null}
        {spec.type === 'timing' ? <TimingPad spec={spec} startedAt={startedAt} pressRef={timingPressRef} emit={emit} /> : null}
        {spec.type === 'hold' ? <HoldPad spec={spec} sessionRef={holdSessionRef} emit={emit} /> : null}
      </div>
    </div>
  )
}

/* ---------- 快速点击 ---------- */

function TapPad({ spec, emit }: { spec: TapSpec; emit: (handle: string) => void }) {
  const sessionRef = useRef<TapSession>(initialTapSession)
  const doneRef = useRef(false)
  const [taps, setTaps] = useState(0)
  const percent = tapPercent(sessionRef.current, spec)
  const circumference = 2 * Math.PI * 54
  const image = display(spec.buttonImageUrl)
  const onTap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (doneRef.current) return
    sessionRef.current = registerTap(sessionRef.current)
    setTaps(sessionRef.current.taps)
    vibrate()
    const handle = tapHandle(sessionRef.current, spec)
    if (handle) {
      doneRef.current = true
      emit(handle)
    }
  }
  return (
    <div className="nori-int-tap" data-testid="tap-pad">
      <svg className="nori-int-tap-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="is-track" cx="60" cy="60" r="54" />
        <circle
          className="is-progress"
          cx="60"
          cy="60"
          r="54"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <button
        type="button"
        className="nori-int-tap-btn"
        data-testid="tap-button"
        aria-label={spec.buttonText || '快速点击按钮'}
        onPointerDown={onTap}
        onContextMenu={(event) => event.preventDefault()}
      >
        {image ? <MediaImage src={image} alt="" fill sizes="120px" draggable={false} /> : null}
        {image && !spec.buttonText.trim() ? null : <span key={taps} className="nori-int-tap-label">{spec.buttonText.trim() || '点击'}</span>}
      </button>
      <span className="nori-int-tap-count" data-testid="tap-count">{taps} / {spec.count}</span>
    </div>
  )
}

/* ---------- 方向滑动 ---------- */

function SwipePad({ spec, mapDirection, turn, emit }: { spec: SwipeSpec; mapDirection: DirectionMapping; turn: StageTurn; emit: (handle: string) => void }) {
  const sessionRef = useRef<SwipeSession | null>(null)
  const doneRef = useRef(false)
  const [delta, setDelta] = useState({ dx: 0, dy: 0 })
  const image = display(spec.buttonImageUrl)
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (doneRef.current) return
    event.preventDefault()
    capturePointer(event.currentTarget, event.pointerId)
    sessionRef.current = swipeStart(event.clientX, event.clientY)
    setDelta({ dx: 0, dy: 0 })
  }
  const track = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current
    if (!session || doneRef.current) return
    const result = swipeMoveTo(session, event.clientX, event.clientY, spec.direction, mapDirection)
    sessionRef.current = result.session
    setDelta({ dx: result.dx, dy: result.dy })
    if (result.judgement !== 'pending') {
      sessionRef.current = null
      doneRef.current = true
      emit(result.judgement)
    }
  }
  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current
    if (!session || doneRef.current) return
    sessionRef.current = null
    const result = swipeMoveTo(session, event.clientX, event.clientY, spec.direction, mapDirection)
    if (result.judgement !== 'pending') {
      doneRef.current = true
      emit(result.judgement)
    }
  }
  const drawn = unturnDelta(
    Math.max(-90, Math.min(90, delta.dx)),
    Math.max(-90, Math.min(90, delta.dy)),
    turn,
  )
  return (
    <div
      className="nori-int-swipe"
      data-testid="swipe-area"
      onPointerDown={onDown}
      onPointerMove={track}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <span className={`nori-int-swipe-guide is-${spec.direction}`} aria-hidden="true">
        <ArrowRight />
      </span>
      <div
        className="nori-int-swipe-btn"
        data-testid="swipe-button"
        style={{ transform: `translate(${drawn.dx}px, ${drawn.dy}px)` }}
      >
        {image ? <MediaImage src={image} alt="" fill sizes="140px" draggable={false} /> : null}
        <span>{spec.buttonText.trim() || `${STORY_SWIPE_LABEL[spec.direction]}滑动`}</span>
      </div>
      <span className="nori-int-swipe-tip">按住拖动，{STORY_SWIPE_LABEL[spec.direction]}</span>
    </div>
  )
}

/* ---------- 时机点击 ---------- */

function TimingPad({ spec, startedAt, pressRef, emit }: {
  spec: TimingSpec
  startedAt: number
  pressRef: MutableRefObject<(() => void) | null>
  emit: (handle: string) => void
}) {
  const [position, setPosition] = useState(() => timingFrameAt(startedAt, playerNow(), spec).position)
  const doneRef = useRef(false)
  const image = display(spec.propImageUrl)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setPosition(timingFrameAt(startedAt, playerNow(), spec).position)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spec, startedAt])
  useEffect(() => {
    pressRef.current = () => {
      if (doneRef.current) return
      doneRef.current = true
      emit(timingTapAt(startedAt, playerNow(), spec))
    }
    return () => {
      pressRef.current = null
    }
  }, [emit, pressRef, spec, startedAt])
  return (
    <div className="nori-int-timing" data-testid="timing-pad" data-position={position.toFixed(4)}>
      <div className="nori-int-timing-bar">
        <i
          className="nori-int-timing-zone is-normal"
          style={{ left: `${50 - spec.normalWidth / 2}%`, width: `${spec.normalWidth}%` }}
        />
        <i
          className="nori-int-timing-zone is-perfect"
          style={{ left: `${50 - spec.perfectWidth / 2}%`, width: `${spec.perfectWidth}%` }}
        />
        <span className="nori-int-timing-pointer" style={{ left: `${position * 100}%` }}>
          {image ? <MediaImage src={image} alt="" fill sizes="40px" draggable={false} /> : null}
        </span>
      </div>
      <span className="nori-int-timing-tip">当指针进入亮色区域时点击</span>
    </div>
  )
}

/* ---------- 长按蓄力 ---------- */

function HoldPad({ spec, sessionRef, emit }: {
  spec: HoldSpec
  sessionRef: MutableRefObject<HoldSession>
  emit: (handle: string) => void
}) {
  const doneRef = useRef(false)
  const [percent, setPercent] = useState(0)
  const image = display(spec.buttonImageUrl)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const session = sessionRef.current
      if (session.holding) {
        const frame = holdFrameAt(session, playerNow(), spec)
        setPercent(frame.percent)
        if (frame.overcharged && !doneRef.current) {
          doneRef.current = true
          emit('fail')
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [emit, sessionRef, spec])
  const onDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (doneRef.current) return
    event.preventDefault()
    capturePointer(event.currentTarget, event.pointerId)
    sessionRef.current = holdStart(playerNow())
    setPercent(0)
  }
  const onRelease = () => {
    if (doneRef.current) return
    const session = sessionRef.current
    sessionRef.current = holdStop()
    if (!session.holding) return
    doneRef.current = true
    emit(holdRelease(session, playerNow(), spec).judgement)
  }
  return (
    <div className="nori-int-hold" data-testid="hold-pad">
      <button
        type="button"
        className="nori-int-hold-btn"
        data-testid="hold-button"
        aria-label={spec.buttonText || '长按蓄力按钮'}
        onPointerDown={onDown}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onContextMenu={(event) => event.preventDefault()}
      >
        <i
          className="nori-int-hold-band"
          style={{ bottom: `${spec.rangeMin}%`, height: `${Math.max(0, spec.rangeMax - spec.rangeMin)}%` }}
        />
        <i className="nori-int-hold-fill" style={{ height: `${percent}%` }} />
        {image ? <MediaImage src={image} alt="" fill sizes="132px" draggable={false} /> : null}
        <span className="nori-int-hold-label">{spec.buttonText.trim() || '按住蓄力'}</span>
      </button>
      <span className="nori-int-hold-hint">在绿色区间内松手</span>
    </div>
  )
}
