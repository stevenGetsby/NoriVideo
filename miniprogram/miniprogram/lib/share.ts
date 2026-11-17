import { request } from './api'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function generateShareId(): string {
  let out = ''
  for (let i = 0; i < 10; i += 1) out += BASE62[Math.floor(Math.random() * BASE62.length)]
  return out
}

export function workSharePath(slug: string, shareId: string): string {
  return `/pages/work/index?w=${encodeURIComponent(slug)}&s=${shareId}`
}

export function topicSharePath(slug: string, shareId: string): string {
  return `/pages/topic/index?t=${encodeURIComponent(slug)}&s=${shareId}`
}

export function timelineQuery(slug: string, shareId: string): string {
  return `w=${encodeURIComponent(slug)}&s=${shareId}`
}

export function workShareTitle(title: string, tagline: string): string {
  return tagline ? `《${title}》${tagline}` : `《${title}》`
}

export function endingShareTitle(title: string, endingTitle: string): string {
  return `我在《${title}》达成了「${endingTitle}」，你能找到几个结局？`
}

export function topicShareTitle(topicTitle: string, brand: string): string {
  return `${topicTitle}｜${brand}`
}

export type ShareKind = 'work' | 'ending' | 'timeline' | 'poster'

// 分享路径同步返回，登记 fire-and-forget，失败不影响分享。
export function registerShare(id: string, slug: string, kind: ShareKind = 'work', endingNodeId?: string): void {
  request('POST', '/api/mp/shares', { id, slug, kind, ...(endingNodeId ? { endingNodeId } : {}) }, { auth: 'required' }).catch(() => {})
}
