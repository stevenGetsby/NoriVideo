'use client'

import { useEffect, useRef, useState } from 'react'
import { isCountdownExpired, remainingSec } from './beat-scheduler'
import { playerNow } from './player-clock'

/**
 * The thin real-time bar on an interaction overlay (and the header of the choice panel).
 * It reads the wall clock, so it is unaffected by the video's playbackRate.
 */
export function InteractionCountdown({ startedAt, durationSec, onTimeout, inline = false }: {
  startedAt: number
  durationSec: number
  onTimeout: () => void
  /** Rendered inside the choice panel instead of pinned to the top of the overlay. */
  inline?: boolean
}) {
  const [left, setLeft] = useState(() => remainingSec(startedAt, playerNow(), durationSec))
  const timeoutRef = useRef(onTimeout)
  useEffect(() => {
    timeoutRef.current = onTimeout
  })
  useEffect(() => {
    let raf = 0
    let finished = false
    const tick = () => {
      const now = playerNow()
      setLeft(remainingSec(startedAt, now, durationSec))
      if (!finished && isCountdownExpired(startedAt, now, durationSec)) {
        finished = true
        timeoutRef.current()
        return
      }
      if (!finished) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [durationSec, startedAt])
  const percent = durationSec > 0 ? (left / durationSec) * 100 : 0
  return (
    <div
      className={`nori-int-countdown${inline ? ' is-inline' : ''}`}
      data-testid="interaction-countdown"
      role="timer"
      aria-label={`剩余 ${Math.ceil(left)} 秒`}
    >
      <i style={{ width: `${percent}%` }} />
      <span>{Math.ceil(left)}s</span>
    </div>
  )
}
