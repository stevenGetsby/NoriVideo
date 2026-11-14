import type { RepaintValidation } from './contract'

/**
 * The 分镜 is plain text in the layout of the reference storyboards: a `## S1 [场景 · 时段 · 内外] 角色：…` heading with
 * a 造型 line, then one `### SH001 [00:00.0-00:02.8]` block per shot (镜头 / 画面 / 表情动作 / 光影 / 复刻补充 / 对白).
 * Everything here works on that text so the routes and the workbench share one reading of it: parse it, join the
 * rounds of a long video, line the shot boundaries up with the detected cuts, and count what is there.
 */

/** A storyboard that stops this close to the end of the video counts as finished (end cards, fade-outs). */
export const STORYBOARD_TAIL_TOLERANCE_SECONDS = 3

const LONG_SHOT_SECONDS = 12
const GAP_WARNING_SECONDS = 0.5
const OVERLAP_WARNING_SECONDS = 0.3
const BOUNDARY_HEAL_SECONDS = 0.35
const SNAP_TOLERANCE_SECONDS = 0.4
const MIN_SHOT_SECONDS = 0.3
const DUPLICATE_TOLERANCE_SECONDS = 0.15
const FIRST_SHOT_SNAP_SECONDS = 0.5
const MAX_MESSAGES = 12

export const STORYBOARD_REQUIRED_FIELDS = ['镜头', '画面', '表情动作', '光影'] as const
const FIELD_LABELS = [...STORYBOARD_REQUIRED_FIELDS, '复刻补充'] as const

export interface StoryboardShot {
  number: number
  start: number
  end: number
  /** Everything under the shot heading, as written. */
  lines: string[]
}

export interface StoryboardScene {
  number: number
  /** Text inside the heading's brackets, e.g. "堂屋客厅 · 日间 · 内". */
  title: string
  roles: string
  /** The 造型 lines between the scene heading and its first shot. */
  lines: string[]
  shots: StoryboardShot[]
  /** True when the shots came with no scene heading of their own. */
  implicit: boolean
}

export interface StoryboardDocument {
  scenes: StoryboardScene[]
}

export interface StoryboardNormalizeOptions {
  /** Seconds at which the picture visibly cuts; shot boundaries close to one are pulled onto it. */
  cutHints?: number[]
  durationSeconds?: number
}

export interface StoryboardSummary {
  sceneCount: number
  shotCount: number
  firstStart: number
  /** Where the last shot ends. */
  coveredSeconds: number
  dialogueCount: number
  /** Speaker names and the 角色 labels of the scene headings, in order of appearance. */
  roles: string[]
}

export interface StoryboardContinuation {
  shotCount: number
  /** Where the last shot ends; the next round starts here. */
  resumeAt: number
  lastScene: { number: number; title: string; roles: string; lines: string[] } | null
  roles: string[]
  /** The last two shots, verbatim. */
  tail: string
}

const TIME = '(\\d+(?::\\d+){0,2}(?:[.,]\\d+)?)(?:\\s*(?:s|秒))?'
const RANGE = new RegExp(`${TIME}\\s*(?:-|–|—|~|～|→|至|to)\\s*${TIME}`, 'i')
const SHOT_HEADING = /^\s{0,3}(?:#{1,4}\s*)?SH\s*0*(\d+)(?![0-9A-Za-z])(.*)$/i
const SCENE_HEADING = /^\s{0,3}#{1,3}\s*S\s*0*(\d+)(?![0-9A-Za-z])(.*)$/i
const FIELD_LINE = new RegExp(`^[-*•]?\\s*\\**\\s*(${FIELD_LABELS.join('|')})\\s*\\**\\s*[:：]\\s*(.*)$`)
const DIALOGUE_LINE = /^([^：:（()）{}｛｝]{1,24}?)\s*[（(]([^()（）]*)[)）]\s*[:：]\s*[{｛]/
const DIVIDER_LINE = /^\s*(?:`{3}.*|-{3,}|\*{3,}|_{3,})\s*$/

const round1 = (value: number): number => Math.round(value * 10) / 10
const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** `MM:SS.s`, `MM:SS`, `H:MM:SS.fff` and plain seconds. */
export function parseTimecode(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null
  if (parts.slice(1).some((part) => Number(part) >= 60)) return null
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** `MM:SS.s`; minutes keep counting past 59 so one shape fits every length. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths % 600) / 10
  return `${pad(minutes, 2)}:${rest.toFixed(1).padStart(4, '0')}`
}

const shotLabel = (shot: StoryboardShot): string => `SH${pad(shot.number, 3)}`

function parseSceneRest(rest: string): { title: string; roles: string } {
  let text = rest.trim()
  let roles = ''
  const rolesMatch = /(?:^|\s)角色\s*[:：]\s*(.*)$/.exec(text)
  if (rolesMatch) {
    roles = rolesMatch[1].trim()
    text = text.slice(0, rolesMatch.index).trim()
  }
  const bracket = /^[[【]\s*(.*?)\s*[\]】]/.exec(text)
  const title = bracket ? bracket[1] : text.replace(/^[:：\-–—·\s]+/, '').trim()
  return { title, roles }
}

function matchShotHeading(line: string): { number: number; start: number; end: number } | null {
  const head = SHOT_HEADING.exec(line)
  if (!head) return null
  const range = RANGE.exec(head[2])
  if (!range) return null
  const start = parseTimecode(range[1])
  const end = parseTimecode(range[2])
  if (start === null || end === null) return null
  return { number: Number(head[1]), start, end }
}

export function parseStoryboard(text: string): StoryboardDocument {
  const scenes: StoryboardScene[] = []
  let scene: StoryboardScene | null = null
  let shot: StoryboardShot | null = null

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (DIVIDER_LINE.test(raw)) continue
    const line = raw.trim()
    const shotHeading = matchShotHeading(line)
    if (shotHeading) {
      if (!scene) {
        scene = { number: scenes.length + 1, title: '', roles: '', lines: [], shots: [], implicit: true }
        scenes.push(scene)
      }
      shot = { number: shotHeading.number, start: shotHeading.start, end: shotHeading.end, lines: [] }
      scene.shots.push(shot)
      continue
    }
    const sceneHeading = SCENE_HEADING.exec(line)
    if (sceneHeading) {
      scene = { number: Number(sceneHeading[1]), ...parseSceneRest(sceneHeading[2]), lines: [], shots: [], implicit: false }
      scenes.push(scene)
      shot = null
      continue
    }
    if (!line) continue
    if (shot) shot.lines.push(line)
    else if (scene) scene.lines.push(line)
  }
  return { scenes }
}

function flatShots(document: StoryboardDocument): StoryboardShot[] {
  return document.scenes.flatMap((scene) => scene.shots)
}

function renumber(document: StoryboardDocument): void {
  let shotNumber = 0
  document.scenes.forEach((scene, index) => {
    scene.number = index + 1
    for (const shot of scene.shots) shot.number = ++shotNumber
  })
}

export function formatStoryboard(document: StoryboardDocument): string {
  const blocks: string[] = []
  for (const scene of document.scenes) {
    const heading = [`## S${scene.number}`, scene.title ? `[${scene.title}]` : '', scene.roles ? `角色：${scene.roles}` : '']
      .filter(Boolean)
      .join(' ')
    blocks.push([heading, ...scene.lines].join('\n'))
    for (const shot of scene.shots) {
      const range = `[${formatTimecode(shot.start)}-${formatTimecode(shot.end)}]`
      blocks.push([`### ${shotLabel(shot)} ${range}`, ...shot.lines].join('\n'))
    }
  }
  return blocks.join('\n\n')
}

function presentFields(shot: StoryboardShot): Set<string> {
  const found = new Set<string>()
  for (const line of shot.lines) {
    const match = FIELD_LINE.exec(line)
    if (match && match[2].trim()) found.add(match[1])
  }
  return found
}

function speakerOf(line: string): string | null {
  const match = DIALOGUE_LINE.exec(line)
  return match ? match[1].trim() : null
}

function splitRoles(roles: string): string[] {
  return roles
    .split(/[/／、，,]/)
    .map((role) => role.trim())
    .filter(Boolean)
}

function collectRoles(document: StoryboardDocument): string[] {
  const roles = new Set<string>()
  for (const scene of document.scenes) {
    splitRoles(scene.roles).forEach((role) => roles.add(role))
    for (const shot of scene.shots) {
      for (const line of shot.lines) {
        const speaker = speakerOf(line)
        if (speaker) roles.add(speaker)
      }
    }
  }
  return [...roles]
}

export function summarizeStoryboard(text: string): StoryboardSummary {
  const document = parseStoryboard(text)
  const shots = flatShots(document)
  return {
    sceneCount: document.scenes.filter((scene) => scene.shots.length > 0).length,
    shotCount: shots.length,
    firstStart: shots.length ? shots[0].start : 0,
    coveredSeconds: shots.length ? shots[shots.length - 1].end : 0,
    dialogueCount: shots.reduce((total, shot) => total + shot.lines.filter((line) => speakerOf(line) !== null).length, 0),
    roles: collectRoles(document),
  }
}

/** The last shot of a reply that ran out of room is cut off mid-sentence; drop it and the next round writes it again. */
export function dropTrailingShot(text: string): { text: string; dropped: boolean } {
  const document = parseStoryboard(text)
  const shots = flatShots(document)
  if (!shots.length) return { text: '', dropped: false }
  const last = shots[shots.length - 1]
  for (const scene of document.scenes) scene.shots = scene.shots.filter((shot) => shot !== last)
  document.scenes = document.scenes.filter((scene) => scene.shots.length > 0)
  return { text: formatStoryboard(document), dropped: true }
}

function mergeRoles(base: string, extra: string): string {
  const merged = splitRoles(base)
  for (const role of splitRoles(extra)) if (!merged.includes(role)) merged.push(role)
  return merged.join(' / ')
}

const sameTitle = (a: string, b: string): boolean => a.replace(/\s+/g, '') === b.replace(/\s+/g, '')

/**
 * Append the next round's shots to the storyboard written so far. The model is told to carry on after the last shot but
 * sometimes repeats a few; shots that end before the resume point are dropped and an overlapping start is clamped.
 */
export function mergeStoryboardContinuation(
  previous: string,
  addition: string,
): { text: string; addedShots: number } {
  const base = parseStoryboard(previous)
  const next = parseStoryboard(addition)
  const baseShots = flatShots(base)
  const resumeAt = baseShots.length ? baseShots[baseShots.length - 1].end : 0
  let addedShots = 0
  let first = true

  for (const scene of next.scenes) {
    const kept = scene.shots.filter((shot) => shot.end > resumeAt + DUPLICATE_TOLERANCE_SECONDS)
    if (!kept.length) continue
    if (first && kept[0].start < resumeAt) kept[0].start = resumeAt
    const last = base.scenes[base.scenes.length - 1]
    const continuesLast = first && last && (scene.implicit || sameTitle(scene.title, last.title))
    first = false
    addedShots += kept.length
    if (continuesLast) {
      last.shots.push(...kept)
      last.roles = mergeRoles(last.roles, scene.roles)
    } else {
      base.scenes.push({ ...scene, shots: kept })
    }
  }

  renumber(base)
  return { text: formatStoryboard(base), addedShots }
}

function nearestHint(hints: number[], value: number): number | null {
  let best: number | null = null
  let bestDistance = SNAP_TOLERANCE_SECONDS
  for (const hint of hints) {
    if (hint > value + SNAP_TOLERANCE_SECONDS) break
    const distance = Math.abs(hint - value)
    if (distance <= bestDistance) {
      best = hint
      bestDistance = distance
    }
  }
  return best
}

/**
 * Tidy the timeline: cut anything past the end of the video, close the small gaps and overlaps between neighbouring
 * shots, pull a boundary onto the detected cut next to it, and number the scenes and shots in order. Bigger gaps and
 * overlaps are left alone so validation can point at them.
 */
export function normalizeStoryboard(text: string, options: StoryboardNormalizeOptions = {}): string {
  const document = parseStoryboard(text)
  const duration = options.durationSeconds && options.durationSeconds > 0 ? options.durationSeconds : null
  const hints = [...new Set((options.cutHints ?? []).filter((hint) => Number.isFinite(hint) && hint > 0))].sort((a, b) => a - b)

  if (duration !== null) {
    for (const scene of document.scenes) {
      scene.shots = scene.shots.filter((shot) => shot.start < duration - 0.2)
      for (const shot of scene.shots) shot.end = Math.min(shot.end, duration)
    }
  }
  document.scenes = document.scenes.filter((scene) => scene.shots.length > 0)

  const shots = flatShots(document)
  for (let index = 0; index + 1 < shots.length; index += 1) {
    const before = shots[index]
    const after = shots[index + 1]
    if (Math.abs(after.start - before.end) > BOUNDARY_HEAL_SECONDS) continue
    const middle = (before.end + after.start) / 2
    const hint = nearestHint(hints, middle)
    for (const boundary of hint === null ? [middle] : [hint, middle]) {
      if (boundary - before.start >= MIN_SHOT_SECONDS && after.end - boundary >= MIN_SHOT_SECONDS) {
        before.end = boundary
        after.start = boundary
        break
      }
    }
  }

  if (shots.length) {
    const first = shots[0]
    const last = shots[shots.length - 1]
    if (first.start > 0 && first.start <= FIRST_SHOT_SNAP_SECONDS) first.start = 0
    if (duration !== null && Math.abs(duration - last.end) <= 0.5) last.end = duration
  }
  for (const shot of shots) {
    shot.start = round1(shot.start)
    shot.end = round1(shot.end)
  }

  renumber(document)
  return formatStoryboard(document)
}

function capMessages(messages: string[]): string[] {
  if (messages.length <= MAX_MESSAGES) return messages
  return [...messages.slice(0, MAX_MESSAGES), `另有 ${messages.length - MAX_MESSAGES} 条提示已省略`]
}

export function validateStoryboard(text: string, options: { durationSeconds?: number } = {}): RepaintValidation {
  const shots = flatShots(parseStoryboard(text))
  if (!shots.length) {
    return { valid: false, errors: ['分镜里没有可识别的镜头（缺少「### SH001 [起-止]」标题）'], warnings: [] }
  }

  // Coverage first: the message cap below must never hide that the storyboard stops early.
  const coverage: string[] = []
  const duration = options.durationSeconds
  if (duration && duration > 0) {
    const firstStart = shots[0].start
    const lastEnd = shots[shots.length - 1].end
    if (firstStart > GAP_WARNING_SECONDS + 0.5) coverage.push(`分镜从 ${formatTimecode(firstStart)} 才开始，开头的画面没有覆盖`)
    if (lastEnd < duration - STORYBOARD_TAIL_TOLERANCE_SECONDS) {
      coverage.push(`分镜只写到 ${formatTimecode(lastEnd)}，视频总长 ${formatTimecode(duration)}`)
    } else if (lastEnd > duration + 1) {
      coverage.push(`分镜时间码超出视频总长（${formatTimecode(lastEnd)} / ${formatTimecode(duration)}）`)
    }
  }

  const perShot: string[] = []
  let previous: StoryboardShot | null = null
  for (const shot of shots) {
    const label = shotLabel(shot)
    const length = shot.end - shot.start
    if (!(length > 0)) perShot.push(`${label} 的结束时间不晚于开始时间`)
    else if (length > LONG_SHOT_SECONDS) perShot.push(`${label} 长达 ${length.toFixed(1)} 秒，可能把多个镜头合并成了一镜`)
    if (previous) {
      const gap = shot.start - previous.end
      if (gap > GAP_WARNING_SECONDS) {
        perShot.push(`${label} 与上一镜之间有 ${gap.toFixed(1)} 秒空档（${formatTimecode(previous.end)}–${formatTimecode(shot.start)}）`)
      } else if (-gap > OVERLAP_WARNING_SECONDS) {
        perShot.push(`${label} 与上一镜重叠 ${(-gap).toFixed(1)} 秒`)
      }
    }
    const present = presentFields(shot)
    const missing = STORYBOARD_REQUIRED_FIELDS.filter((field) => !present.has(field))
    if (missing.length) perShot.push(`${label} 缺少「${missing.join('」「')}」`)
    previous = shot
  }
  return { valid: true, errors: [], warnings: capMessages([...coverage, ...perShot]) }
}

/** What the next round needs to carry on in the same voice: where to start, who is in the scene, and the last two shots. */
export function describeContinuation(text: string): StoryboardContinuation {
  const document = parseStoryboard(text)
  const shots = flatShots(document)
  const lastScene = [...document.scenes].reverse().find((scene) => scene.shots.length > 0) ?? null
  const tail = shots
    .slice(-2)
    .map((shot) => [`### ${shotLabel(shot)} [${formatTimecode(shot.start)}-${formatTimecode(shot.end)}]`, ...shot.lines].join('\n'))
    .join('\n\n')
  return {
    shotCount: shots.length,
    resumeAt: shots.length ? shots[shots.length - 1].end : 0,
    lastScene: lastScene
      ? { number: lastScene.number, title: lastScene.title, roles: lastScene.roles, lines: lastScene.lines }
      : null,
    roles: collectRoles(document),
    tail,
  }
}
