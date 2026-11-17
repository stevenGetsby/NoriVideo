import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endingKeys, reachKey } from '@/lib/interactive/achievements'
import type { CanvasEdgeLike, CanvasNodeLike } from '@/lib/interactive/compile'
import { snapshotRun } from '@/lib/interactive/saves'
import type { StoryMedia, StoryPlaybackSpeed, StoryProgram } from '@/lib/interactive/types'
import { readPermanentValues } from '@/features/interactive/player/permanent-store'
import { readStoredProfile, writeStoredSaves } from '@/features/interactive/player/viewer-store'
import { PausableClock } from '../../../miniprogram/miniprogram/pkg-play/lib/clock'
import { toWxRate } from '../../../miniprogram/miniprogram/pkg-play/lib/rates'
import {
  PlayerController,
  type PlayerDeps,
  type PlayerViewPort,
  type VideoPort,
} from '../../../miniprogram/miniprogram/pkg-play/lib/player-controller'
import { buildProgram } from '../interactive/fixture'
import { beat, ending, entry, flow, mount, programOf, scene, shop, vaultStory } from '../interactive/economy-fixture'
import { achievements, coin, storyProgram } from '../interactive/p3-fixture'

if (!existsSync(path.resolve(process.cwd(), 'miniprogram/miniprogram/runtime/story-runtime.js'))) {
  throw new Error('先运行 npm --prefix miniprogram run build:runtime')
}

function makeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

/** CDN-shaped media keyed by the program's raw refs (fixtures use '/x.mp4', released programs use 'mp:<id>'). */
function mediaFor(program: StoryProgram): PlayerDeps['media'] {
  const media: PlayerDeps['media'] = {}
  const add = (ref: StoryMedia | null | undefined) => {
    if (!ref) return
    if (ref.kind === 'video') {
      media[ref.url] = {
        kind: 'video', w: 1280, h: 720, dur: ref.durationSec ?? 10,
        v720: `https://cdn.test/v720${ref.url}`, v480: `https://cdn.test/v480${ref.url}`,
        poster: ref.posterUrl ?? undefined, last: `https://cdn.test/last${ref.url}`,
      }
    } else {
      media[ref.url] = { kind: 'image', w: 1280, h: 720, img: ref.url }
    }
  }
  for (const chapter of program.chapters) {
    for (const node of chapter.nodes) {
      if (node.kind === 'scene') {
        add(node.media)
        for (const b of node.beats) {
          add(b.picture)
          if (b.spec.type === 'hotspot' && b.spec.frameImageUrl) add({ kind: 'image', url: b.spec.frameImageUrl, posterUrl: null })
        }
      } else if (node.kind === 'choice') {
        add(node.backdrop)
      } else if (node.kind === 'interaction') {
        add(node.picture)
        if (node.spec.type === 'hotspot' && node.spec.frameImageUrl) add({ kind: 'image', url: node.spec.frameImageUrl, posterUrl: null })
      }
    }
  }
  return media
}

function harness(program: StoryProgram, over: Partial<PlayerDeps> = {}) {
  const storage = makeStorage()
  const load = vi.fn(), play = vi.fn(), pause = vi.fn(), seek = vi.fn(), setRate = vi.fn(), show = vi.fn(), setLastFrame = vi.fn()
  const video: VideoPort = { load, play, pause, seek, setRate, show, setLastFrame }
  const set = vi.fn()
  const view: PlayerViewPort = { set }
  const track = vi.fn(), haptic = vi.fn(), sync = vi.fn()
  const clock = new PausableClock(() => Date.now())
  const deps: PlayerDeps = {
    program, media: mediaFor(program), slug: 'test', releaseId: 'rel1',
    storage, permanent: storage, video, view, clock,
    now: () => Date.now(), quality: () => '720', track, haptic, branchStats: () => null, sync,
    ...over,
  }
  const controller = new PlayerController(deps)
  return { controller, video: { load, play, pause, seek, setRate, show, setLastFrame }, set, track, haptic, sync, storage, clock, deps }
}

/** Drive scene/choice stops to an ending using the controller's own public API. */
function playToEnd(program: StoryProgram, choices: Record<string, string>, setup?: (c: PlayerController) => void) {
  const h = harness(program)
  const c = h.controller
  setup?.(c)
  let guard = 0
  while (c.run.stop.kind !== 'ending' && c.run.stop.kind !== 'halt' && guard++ < 200) {
    const stop = c.run.stop
    if (stop.kind === 'scene') c.skipSegment()
    else if (stop.kind === 'choice') c.choose(choices[stop.node.id] ?? stop.node.options[0].id)
    else if (stop.kind === 'interaction') c.choose(choices[stop.node.id] ?? 'success')
    else break
  }
  return { c, h }
}

function endingKeyOf(c: PlayerController): string {
  const stop = c.run.stop
  if (stop.kind !== 'ending') throw new Error(`expected an ending, got ${stop.kind}`)
  return reachKey(stop.projectId, stop.node.id)
}

/** A scene with one mounted interaction at second 0; each result port cuts to its own ending. */
function beatProgram(beatData: Record<string, unknown>, routing: Record<string, string>, endingTypes: Record<string, string> = {}): StoryProgram {
  const endingIds = [...new Set(Object.values(routing))]
  const nodes: CanvasNodeLike[] = [
    entry,
    scene('s', { videoDurationSec: 60 }),
    beat('b', beatData),
    ...endingIds.map((id) => ending(id, endingTypes[id] ?? 'good')),
  ]
  const edges: CanvasEdgeLike[] = [
    flow('f1', 'in', 's'),
    mount('m1', 's', 'b'),
    flow('f2', 's', endingIds[0]),
    ...Object.entries(routing).map(([handle, to], index) => flow(`r${index}`, 'b', to, handle)),
  ]
  return programOf(nodes, edges, { shop: undefined })
}

/** Start the scene's video and let the 50ms tick mount the beat at second 0. */
function activateBeat(program: StoryProgram) {
  const h = harness(program)
  const c = h.controller
  expect(c.run.stop.kind).toBe('scene')
  c.onPlaying(c.spareSlot)
  c.onTimeUpdate(c.activeSlot, 0, 60)
  vi.advanceTimersByTime(50)
  expect(c.active?.mounted).toBe(true)
  return h
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('scripted replay to every ending (J.4)', () => {
  it('reaches both endings of the two-chapter fixture', () => {
    const program = buildProgram()
    const fight = playToEnd(program, { a_c: 'o_fight' })
    const run = playToEnd(program, { a_c: 'o_run' })
    expect(endingKeyOf(fight.c)).toBe('p2:b_good')
    expect(endingKeyOf(run.c)).toBe('p2:b_bad')
    const reached = [endingKeyOf(fight.c), endingKeyOf(run.c)].sort()
    expect(reached).toEqual([...endingKeys(program)].sort())
  })

  it('reaches every ending of the vault story, unlocking through the shop', () => {
    const program = vaultStory()
    const bad = playToEnd(program, { door: 'o_push' })
    const peeked = playToEnd(program, { door: 'o_peek' }, (c) => { c.buy('tonic'); c.buy('tonic'); c.buy('tonic') })
    const cheap = { ...shop, items: shop.items.map((item) => (item.id === 'key_item' ? { ...item, price: 1 } : item)) }
    const secret = playToEnd(vaultStory({ shop: cheap }), { door: 'o_open' }, (c) => { c.buy('key_item') })
    expect(endingKeyOf(bad.c)).toBe('p:bad')
    expect(endingKeyOf(peeked.c)).toBe('p:peeked')
    expect(endingKeyOf(secret.c)).toBe('p:secret')
    const reached = [endingKeyOf(bad.c), endingKeyOf(peeked.c), endingKeyOf(secret.c)].sort()
    expect(reached).toEqual([...endingKeys(program)].sort())
  })

  it('reaches every ending of the personality story', () => {
    const program = storyProgram({ achievements, personality: { enabled: true, results: {} } })
    const good = playToEnd(program, { pick: 'a' })
    const bad = playToEnd(program, { pick: 'c' })
    expect(endingKeyOf(good.c)).toBe('p:goodend')
    expect(endingKeyOf(bad.c)).toBe('p:badend')
    expect([endingKeyOf(good.c), endingKeyOf(bad.c)].sort()).toEqual([...endingKeys(program)].sort())
  })
})

describe('six interaction kinds: success and failure (J.4)', () => {
  it('tap: enough taps succeed, running out of time fails', () => {
    const data = { interaction: 'tap', startSec: 0, durationSec: 3, count: 3, results: { success: { when: 'now' }, fail: { when: 'now' } } }
    const ok = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    ok.controller.pointerDown(0, 0)
    ok.controller.pointerDown(0, 0)
    ok.controller.pointerDown(0, 0)
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')
    expect(ok.haptic).toHaveBeenCalledTimes(3)

    const fail = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    vi.advanceTimersByTime(3100)
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })

  it('swipe: the right direction succeeds, the wrong one fails', () => {
    const data = { interaction: 'swipe', startSec: 0, durationSec: 3, direction: 'left', results: { success: { when: 'now' }, fail: { when: 'now' } } }
    const ok = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    ok.controller.pointerDown(200, 200)
    ok.controller.pointerMove(140, 200)
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')

    const fail = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    fail.controller.pointerDown(200, 200)
    fail.controller.pointerMove(260, 200)
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })

  it('timing: a centred tap is perfect, an early tap misses', () => {
    const data = { interaction: 'timing', startSec: 0, durationSec: 5, speed: 1, perfectWidth: 10, normalWidth: 30, results: { perfect: { when: 'now' }, normal: { when: 'now' }, miss: { when: 'now' } } }
    const routing = { perfect: 'good', normal: 'good', miss: 'bad' }
    const ok = activateBeat(beatProgram(data, routing, { bad: 'bad' }))
    vi.advanceTimersByTime(500) // pointer at 0.5
    ok.controller.pointerDown(0, 0)
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')

    const fail = activateBeat(beatProgram(data, routing, { bad: 'bad' }))
    fail.controller.pointerDown(0, 0) // pointer at 0
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })

  it('hold: releasing in the band succeeds, an empty release fails', () => {
    const data = { interaction: 'hold', startSec: 0, durationSec: 5, fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false, results: { success: { when: 'now' }, fail: { when: 'now' } } }
    const ok = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    ok.controller.pointerDown(0, 0)
    vi.advanceTimersByTime(1800) // 90%
    ok.controller.pointerUp(0, 0)
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')

    const fail = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    fail.controller.pointerDown(0, 0)
    fail.controller.pointerUp(0, 0)
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })

  it('hold: overcharging fails on its own when overchargeFails is set', () => {
    const data = { interaction: 'hold', startSec: 0, durationSec: 5, fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: true, results: { success: { when: 'now' }, fail: { when: 'now' } } }
    const h = activateBeat(beatProgram(data, { success: 'good', fail: 'bad' }, { bad: 'bad' }))
    h.controller.pointerDown(0, 0)
    vi.advanceTimersByTime(2500)
    expect(h.controller.run.stop.kind === 'ending' && h.controller.run.stop.node.id).toBe('bad')
  })

  it('hotspot: tapping a zone wins, running out of time times out', () => {
    const data = { interaction: 'hotspot', startSec: 0, durationSec: 5, zones: [{ id: 'win', label: '线索', x: 0, y: 0, w: 1, h: 1 }], results: { win: { when: 'now' }, timeout: { when: 'now' } } }
    const ok = activateBeat(beatProgram(data, { win: 'good', timeout: 'bad' }, { bad: 'bad' }))
    ok.controller.setStageRect(1280, 720)
    ok.controller.pointerDown(640, 360)
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')

    const fail = activateBeat(beatProgram(data, { win: 'good', timeout: 'bad' }, { bad: 'bad' }))
    fail.controller.setStageRect(1280, 720)
    vi.advanceTimersByTime(5100)
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })

  it('mounted choice: picking an option cuts, the exit timeout cuts to the death ending', () => {
    const data = { interaction: 'choice', startSec: 0, durationSec: 3, timeoutMode: 'exit', options: [{ id: 'fight', label: '开枪' }, { id: 'flee', label: '逃跑' }] }
    const routing = { fight: 'good', flee: 'normal', timeout: 'bad' }
    const ok = activateBeat(beatProgram(data, routing, { normal: 'normal', bad: 'bad' }))
    ok.controller.choose('fight')
    expect(ok.controller.run.stop.kind === 'ending' && ok.controller.run.stop.node.id).toBe('good')

    const flee = activateBeat(beatProgram(data, routing, { normal: 'normal', bad: 'bad' }))
    flee.controller.choose('flee')
    expect(flee.controller.run.stop.kind === 'ending' && flee.controller.run.stop.node.id).toBe('normal')

    const fail = activateBeat(beatProgram(data, routing, { normal: 'normal', bad: 'bad' }))
    vi.advanceTimersByTime(3100)
    expect(fail.controller.run.stop.kind === 'ending' && fail.controller.run.stop.node.id).toBe('bad')
  })
})

describe('shop purchase deducts game currency (J.4)', () => {
  it('pays the currency value, then refuses when the balance is too low', () => {
    const h = harness(vaultStory())
    const c = h.controller
    c.openSheet('shop')
    expect(c.sheet).toBe('shop')
    c.buy('tonic')
    expect(c.run.vars.coin).toBe(2)
    expect(c.run.vars.brave).toBe(1)
    expect(c.shopError).toBeNull()
    c.buy('tonic')
    c.buy('tonic')
    expect(c.run.vars.coin).toBe(0)
    c.buy('tonic')
    expect(c.shopError).toBe('余额不足，买不起这件商品')
  })

  it('marks a limited item sold out and rejects unknown items', () => {
    const cheap = { ...shop, items: shop.items.map((item) => (item.id === 'key_item' ? { ...item, price: 1 } : item)) }
    const h = harness(vaultStory({ shop: cheap }))
    const c = h.controller
    c.openSheet('shop')
    c.buy('key_item')
    expect(c.run.vars.key).toBe(1)
    expect(c.run.vars.coin).toBe(2)
    c.buy('key_item')
    expect(c.shopError).toBe('这件商品已经售罄')
    c.buy('ghost')
    expect(c.shopError).toBe('找不到这件商品')
  })

  it('a locked option opens the shop on its item', () => {
    const h = harness(vaultStory())
    const c = h.controller
    c.skipSegment() // hall → door
    expect(c.run.stop.kind).toBe('choice')
    c.choose('o_open')
    expect(c.sheet).toBe('shop')
  })

  it('reports no shop when the creator never enabled one', () => {
    const h = harness(storyProgram())
    h.controller.buy('anything')
    expect(h.controller.shopError).toBe('商城还没有开启')
  })
})

describe('saves, loads and checkpoint jumps (J.4)', () => {
  const program = () => storyProgram({ map: { enabled: true }, achievements })

  it('records checkpoints, saves and loads slots, jumps checkpoints and deletes', () => {
    const h = harness(program())
    const c = h.controller
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('s1')
    expect(c.saves.checkpoints['p:s1']).toBeTruthy()
    expect(c.saves.auto?.snapshot.nodeId).toBe('s1')

    c.saveSlot(0)
    expect(c.saves.slots[0]?.snapshot.nodeId).toBe('s1')
    expect(c.sheetNotice).toBe('已保存到存档位 1')

    c.skipSegment() // s1 → pick
    c.choose('a') // → s2
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('s2')
    expect(c.saves.checkpoints['p:s2']).toBeTruthy()
    c.saveSlot(1)
    expect(c.saves.slots[1]?.snapshot.nodeId).toBe('s2')

    c.loadSlot(0)
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('s1')
    c.jumpCheckpoint('p:s2')
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('s2')

    c.deleteSlot(0)
    expect(c.saves.slots[0]).toBeNull()
    expect(c.sheetNotice).toBe('已删除存档位 1')
  })

  it('refuses to save at an ending and flags a stale snapshot', () => {
    const { c } = playToEnd(program(), { pick: 'a' })
    c.saveSlot(0)
    expect(c.sheetNotice).toBe('现在还不能存档：先进入一个可继续的片段')
    c.saves.slots[2] = { savedAt: 0, snapshot: { v: 1, mode: 'story', projectId: 'p', nodeId: 'gone', vars: {}, trail: [] } }
    c.loadSlot(2)
    expect(c.sheetNotice).toBe('此存档来自旧版本，无法继续')
  })
})

describe('appHide pauses the timers (J.4)', () => {
  it('freezes the interaction clock and the watch timer, then resumes in place', () => {
    const h = harness(buildProgram())
    const c = h.controller
    c.onPlaying(c.spareSlot)
    c.onTimeUpdate(c.activeSlot, 0, 60)
    vi.advanceTimersByTime(100)
    const clockBefore = h.clock.now()
    const watchBefore = c.watchSec
    expect(watchBefore).toBeGreaterThan(0)

    c.appHide()
    expect(h.clock.isPaused()).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(h.clock.now()).toBe(clockBefore)
    expect(c.watchSec).toBe(watchBefore)
    expect(h.sync).toHaveBeenCalledWith('hide')

    c.appShow()
    expect(c.promptMode).toBe('shown')
    c.resume()
    expect(c.promptMode).toBe('none')
    expect(h.clock.isPaused()).toBe(false)
    vi.advanceTimersByTime(100)
    expect(h.clock.now()).toBeGreaterThan(clockBefore)
  })
})

describe('speed cycle matches toWxRate (J.4)', () => {
  it('cycles the offered speeds and sets the native rate each time', () => {
    const program = { ...buildProgram(), playback: { speeds: [1, 1.25, 1.5] as StoryPlaybackSpeed[] } }
    const h = harness(program)
    const c = h.controller
    expect(c.speed).toBe(1)
    c.cycleSpeed()
    expect(c.speed).toBe(1.25)
    expect(h.video.setRate.mock.calls.at(-1)?.[1]).toBe(toWxRate(1.25))
    c.cycleSpeed()
    expect(c.speed).toBe(1.5)
    expect(h.video.setRate.mock.calls.at(-1)?.[1]).toBe(toWxRate(1.5))
    c.cycleSpeed()
    expect(c.speed).toBe(1)
    expect(h.video.setRate.mock.calls.at(-1)?.[1]).toBe(toWxRate(1))
  })
})

describe('dispose clears every timer (J.4)', () => {
  it('leaves no pending timers after a plain play', () => {
    const h = harness(buildProgram())
    h.controller.dispose()
    expect(h.controller.disposed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(h.track.mock.calls.some((call) => call[0].name === 'play_exit')).toBe(true)
    expect(h.sync).toHaveBeenCalledWith('unload')
  })

  it('leaves no pending timers even with an achievement toast queued', () => {
    const { c } = playToEnd(storyProgram({ achievements }), { pick: 'a' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    c.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('continue prompt and resume', () => {
  it('offers to continue a valid auto save and resumes into it', () => {
    const program = storyProgram({ map: { enabled: true }, achievements })
    const first = harness(program)
    expect(first.controller.saves.auto?.snapshot.nodeId).toBe('s1')

    const second = harness(program, { storage: first.storage, permanent: first.storage })
    const c = second.controller
    expect(c.promptMode).toBe('shown')
    expect(c.prompt?.node).toBe('雨夜')
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('s1')
    c.resume()
    expect(c.promptMode).toBe('none')
    expect(c.run.stop.kind).toBe('scene')
    expect(second.track.mock.calls.some((call) => call[0].name === 'play_start' && call[0].f === true)).toBe(true)
  })

  it('falls back to a fresh start when the auto save is stale', () => {
    const program = storyProgram({ map: { enabled: true }, achievements })
    const storage = makeStorage()
    writeStoredSaves(storage, 'mp:test', {
      auto: { savedAt: 1, snapshot: { v: 1, mode: 'story', projectId: 'p', nodeId: 'gone', vars: {}, trail: [] } },
      slots: [null, null, null],
      checkpoints: {},
    })
    const h = harness(program, { storage, permanent: storage })
    expect(h.controller.continueNotice).toBe('上次的进度已失效，将从头开始')
    expect(h.controller.saves.auto?.snapshot.nodeId).toBe('s1')
    expect(h.controller.run.stop.kind === 'scene' && h.controller.run.stop.node.id).toBe('s1')
  })
})

describe('video events', () => {
  it('a natural end advances the segment', () => {
    const h = harness(buildProgram())
    const c = h.controller
    c.onPlaying(c.spareSlot)
    c.onTimeUpdate(c.activeSlot, 5, 10)
    c.onEnded(c.activeSlot)
    expect(c.run.stop.kind).toBe('choice')
  })

  it('retries once at 480 then surfaces the media error', () => {
    const h = harness(buildProgram())
    const c = h.controller
    c.onPlaying(c.spareSlot)
    c.onError(c.activeSlot)
    expect(c.mediaError).toBe(false)
    expect(h.video.load.mock.calls.at(-1)?.[1]).toContain('v480')
    c.onError(c.activeSlot)
    expect(c.mediaError).toBe(true)
  })

  it('warms the spare slot and swaps to it on a preload hit', () => {
    const nodes = [entry, scene('a', { videoDurationSec: 10 }), scene('b', { videoDurationSec: 10 }), ending('e')]
    const edges = [flow('f1', 'in', 'a'), flow('f2', 'a', 'b'), flow('f3', 'b', 'e')]
    const program = programOf(nodes, edges, { shop: undefined })
    const h = harness(program)
    const c = h.controller
    c.onPlaying(c.spareSlot) // active b, spare a
    c.onTimeUpdate(c.activeSlot, 8, 10)
    vi.advanceTimersByTime(50) // near the end → preload b into spare a
    c.onTimeUpdate(c.spareSlot, 0, 10) // warm-up frames pause and rewind the spare
    expect(h.video.pause).toHaveBeenCalledWith(c.spareSlot)
    expect(h.video.seek).toHaveBeenCalledWith(c.spareSlot, 0)
    const spareBefore = c.spareSlot
    c.skipSegment() // a → b, preload hit
    expect(c.run.stop.kind === 'scene' && c.run.stop.node.id).toBe('b')
    expect(c.activeSlot).toBe(spareBefore)
  })
})

describe('cloud sync triggers', () => {
  it('throttles manual syncs but forces hide and unload', () => {
    const h = harness(storyProgram({ map: { enabled: true }, achievements }))
    const c = h.controller
    vi.advanceTimersByTime(20000)
    c.saveSlot(0)
    c.saveSlot(1)
    expect(h.sync.mock.calls.filter((call) => call[0] === 'manual')).toHaveLength(1)
    c.appHide()
    expect(h.sync).toHaveBeenCalledWith('hide')
    c.dispose()
    expect(h.sync).toHaveBeenCalledWith('unload')
  })
})

describe('cloud merge adoption (F.7)', () => {
  it('adopts the server merge result without disturbing the run or regressing permanent values', () => {
    const program = storyProgram({ variables: [{ ...coin, scope: 'permanent' }], achievements })
    const h = harness(program)
    const c = h.controller
    c.start('new')
    c.skipSegment()
    c.choose('a')
    expect(c.savePayload().permanent.coin).toBe(1)
    const stopBefore = c.run.stop
    const snapshot = snapshotRun(c.run)
    expect(snapshot).not.toBeNull()
    c.adoptMerged({
      profile: {
        endings: [reachKey('p', 'badend')],
        segments: [reachKey('p', 's1'), reachKey('p', 's2')],
        achievements: ['a_seg'],
        bought: [],
        equipped: { title: null, frame: null },
      },
      saves: { auto: { snapshot: snapshot!, savedAt: 9000 }, slots: [null, null, null], checkpoints: {} },
      permanent: { coin: 5 },
    })
    expect(c.run.stop).toEqual(stopBefore)
    const payload = c.savePayload()
    expect(payload.profile.endings).toEqual([reachKey('p', 'badend')])
    expect(payload.profile.achievements).toEqual(['a_seg'])
    expect(payload.permanent.coin).toBe(5)
    expect(payload.saves.auto?.savedAt).toBe(9000)
    expect(readStoredProfile(h.storage, 'mp:test').endings).toEqual([reachKey('p', 'badend')])
    expect(readPermanentValues(h.storage, 'mp:test', program.variables).coin).toBe(5)
    c.dispose()
  })
})
