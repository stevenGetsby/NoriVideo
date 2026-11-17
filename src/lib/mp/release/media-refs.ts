import type { StoryProgram } from '@/lib/interactive/types'
import { extractStorageKey } from '@/lib/storage'

export interface MediaRef { pointer: string; key: string; raw: string }

export function isMediaField(fieldName: string): boolean {
  return fieldName === 'url' || fieldName.endsWith('Url') || fieldName === 'icon'
}

function isEmojiIcon(fieldName: string, value: string): boolean {
  return fieldName === 'icon' && !/[/.:]/.test(value)
}

/** 画布实际存的三种相对地址：签名代理、本地文件代理、媒体短链；provider 的 extractStorageKey 不认相对路径。 */
function classifyAppUrl(value: string): { key: string } | null {
  if (!value.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(value, 'http://nori.local')
  } catch {
    return null
  }
  if (url.pathname === '/api/storage/sign') {
    const key = url.searchParams.get('key')
    return key ? { key } : null
  }
  if (url.pathname.startsWith('/api/files/')) {
    const key = decodeURIComponent(url.pathname.slice('/api/files/'.length))
    return key ? { key } : null
  }
  // /m/<publicId> 的 key 要查媒体表，留给 build 的 downloadSource 解析。
  if (/^\/m\/[\w-]+$/.test(url.pathname)) return { key: '' }
  return null
}

/** null = not a media reference; otherwise the storage key ('' for absolute URLs the build must download). */
function classifyMedia(fieldName: string, value: string): { key: string } | null {
  if (!value) return null
  if (isEmojiIcon(fieldName, value)) return null
  if (/^https?:\/\//.test(value)) return { key: '' }
  const appUrl = classifyAppUrl(value)
  if (appUrl) return appUrl
  const key = extractStorageKey(value)
  if (key) return { key }
  return null
}

const escapeSegment = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1')

function walk(value: unknown, pointer: string, fieldName: string, visit: (pointer: string, fieldName: string, value: unknown) => void): void {
  visit(pointer, fieldName, value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${pointer}/${index}`, fieldName, visit))
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${pointer}/${escapeSegment(key)}`, key, visit)
    }
  }
}

export function collectMediaRefs(program: StoryProgram): MediaRef[] {
  const refs: MediaRef[] = []
  walk(program, '', '', (pointer, fieldName, value) => {
    if (typeof value !== 'string' || !isMediaField(fieldName)) return
    const media = classifyMedia(fieldName, value)
    if (media) refs.push({ pointer, key: media.key, raw: value })
  })
  return refs
}

export function rewriteMediaRefs(program: StoryProgram, idByRaw: Map<string, string>): StoryProgram {
  const clone = JSON.parse(JSON.stringify(program)) as StoryProgram
  const rewriteAt = (pointer: string, fieldName: string, value: unknown) => {
    if (typeof value !== 'string' || !isMediaField(fieldName)) return
    if (!classifyMedia(fieldName, value)) return
    const id = idByRaw.get(value)
    if (!id) return
    const segments = pointer.split('/').slice(1).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    let parent: Record<string, unknown> = clone as unknown as Record<string, unknown>
    for (const segment of segments.slice(0, -1)) {
      parent = parent[segment] as Record<string, unknown>
    }
    parent[segments[segments.length - 1]] = `mp:${id}`
  }
  walk(clone, '', '', rewriteAt)
  return clone
}

const MP_VALUE = /^mp:[0-9a-f]{16}$/

/** Pointers whose media field still holds something the player cannot resolve; empty = pass. */
export function assertNoRawMedia(program: StoryProgram): string[] {
  const violations: string[] = []
  walk(program, '', '', (pointer, fieldName, value) => {
    if (!isMediaField(fieldName)) return
    if (value === null || value === '') return
    if (typeof value === 'string' && (MP_VALUE.test(value) || isEmojiIcon(fieldName, value))) return
    violations.push(pointer)
  })
  return violations
}

function resolvePointer(program: StoryProgram, pointer: string): unknown {
  let current: unknown = program
  for (const segment of pointer.split('/').slice(1)) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return current
}

/** Human-readable location for creators and reviewers, e.g. 「第 2 章「雨夜」·「巷口」」. */
export function describePointer(program: StoryProgram, pointer: string): string {
  const segments = pointer.split('/').slice(1).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (segments[0] === 'chapters') {
    const chapterIndex = Number(segments[1])
    const chapter = program.chapters[chapterIndex]
    if (!chapter) return pointer
    let label = `第 ${chapterIndex + 1} 章「${chapter.title}」`
    if (segments[2] === 'nodes') {
      const node = chapter.nodes[Number(segments[3])]
      if (node) label += `·「${node.title}」`
    }
    return label
  }
  const target = resolvePointer(program, pointer)
  if (segments[0] === 'shop' && segments[1] === 'items') {
    const item = program.shop?.items[Number(segments[2])]
    return item ? `商店「${item.name}」` : pointer
  }
  if (segments[0] === 'achievements') {
    const achievement = program.achievements?.[Number(segments[1])]
    return achievement ? `成就「${achievement.name}」` : pointer
  }
  if (segments[0] === 'personality' && segments[1] === 'results') {
    const result = program.personality?.results[segments[2]]
    return result ? `性格结果「${result.name}」` : pointer
  }
  if (segments[0] === 'variables') {
    const variable = program.variables[Number(segments[1])]
    return variable ? `变量「${variable.name}」` : pointer
  }
  if (target && typeof target === 'object' && 'title' in target && typeof (target as { title: unknown }).title === 'string') {
    return (target as { title: string }).title
  }
  return pointer
}
