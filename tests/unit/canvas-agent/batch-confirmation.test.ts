import { expect, it } from 'vitest'
import { createBatchConfirmations, type GenerationPreview } from '@/features/canvas/agent/batch-confirmation'

const a: GenerationPreview = { nodeId: 'a', fingerprint: 'first', title: '图一', model: '示例', count: 1, points: 6 }
const b: GenerationPreview = { nodeId: 'b', fingerprint: 'second', title: '图二', model: '示例', count: 1, points: 9 }

it('previews the consecutive priced calls in the completed response without replaying calls or crossing an edit', async () => {
  const batch = createBatchConfirmations()
  batch.enqueue(1, 'a-call', 'generate', { node: 'a' })
  batch.enqueue(1, 'b-call', 'generate', { node: 'b' })
  batch.enqueue(1, 'b-call', 'generate', { node: 'b' })
  batch.enqueue(1, 'edit', 'update_nodes', {})
  batch.enqueue(1, 'later', 'generate', { node: 'c' })
  batch.enqueue(2, 'next-round', 'generate', { node: 'd' })
  const inputs: unknown[] = []
  const offer = await batch.offer('a-call', a, async (input) => { inputs.push(input); return b })
  expect(inputs).toEqual([{ node: 'b' }])
  expect(offer?.jobs.map(({ callId }) => callId)).toEqual(['a-call', 'b-call'])
  expect(offer?.totalPoints).toBe(15)
  expect(batch.consume('b-call', b)).toBe('none')
  batch.approve(offer!)
  expect(batch.consume('a-call', a)).toBe('none')
  expect(batch.consume('b-call', b)).toBe('approved')
  expect(batch.consume('b-call', b)).toBe('none')
})

it('never batches unknown prices or repeated targets; a changed approved quote is single-use and must reconfirm', async () => {
  const batch = createBatchConfirmations()
  batch.enqueue(1, 'a-call', 'generate', {})
  batch.enqueue(1, 'b-call', 'generate', {})
  await expect(batch.offer('a-call', a, async () => ({ ...b, points: null }))).resolves.toBeNull()
  await expect(batch.offer('a-call', a, async () => ({ ...b, nodeId: 'a' }))).resolves.toBeNull()
  const offer = await batch.offer('a-call', a, async () => b)
  batch.approve(offer!)
  expect(batch.consume('b-call', { ...b, points: 10 })).toBe('changed')
  expect(batch.consume('b-call', b)).toBe('none')
})

it('can reject a queued task individually without approving the active task or later variants', async () => {
  const batch = createBatchConfirmations()
  batch.enqueue(1, 'a-call', 'generate', {})
  batch.enqueue(1, 'b-call', 'generate', {})
  const offer = await batch.offer('a-call', a, async () => b)
  const remaining = batch.decide(offer!, 'b-call', false)
  expect(remaining).toBeUndefined()
  expect(batch.consume('a-call', a)).toBe('none')
  expect(batch.consume('b-call', { ...b, points: 10 })).toBe('declined')
})
