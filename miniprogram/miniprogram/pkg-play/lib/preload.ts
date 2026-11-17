import { advanceRun, interactionHandles, visibleOptions } from '../../runtime/story-runtime'
import type { StoryProgram, StoryRun } from '../../runtime/story-runtime'

/** 分歧统计：nodeId → optionId → 选择人数。optionId 为 '' 时表示结局首次到达（B5 提供数据）。 */
export type BranchStats = Record<string, Record<string, number>>

export interface PreloadCandidate {
  /** 观众要做的选择/互动结果；scene 自然播完为 null。 */
  handle: string | null
  /** 下一段 scene 的媒体引用（program 里的 mp:<id> 或原始 url），由 controller 解析成 CDN 地址。 */
  url: string
  projectId: string
  nodeId: string
}

/**
 * 引擎是纯函数：对每个可见且开放的选项模拟一次 advanceRun，取「下一个是有视频的 scene」作为候选。
 * 重试（stop 不变）与无视频的后继都排除，按媒体 url 去重。
 */
export function preloadCandidates(program: StoryProgram, run: StoryRun): PreloadCandidate[] {
  const { stop } = run
  let handles: Array<string | null>
  if (stop.kind === 'choice') {
    handles = visibleOptions(stop.node.options, run.vars, program.variables)
      .filter((view) => !view.locked)
      .map((view) => view.option.id)
  } else if (stop.kind === 'interaction') {
    handles = interactionHandles(stop.node.spec)
  } else if (stop.kind === 'scene') {
    handles = [null]
  } else {
    return []
  }
  const out: PreloadCandidate[] = []
  const seen = new Set<string>()
  for (const handle of handles) {
    const next = advanceRun(program, run, handle ?? undefined)
    if (next.stop === stop) continue
    const target = next.stop
    if (target.kind !== 'scene') continue
    const media = target.node.media
    if (!media || media.kind !== 'video') continue
    if (seen.has(media.url)) continue
    seen.add(media.url)
    out.push({ handle, url: media.url, projectId: target.projectId, nodeId: target.node.id })
  }
  return out
}

/** 有分歧统计时选占比最高的候选，否则选第一个。最多预载 1 段。 */
export function pickPreloadTarget(
  candidates: readonly PreloadCandidate[],
  nodeId: string,
  stats: BranchStats | null,
): PreloadCandidate | null {
  if (!candidates.length) return null
  const counts = stats?.[nodeId]
  if (counts) {
    let best: PreloadCandidate | null = null
    let bestCount = 0
    for (const candidate of candidates) {
      const count = candidate.handle === null ? 0 : counts[candidate.handle] ?? 0
      if (count > bestCount) {
        bestCount = count
        best = candidate
      }
    }
    if (best) return best
  }
  return candidates[0]
}

const WAITING_WINDOW_MS = 30000
const WAITING_LIMIT = 3

/** 播放中 30s 内收到 3 次以上 waiting 就降档，之后保持 480（当前片段不切换）。 */
export class WaitingTracker {
  private stamps: number[] = []
  private degraded = false

  note(nowMs: number): boolean {
    if (this.degraded) return true
    this.stamps = this.stamps.filter((t) => nowMs - t <= WAITING_WINDOW_MS)
    this.stamps.push(nowMs)
    if (this.stamps.length >= WAITING_LIMIT) this.degraded = true
    return this.degraded
  }

  get isDegraded(): boolean {
    return this.degraded
  }

  reset(): void {
    this.stamps = []
    this.degraded = false
  }
}
