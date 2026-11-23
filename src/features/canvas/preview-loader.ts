export const MAX_IN_FLIGHT_PREVIEWS = 8
const STALL_RELEASE_MS = 10_000

type Waiter = { grant: () => void; settled: boolean }

export type PreviewLoader = {
  request(grant: () => void): () => void
  inFlight(): number
  queued(): number
}

export function createPreviewLoader(limit = MAX_IN_FLIGHT_PREVIEWS, stallMs = STALL_RELEASE_MS): PreviewLoader {
  const waiting: Waiter[] = []
  let active = 0

  const pump = () => {
    while (active < limit && waiting.length) {
      const waiter = waiting.shift()!
      if (waiter.settled) continue
      active += 1
      waiter.grant()
    }
  }

  return {
    request(grant) {
      const waiter: Waiter = { grant, settled: false }
      let granted = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const release = () => {
        if (waiter.settled) return
        waiter.settled = true
        if (timer) clearTimeout(timer)
        if (granted) {
          active -= 1
          pump()
        } else {
          const index = waiting.indexOf(waiter)
          if (index >= 0) waiting.splice(index, 1)
        }
      }
      waiter.grant = () => {
        granted = true
        timer = setTimeout(release, stallMs)
        grant()
      }
      waiting.push(waiter)
      pump()
      return release
    },
    inFlight: () => active,
    queued: () => waiting.filter((waiter) => !waiter.settled).length,
  }
}

export const previewLoader = createPreviewLoader()
