/**
 * Decide whether an externally supplied frame should seek the Remotion player.
 *
 * While playing, frame updates originate from the player itself and may arrive
 * back through React a few frames late. Seeking to those stale values causes a
 * visible replay loop. All deliberate timeline seeks pause playback first, so
 * paused state is the only state in which prop-to-player synchronization is
 * required.
 */
export function shouldSynchronizePlayerFrame(
  requestedFrame: number,
  playerFrame: number,
  playing: boolean,
) {
  if (playing || !Number.isFinite(requestedFrame) || !Number.isFinite(playerFrame)) return false
  return Math.abs(Math.round(requestedFrame) - Math.round(playerFrame)) > 1
}

/** Ignore duplicate frame events. Remotion can emit frameupdate again after a
 * composition re-render even though the playhead did not move. Publishing that
 * value back into React creates a player -> state -> player feedback loop. */
export function shouldPublishPlayerFrame(frame: number, lastPublishedFrame: number | null) {
  if (!Number.isFinite(frame)) return false
  return Math.round(frame) !== lastPublishedFrame
}

export type PendingSeekFrameDecision = 'publish' | 'ignore' | 'settled'

/**
 * A timeline click updates React before Remotion has necessarily processed the
 * matching seek. Any queued frameupdate from the old position must not be
 * allowed to overwrite the user's new playhead position.
 */
export function decidePendingSeekFrame(
  playerFrame: number,
  pendingSeekFrame: number | null,
): PendingSeekFrameDecision {
  if (!Number.isFinite(playerFrame)) return 'ignore'
  if (pendingSeekFrame === null || !Number.isFinite(pendingSeekFrame)) return 'publish'
  return Math.abs(Math.round(playerFrame) - Math.round(pendingSeekFrame)) <= 1
    ? 'settled'
    : 'ignore'
}

/**
 * While the player is running, let the native media element advance without
 * Remotion repeatedly correcting small timestamp differences. This matters
 * for variable-frame-rate and remote videos: a corrective seek can visibly
 * replay the preceding frames. Paused playback keeps Remotion's default,
 * frame-accurate synchronization for scrubbing and trim edits.
 */
export function getPlaybackTimeShiftTolerance(
  playing: boolean,
  durationInFrames: number,
  fps: number,
): number | undefined {
  if (!playing || !Number.isFinite(durationInFrames) || !Number.isFinite(fps) || durationInFrames <= 0 || fps <= 0) {
    return undefined
  }

  return durationInFrames / fps
}
