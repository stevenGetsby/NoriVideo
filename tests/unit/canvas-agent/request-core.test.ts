import { expect, it } from 'vitest'
import { buildCanvasGenerateRequest, buildQuoteParams, orderedReferenceSummaries, type CanvasGenerateRequest } from '@/features/canvas/generation/generate-request-core'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const request: CanvasGenerateRequest = {
  nodeId: 'fixture', prompt: '合成提示词', modelKey: 'fixture::model', modelLabel: '示例',
  type: 'image', referenceNodeIds: [], aspectRatio: '16:9', resolution: '2K', quality: 'high',
  duration: 5, generateAudio: true, inputMode: 'text', count: 1, storyboard: false,
  audioMode: 'tts', audioVoice: '', audioGenre: '', audioSfxKind: '',
}
const image = (id: string): CanvasFlowNode => ({ id, type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: '/fixture.png' } })

it.each([
  [{ type: 'text' }, { type: 'text', count: 1 }, {}],
  [{ type: 'image' }, { type: 'image', resolution: '2K' }, { type: 'image', count: '1', resolution: '2K', quality: 'high' }],
  [{ type: 'video', resolution: '720p' }, { type: 'video', duration: 5 }, { type: 'video', resolution: '720p', duration: '5', generationMode: 'normal' }],
  [{ type: 'video', inputMode: 'firstlastframe', resolution: '720p' }, { inputMode: 'firstlastframe' }, { generationMode: 'firstlastframe' }],
  [{ type: 'image', storyboard: true, count: 1 }, { storyboard: true, count: 4 }, { type: 'image', count: '4' }],
])('keeps request and quote fields aligned for %j', (overrides, submit, quote) => {
  const result = buildCanvasGenerateRequest({ ...request, ...overrides } as CanvasGenerateRequest)
  expect(result).toMatchObject(submit)
  const params = buildQuoteParams(result, [])
  expect(Object.fromEntries(params)).toMatchObject(quote)
  if (result.type === 'text') expect(params.size).toBe(0)
})

it('keeps frame order and omits TGG provider-default resolution in the quote', () => {
  expect(orderedReferenceSummaries(['end', 'start'], [image('start'), image('end')], true).map(({ id, role }) => [id, role]))
    .toEqual([['end', 'FIRST_FRAME'], ['start', 'LAST_FRAME']])
  expect(buildQuoteParams({ ...request, type: 'video', resolution: '' }, []).has('resolution')).toBe(false)
})
