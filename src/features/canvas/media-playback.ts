/**
 * The card player and the enlarged preview show the same file in two different DOM nodes.
 * Keeping one position per media URL lets the preview continue where the card stopped
 * instead of starting over, and lets the card resume after the preview closes.
 */
export type MediaPlayback = { time: number; playing: boolean }

const positions = new Map<string, MediaPlayback>()
const players = new Map<string, Set<HTMLMediaElement>>()

export function rememberPlayback(src: string, time: number, playing: boolean) {
  if (!src) return
  positions.set(src, { time: Number.isFinite(time) && time > 0 ? time : 0, playing })
}

export function recallPlayback(src: string): MediaPlayback | undefined {
  return src ? positions.get(src) : undefined
}

export function attachMediaPlayer(src: string, media: HTMLMediaElement) {
  if (!src) return () => {}
  const group = players.get(src) ?? new Set<HTMLMediaElement>()
  group.add(media)
  players.set(src, group)
  return () => {
    group.delete(media)
    if (!group.size) players.delete(src)
  }
}

/**
 * Pauses every other player on the same file and returns its exact position, so the
 * enlarged preview can continue from there rather than from the poster frame.
 */
export function handOffMediaPlayback(src: string, keep?: HTMLMediaElement): MediaPlayback | undefined {
  let latest = recallPlayback(src)
  for (const media of players.get(src) ?? []) {
    if (media === keep) continue
    if (media.readyState > 0) latest = { time: media.currentTime, playing: !media.paused && !media.ended }
    if (!media.paused) media.pause()
  }
  return latest
}

/** After the enlarged preview closes, the remaining card players jump back to where it stopped. */
export function syncMediaPlayers(src: string, options: { keep?: HTMLMediaElement; resume?: boolean } = {}) {
  const playback = recallPlayback(src)
  if (!playback || playback.time <= 0) return
  for (const media of players.get(src) ?? []) {
    if (media === options.keep || media.readyState === 0) continue
    if (media.duration && playback.time >= media.duration - 0.05) continue
    media.currentTime = playback.time
    if (options.resume) void media.play().catch(() => {})
  }
}
