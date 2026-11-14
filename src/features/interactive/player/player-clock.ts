/** One clock for every real-time interaction timer, so a test can stub it in one place. */
function wallNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

let pauseDepth = 0
let pausedAtMs = 0
let pausedTotalMs = 0

/**
 * The player clock: wall time minus every stretch spent in a shop sheet. Freezing the clock rather
 * than each timer keeps a running countdown, timing pointer or hold exactly where it was.
 */
export function playerNow(): number {
  return (pauseDepth > 0 ? pausedAtMs : wallNow()) - pausedTotalMs
}

/** Stops every timer that reads playerNow; balanced with resumePlayerClock (nestable). */
export function pausePlayerClock(): void {
  if (pauseDepth === 0) pausedAtMs = wallNow()
  pauseDepth += 1
}

export function resumePlayerClock(): void {
  if (pauseDepth === 0) return
  pauseDepth -= 1
  if (pauseDepth === 0) pausedTotalMs += wallNow() - pausedAtMs
}

export function isPlayerClockPaused(): boolean {
  return pauseDepth > 0
}
