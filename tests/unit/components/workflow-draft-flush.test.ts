import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchRunDTO } from '@/lib/batch-workflow/types'
import {
  flushWorkflowDraft,
  readWorkflowMutationError,
} from '@/components/batch-workflow/workflow-client-utils'

function runWithRevision(revision: number): BatchRunDTO {
  return {
    id: 'run-1', title: 'Run', runMode: 'gated',
    items: [{ id: 'item-1', revision } as NonNullable<BatchRunDTO['items']>[number]],
  } as BatchRunDTO
}

describe('flushWorkflowDraft', () => {
  beforeEach(() => vi.clearAllMocks())

  it('handles STALE_REVISION through the conflict choice, rejects and preserves dirty state', async () => {
    const onConflict = vi.fn(async () => {})
    await expect(flushWorkflowDraft({
      request: async () => new Response(JSON.stringify({ code: 'STALE_REVISION' }), { status: 409 }),
      onStaleConflict: onConflict,
      onSaved: () => { throw new Error('must not save') },
      readError: (response) => readWorkflowMutationError(response, '保存草稿失败'),
    })).rejects.toMatchObject({ code: 'STALE_REVISION' })
    expect(onConflict).toHaveBeenCalledOnce()
  })

  it('refreshes the revision when keeping edits, then saves successfully with that revision', async () => {
    const revisions: number[] = []
    let currentRevision = 2
    const onSaved = vi.fn()
    const save = async () => {
      await flushWorkflowDraft({
        request: async () => {
          revisions.push(currentRevision)
          if (currentRevision === 2) {
            return new Response(JSON.stringify({ code: 'STALE_REVISION' }), { status: 409 })
          }
          return Response.json({ run: runWithRevision(9) })
        },
        onStaleConflict: async () => { currentRevision = 8 },
        onSaved: () => onSaved(),
        readError: (response) => readWorkflowMutationError(response, '保存草稿失败'),
      })
    }
    await expect(save()).rejects.toMatchObject({ code: 'STALE_REVISION' })
    await expect(save()).resolves.toBeUndefined()
    expect(revisions).toEqual([2, 8])
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('rejects non-conflict failures without offering a stale choice', async () => {
    const onConflict = vi.fn(async () => {})
    await expect(flushWorkflowDraft({
      request: async () => new Response('network error', { status: 500 }),
      onStaleConflict: onConflict,
      onSaved: vi.fn(),
      readError: (response) => readWorkflowMutationError(response, '保存草稿失败'),
    })).rejects.toThrow()
    expect(onConflict).not.toHaveBeenCalled()
  })
})
