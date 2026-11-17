import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const wxStub = vi.hoisted(() => {
  const request = vi.fn()
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request,
  }
  ;(globalThis as Record<string, unknown>).wx = wx
  return { request }
})

import {
  endingShareTitle, generateShareId, registerShare, timelineQuery,
  topicSharePath, topicShareTitle, workSharePath, workShareTitle,
} from '../../../miniprogram/miniprogram/lib/share'

describe('share templates', () => {
  it('generates 10-char base62 ids', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateShareId()).toMatch(/^[0-9A-Za-z]{10}$/)
    }
  })

  it('builds work and topic paths with the share id', () => {
    expect(workSharePath('abcd1234', 'Xy12345678')).toBe('/pages/work/index?w=abcd1234&s=Xy12345678')
    expect(topicSharePath('tp000001', 'Xy12345678')).toBe('/pages/topic/index?t=tp000001&s=Xy12345678')
    expect(timelineQuery('abcd1234', 'Xy12345678')).toBe('w=abcd1234&s=Xy12345678')
  })

  it('builds titles per the doc templates', () => {
    expect(workShareTitle('夜航', '一句话简介')).toBe('《夜航》一句话简介')
    expect(workShareTitle('夜航', '')).toBe('《夜航》')
    expect(endingShareTitle('夜航', '黎明')).toBe('我在《夜航》达成了「黎明」，你能找到几个结局？')
    expect(topicShareTitle('悬疑专题', '蓝喵剧场')).toBe('悬疑专题｜蓝喵剧场')
  })

  it('registers shares fire-and-forget with the doc body', () => {
    registerShare('Xy12345678', 'abcd1234', 'ending', 'n1')
    const option = wxStub.request.mock.calls.at(-1)?.[0] as { url: string; method: string; data: Record<string, unknown> }
    expect(option.url.endsWith('/api/mp/shares')).toBe(true)
    expect(option.method).toBe('POST')
    expect(option.data).toEqual({ id: 'Xy12345678', slug: 'abcd1234', kind: 'ending', endingNodeId: 'n1' })

    registerShare('Xy12345678', 'abcd1234')
    const last = wxStub.request.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }
    expect(last.data).toEqual({ id: 'Xy12345678', slug: 'abcd1234', kind: 'work' })
  })
})

describe('induced-share guard (R6)', () => {
  function walk(dir: string, exts: string[], out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name.includes(' 2.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, exts, out)
      else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full)
    }
    return out
  }

  it('has no induce-to-share copy on share-related lines', () => {
    const root = process.cwd()
    const files = [
      ...walk(path.join(root, 'miniprogram/miniprogram'), ['.ts', '.wxml', '.json']),
      ...walk(path.join(root, 'src/lib/mp'), ['.ts']),
    ]
    const violations: string[] = []
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/share|分享/i.test(line)) return
        if (/分享后|邀请好友|助力|解锁/.test(line)) violations.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })
})
