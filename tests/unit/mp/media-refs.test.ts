import { createHash } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import type { StoryProgram } from '@/lib/interactive/types'

vi.mock('@/lib/storage', () => ({
  extractStorageKey: (input: string | null | undefined) => {
    if (!input) return null
    if (input.startsWith('/api/files/')) return decodeURIComponent(input.slice('/api/files/'.length))
    if (!input.startsWith('http') && !input.startsWith('/')) return input
    try {
      return new URL(input).pathname.replace(/^\/+/, '') || null
    } catch {
      return null
    }
  },
}))

import {
  assertNoRawMedia,
  collectMediaRefs,
  describePointer,
  isMediaField,
  rewriteMediaRefs,
} from '@/lib/mp/release/media-refs'

const sha1Id = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16)

function fixtureProgram(): StoryProgram {
  return {
    variables: [{ id: 'hp', name: '体力', type: 'number', initial: 3, icon: 'images/var-icon.png' }],
    chapters: [{
      projectId: 'p1',
      title: '雨夜',
      nodes: [
        { id: 'e1', kind: 'entry', title: '入口' },
        {
          id: 's1', kind: 'scene', title: '巷口', lines: '雨夜。', effects: [],
          media: { kind: 'video', url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg', durationSec: 10 },
          beats: [{
            id: 'b1', kind: 'interaction', title: '拍门', hint: '快点', durationSec: 3, during: 'play',
            mountedOn: 's1', startSec: 1, results: {},
            spec: { type: 'tap', count: 3, buttonText: '拍门', buttonImageUrl: 'images/tap-btn.png' },
          }],
          savePoint: { name: '巷口存档', coverUrl: 'images/save-cover.jpg' },
        },
        {
          id: 'c1', kind: 'choice', title: '抉择', prompt: '走哪边？', timeoutSec: null, defaultOptionId: null,
          panelStyle: 'image', layout: 'auto', timeoutMode: 'default',
          backdrop: { kind: 'image', url: 'images/backdrop.jpg', posterUrl: null },
          options: [
            { id: 'o1', label: '左', effects: [], imageUrl: 'images/opt-left.jpg', when: 'now', retry: false },
            { id: 'o2', label: '右', effects: [], imageUrl: 'images/opt-right.jpg', when: 'now', retry: false },
          ],
        },
        {
          id: 'i1', kind: 'interaction', title: '时机', hint: '按下', durationSec: 5, during: 'play',
          mountedOn: null, startSec: 0, results: {},
          picture: { kind: 'image', url: 'images/interaction-pic.jpg', posterUrl: null },
          spec: { type: 'timing', propImageUrl: 'images/prop.png', speed: 1, perfectWidth: 0.2, normalWidth: 0.4 },
        },
        { id: 'end1', kind: 'ending', title: '结局', endingType: 'good', description: '雨停了。' },
      ],
      flows: [
        { id: 'f1', from: 'e1', handle: 'next', to: 's1' },
        { id: 'f2', from: 's1', handle: 'next', to: 'c1' },
        { id: 'f3', from: 'c1', handle: 'o1', to: 'i1' },
        { id: 'f4', from: 'c1', handle: 'o2', to: 'end1' },
        { id: 'f5', from: 'i1', handle: 'perfect', to: 'end1' },
      ],
    }],
    links: [],
    start: { projectId: 'p1', entryNodeId: 'e1' },
    shop: {
      enabled: true, currencyVariableId: 'hp',
      items: [
        { id: 'shop1', name: '雨伞', icon: '☂️', description: '挡雨', price: 1, limit: 0, effects: [], reward: { title: '雨中人', frameUrl: 'images/reward-frame.png' } },
        { id: 'shop2', name: '灯笼', icon: 'images/shop-icon.png', description: '照明', price: 2, limit: 0, effects: [] },
      ],
    },
    achievements: [
      { id: 'ach1', name: '初来乍到', description: '到达结局', icon: '🏆', condition: { type: 'ending', projectId: 'p1', nodeId: 'end1' }, reward: { title: '旅人', frameUrl: 'images/ach-frame.png' } },
      { id: 'ach2', name: '收藏家', description: '买齐道具', icon: 'images/ach-icon.png', condition: { type: 'all_endings' }, reward: { title: '', frameUrl: null } },
    ],
    personality: {
      enabled: true,
      results: { ISTJ: { name: '检查者', description: '严谨', imageUrl: 'images/personality.jpg' } },
    },
  }
}

const idMapOf = (program: StoryProgram) => {
  const map = new Map<string, string>()
  for (const ref of collectMediaRefs(program)) {
    if (!map.has(ref.raw)) map.set(ref.raw, sha1Id(ref.key || ref.raw))
  }
  return map
}

describe('media-refs', () => {
  it('isMediaField matches url, *Url and icon only', () => {
    expect(isMediaField('url')).toBe(true)
    expect(isMediaField('posterUrl')).toBe(true)
    expect(isMediaField('buttonImageUrl')).toBe(true)
    expect(isMediaField('coverUrl')).toBe(true)
    expect(isMediaField('frameUrl')).toBe(true)
    expect(isMediaField('icon')).toBe(true)
    expect(isMediaField('lines')).toBe(false)
    expect(isMediaField('title')).toBe(false)
    expect(isMediaField('media')).toBe(false)
  })

  it('collects every media field listed in types.ts', () => {
    const program = fixtureProgram()
    const refs = collectMediaRefs(program)
    const raws = refs.map((ref) => ref.raw)
    expect(raws).toEqual(expect.arrayContaining([
      'videos/a.mp4',
      'images/a-poster.jpg',
      'images/tap-btn.png',
      'images/save-cover.jpg',
      'images/backdrop.jpg',
      'images/opt-left.jpg',
      'images/opt-right.jpg',
      'images/interaction-pic.jpg',
      'images/prop.png',
      'images/var-icon.png',
      'images/reward-frame.png',
      'images/shop-icon.png',
      'images/ach-frame.png',
      'images/ach-icon.png',
      'images/personality.jpg',
    ]))
    expect(refs.find((ref) => ref.raw === 'videos/a.mp4')).toMatchObject({ key: 'videos/a.mp4', pointer: '/chapters/0/nodes/1/media/url' })
    expect(refs.find((ref) => ref.raw === 'images/a-poster.jpg')?.pointer).toBe('/chapters/0/nodes/1/media/posterUrl')
    expect(refs.find((ref) => ref.raw === 'images/opt-left.jpg')?.pointer).toBe('/chapters/0/nodes/2/options/0/imageUrl')
    expect(refs.find((ref) => ref.raw === 'images/prop.png')?.pointer).toBe('/chapters/0/nodes/3/spec/propImageUrl')
    expect(refs.find((ref) => ref.raw === 'images/personality.jpg')?.pointer).toBe('/personality/results/ISTJ/imageUrl')
  })

  it('treats emoji icons as non-media but collects URL icons', () => {
    const refs = collectMediaRefs(fixtureProgram())
    expect(refs.map((ref) => ref.raw)).not.toContain('☂️')
    expect(refs.map((ref) => ref.raw)).not.toContain('🏆')
    expect(refs.map((ref) => ref.raw)).toContain('images/shop-icon.png')
    expect(refs.map((ref) => ref.raw)).toContain('images/ach-icon.png')
  })

  it('leaves the key empty for absolute URLs', () => {
    const program = fixtureProgram()
    program.chapters[0].nodes[1] = {
      ...(program.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>),
      media: { kind: 'video', url: 'https://cdn.example.com/videos/remote.mp4', posterUrl: null },
    }
    const ref = collectMediaRefs(program).find((item) => item.raw === 'https://cdn.example.com/videos/remote.mp4')
    expect(ref).toMatchObject({ key: '', raw: 'https://cdn.example.com/videos/remote.mp4' })
  })

  it('rewrites every media string to mp:<16hex> and keeps emoji icons', () => {
    const program = fixtureProgram()
    const rewritten = rewriteMediaRefs(program, idMapOf(program))
    expect(assertNoRawMedia(rewritten)).toEqual([])
    const scene = rewritten.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    expect(scene.media?.url).toMatch(/^mp:[0-9a-f]{16}$/)
    expect(scene.media?.posterUrl).toMatch(/^mp:[0-9a-f]{16}$/)
    expect(scene.savePoint?.coverUrl).toMatch(/^mp:[0-9a-f]{16}$/)
    expect(rewritten.shop?.items[0].icon).toBe('☂️')
    expect(rewritten.achievements?.[0].icon).toBe('🏆')
    expect(rewritten.achievements?.[0].reward.frameUrl).toMatch(/^mp:[0-9a-f]{16}$/)
    expect(rewritten.personality?.results.ISTJ.imageUrl).toMatch(/^mp:[0-9a-f]{16}$/)
  })

  it('returns a deep copy without touching the original program', () => {
    const program = fixtureProgram()
    const rewritten = rewriteMediaRefs(program, idMapOf(program))
    expect(rewritten).not.toBe(program)
    const scene = program.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    expect(scene.media?.url).toBe('videos/a.mp4')
  })

  it('gives the same key the same mp id across pointers', () => {
    const program = fixtureProgram()
    const scene2 = JSON.parse(JSON.stringify(program.chapters[0].nodes[1]))
    program.chapters[0].nodes.push(scene2)
    const idByRaw = idMapOf(program)
    expect(idByRaw.get('videos/a.mp4')).toBe(sha1Id('videos/a.mp4'))
    const rewritten = rewriteMediaRefs(program, idByRaw)
    const urls = rewritten.chapters[0].nodes
      .filter((node): node is Extract<typeof node, { kind: 'scene' }> => node.kind === 'scene')
      .map((node) => node.media?.url)
    expect(urls[0]).toBe(urls[1])
    expect(new Set(collectMediaRefs(program).map((ref) => ref.raw)).size).toBeLessThan(collectMediaRefs(program).length)
  })

  it('safety net flags unrewritten keys and unknown proxy paths', () => {
    const program = fixtureProgram()
    expect(assertNoRawMedia(program).length).toBeGreaterThan(0)
    expect(assertNoRawMedia(program)).toContain('/chapters/0/nodes/1/media/url')

    const garbage = fixtureProgram()
    const scene = garbage.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    scene.media = { kind: 'video', url: '/unknown/proxy?id=1', posterUrl: null }
    const rewritten = rewriteMediaRefs(garbage, idMapOf(garbage))
    expect(assertNoRawMedia(rewritten)).toContain('/chapters/0/nodes/1/media/url')
  })

  it('resolves sign and local-file proxy URLs to their storage keys', () => {
    const program = fixtureProgram()
    const scene = program.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    scene.media = { kind: 'video', url: '/api/storage/sign?key=videos%2Fa.mp4&expires=3600', posterUrl: '/api/files/images%2Fa-poster.jpg' }
    const refs = collectMediaRefs(program)
    expect(refs.find((ref) => ref.raw === '/api/storage/sign?key=videos%2Fa.mp4&expires=3600')).toMatchObject({ key: 'videos/a.mp4' })
    expect(refs.find((ref) => ref.raw === '/api/files/images%2Fa-poster.jpg')).toMatchObject({ key: 'images/a-poster.jpg' })
    const rewritten = rewriteMediaRefs(program, idMapOf(program))
    expect(assertNoRawMedia(rewritten)).toEqual([])
  })

  it('gives a sign URL and its raw key the same mp id', () => {
    const program = fixtureProgram()
    const scene2 = JSON.parse(JSON.stringify(program.chapters[0].nodes[1])) as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    scene2.id = 's2'
    scene2.media = { kind: 'video', url: '/api/storage/sign?key=videos%2Fa.mp4&expires=3600', posterUrl: null }
    program.chapters[0].nodes.push(scene2)
    expect(idMapOf(program).get('/api/storage/sign?key=videos%2Fa.mp4&expires=3600')).toBe(sha1Id('videos/a.mp4'))
  })

  it('collects /m/ short links with an empty key for build-time resolution', () => {
    const program = fixtureProgram()
    const scene = program.chapters[0].nodes[1] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'scene' }>
    scene.media = { kind: 'video', url: '/m/m_cd498fd2551623e8', posterUrl: null }
    const ref = collectMediaRefs(program).find((item) => item.raw === '/m/m_cd498fd2551623e8')
    expect(ref).toMatchObject({ key: '' })
    const rewritten = rewriteMediaRefs(program, idMapOf(program))
    expect(assertNoRawMedia(rewritten)).toEqual([])
  })

  it('safety net accepts null, empty string, mp ids and emoji icons', () => {
    const program = fixtureProgram()
    const rewritten = rewriteMediaRefs(program, idMapOf(program))
    const choice = rewritten.chapters[0].nodes[2] as Extract<StoryProgram['chapters'][0]['nodes'][0], { kind: 'choice' }>
    choice.backdrop = null
    choice.options[0].imageUrl = ''
    expect(assertNoRawMedia(rewritten)).toEqual([])
  })

  it('describePointer names the chapter and node', () => {
    const program = fixtureProgram()
    expect(describePointer(program, '/chapters/0/nodes/1/media/url')).toBe('第 1 章「雨夜」·「巷口」')
    expect(describePointer(program, '/chapters/0')).toBe('第 1 章「雨夜」')
    expect(describePointer(program, '/shop/items/0/icon')).toBe('商店「雨伞」')
    expect(describePointer(program, '/achievements/1/icon')).toBe('成就「收藏家」')
  })
})
