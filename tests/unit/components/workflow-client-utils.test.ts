import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getApprovalBlockReason,
  buildQcPanelViewModel,
  createInFlightKeyGuard,
  describeWorkflowApiError,
  getAutoWaitingReviewMessage,
  getStageRunBlockReason,
  hasBatchRunRunningStages,
  hasSkillTrialScopeChanged,
  isStaleRevisionError,
  isTrialForSkill,
  mergePolledRun,
  performWithDraftFlush,
  readWorkflowMutationError,
  shouldAcceptWorkflowResponse,
  shouldClearDirtyAfterRun,
  startWorkflowSyncPolling,
  withExpectedRevision,
} from '@/components/batch-workflow/workflow-client-utils'
import type { BatchItemDTO, BatchRunDTO, WorkflowSkillDTO } from '@/lib/batch-workflow/types'

function makeItem(overrides: Record<string, unknown> = {}): BatchItemDTO {
  return {
    id: 'item-1',
    index: 0,
    title: 'Item 1',
    status: 'idle',
    currentStage: 'script_analysis',
    stageStates: {},
    stageOutputs: {},
    inputPayload: {},
    ...overrides,
  } as unknown as BatchItemDTO
}

function makeRun(overrides: Record<string, unknown> = {}): BatchRunDTO {
  return {
    id: 'run-1',
    title: 'Run',
    runMode: 'gated',
    items: [makeItem()],
    ...overrides,
  } as unknown as BatchRunDTO
}

describe('withExpectedRevision', () => {
  it('attaches the current item revision to every mutation body', () => {
    expect(withExpectedRevision({ action: 'save_draft' }, makeItem({ revision: 7 }))).toEqual({
      action: 'save_draft',
      expectedRevision: 7,
    })
  })

  it('falls back to revision 0 for legacy rows without a revision', () => {
    expect(withExpectedRevision({ action: 'approve' }, makeItem()).expectedRevision).toBe(0)
    expect(withExpectedRevision({ action: 'approve' }, null).expectedRevision).toBe(0)
  })
})

describe('readWorkflowMutationError / isStaleRevisionError', () => {
  it('marks a 409 STALE_REVISION response so the caller can keep the local draft', async () => {
    const response = new Response(JSON.stringify({ code: 'STALE_REVISION', message: 'revision mismatch' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
    const error = await readWorkflowMutationError(response, '保存草稿失败')
    expect(isStaleRevisionError(error)).toBe(true)
    expect(error.message).toContain('服务器已有更新')
  })

  it('does not mark other failures as stale conflicts', async () => {
    const response = new Response(JSON.stringify({ code: 'STAGE_ALREADY_RUNNING' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
    const error = await readWorkflowMutationError(response, '执行失败')
    expect(isStaleRevisionError(error)).toBe(false)
  })
})

describe('workflow API error descriptions', () => {
  it('maps concurrent execution, QC and unavailable model errors to actionable Chinese text', () => {
    expect(describeWorkflowApiError('STAGE_ALREADY_RUNNING', '执行失败')).toBe('该环节正在执行，请稍候')
    expect(describeWorkflowApiError('QC_FAILED', '执行失败')).toBe('质量检查未通过，已保留上一版内容，请查看违规项后重试或手工修改')
    expect(describeWorkflowApiError('MODEL_UNAVAILABLE', '执行失败')).toBe('所选模型当前不可用，请换一个模型后重试')
  })

  it('distinguishes unfinished asset and take selection errors', () => {
    expect(describeWorkflowApiError('ASSET_NOT_READY', '操作失败', 'asset')).toBe('该资产版本尚未就绪')
    expect(describeWorkflowApiError('ASSET_NOT_READY', '操作失败', 'take')).toBe('该镜头版本尚未生成完成，不能采用')
  })

  it('keeps stale revision explicit and unknown errors unchanged', () => {
    expect(describeWorkflowApiError('STALE_REVISION', '保存失败')).toBe('服务器已有更新：保存失败')
    expect(describeWorkflowApiError('INVALID_PARAMS', '参数无效')).toBe('参数无效')
  })

  it('propagates a take-not-ready API failure as a rejected readable error', async () => {
    const makeResponse = () => new Response(JSON.stringify({ code: 'ASSET_NOT_READY' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(readWorkflowMutationError(makeResponse(), '切换视频版本失败', 'take'))
      .resolves.toMatchObject({ code: 'ASSET_NOT_READY', message: '该镜头版本尚未生成完成，不能采用' })
    const error = await readWorkflowMutationError(makeResponse(), '切换视频版本失败', 'take')
    await expect(Promise.reject(error)).rejects.toThrow('该镜头版本尚未生成完成，不能采用')
  })
})

describe('getStageRunBlockReason', () => {
  it('blocks script analysis when there is no source video or pasted script', () => {
    expect(getStageRunBlockReason(makeItem(), 'script_analysis')).toContain('请先上传参考视频或粘贴剧本')
  })

  it('allows script analysis once a pasted script exists', () => {
    const item = makeItem({ inputPayload: { pastedScript: '一段剧本' } })
    expect(getStageRunBlockReason(item, 'script_analysis')).toBeNull()
  })

  it('blocks video generation when the storyboard has no shots', () => {
    expect(getStageRunBlockReason(makeItem(), 'video_gen')).toContain('请先保存包含镜头的分镜')
  })

  it('allows running a stage that already has output (rerun)', () => {
    const item = makeItem({
      stageOutputs: { storyboard: { shots: [{ id: 's1' }] } },
    })
    expect(getStageRunBlockReason(item, 'storyboard')).toBeNull()
  })
})

describe('getApprovalBlockReason', () => {
  it('rejects Cmd+Enter approval when the draft is empty', () => {
    expect(getApprovalBlockReason(makeItem(), 'script_analysis', {})).toBe('当前草稿为空或尚无产物，请先运行本环节。')
  })

  it('accepts a non-empty draft even before the server output exists', () => {
    const draft = { fullScriptText: '剧本内容' }
    expect(getApprovalBlockReason(makeItem(), 'script_analysis', draft)).toBeNull()
  })

  it('rejects approval when the upstream artifact is missing', () => {
    const item = makeItem({
      stageOutputs: { storyboard: { shots: [{ id: 's1' }] } },
    })
    // video_gen has no shots of its own yet, so approval is blocked by the empty draft rule.
    expect(getApprovalBlockReason(item, 'video_gen')).toBe('当前草稿为空或尚无产物，请先运行本环节。')
    const withUpstream = makeItem({
      stageOutputs: {
        asset_extraction: { items: [{ id: 'a' }] },
        storyboard: { shots: [{ id: 's1' }] },
      },
    })
    expect(getApprovalBlockReason(withUpstream, 'storyboard')).toBeNull()
    const noUpstream = makeItem({
      stageOutputs: { storyboard: { shots: [{ id: 's1' }] } },
    })
    expect(getApprovalBlockReason(noUpstream, 'storyboard')).toBe('上游产物为空，请先完成上一环节再确认。')
  })
})

describe('isTrialForSkill', () => {
  const skill = { id: 'skill-a', version: 3, stage: 'script_rewrite' } as WorkflowSkillDTO

  it('matches only the exact skill id, version and stage', () => {
    expect(isTrialForSkill({ skillId: 'skill-a', skillVersion: 3, stage: 'script_rewrite' }, skill)).toBe(true)
  })

  it('rejects a trial from a previous skill version', () => {
    expect(isTrialForSkill({ skillId: 'skill-a', skillVersion: 2, stage: 'script_rewrite' }, skill)).toBe(false)
  })

  it('rejects a trial bound to another skill', () => {
    expect(isTrialForSkill({ skillId: 'skill-b', skillVersion: 3, stage: 'script_rewrite' }, skill)).toBe(false)
  })

  it('rejects a trial from another stage', () => {
    expect(isTrialForSkill({ skillId: 'skill-a', skillVersion: 3, stage: 'storyboard' }, skill)).toBe(false)
  })

  it('rejects when there is no selected skill', () => {
    expect(isTrialForSkill({ skillId: 'skill-a', skillVersion: 3, stage: 'script_rewrite' }, null)).toBe(false)
  })
})

describe('getAutoWaitingReviewMessage', () => {
  it('explains why auto mode stopped at waiting_review', () => {
    const item = makeItem({
      currentStage: 'storyboard',
      stageStates: { storyboard: { status: 'waiting_review' } },
    })
    const run = makeRun({ runMode: 'auto', items: [item] })
    expect(getAutoWaitingReviewMessage(run, item)).toContain('待确认')
  })

  it('stays silent for gated mode', () => {
    const item = makeItem({
      currentStage: 'storyboard',
      stageStates: { storyboard: { status: 'waiting_review' } },
    })
    expect(getAutoWaitingReviewMessage(makeRun({ items: [item] }), item)).toBeNull()
  })

  it('stays silent when the stage is still running', () => {
    const item = makeItem({
      currentStage: 'storyboard',
      stageStates: { storyboard: { status: 'running' } },
    })
    expect(getAutoWaitingReviewMessage(makeRun({ runMode: 'auto', items: [item] }), item)).toBeNull()
  })
})

describe('hasBatchRunRunningStages', () => {
  it('detects queued stage runs so polling keeps using POST /sync', () => {
    const items = [makeItem({ stageStates: { storyboard: { status: 'running' } } })]
    expect(hasBatchRunRunningStages(items)).toBe(true)
    expect(hasBatchRunRunningStages([makeItem()])).toBe(false)
    expect(hasBatchRunRunningStages([])).toBe(false)
    expect(hasBatchRunRunningStages(null)).toBe(false)
  })
})

describe('mergePolledRun', () => {
  it('keeps local edits for the dirty item while accepting server revisions', () => {
    const localItem = makeItem({
      revision: 2,
      stageOutputs: { script_analysis: { fullScriptText: '本地未保存草稿' } },
    })
    const incomingItem = makeItem({
      revision: 5,
      stageOutputs: { script_analysis: { fullScriptText: '服务器内容' } },
    })
    const merged = mergePolledRun(makeRun({ items: [localItem] }), makeRun({ items: [incomingItem] }), 'item-1')
    expect(merged.items![0].stageOutputs.script_analysis?.fullScriptText).toBe('本地未保存草稿')
    expect(merged.items![0].revision).toBe(5)
  })

  it('accepts server output when nothing is dirty', () => {
    const incomingItem = makeItem({
      stageOutputs: { script_analysis: { fullScriptText: '服务器内容' } },
    })
    const merged = mergePolledRun(makeRun(), makeRun({ items: [incomingItem] }), null)
    expect(merged.items![0].stageOutputs.script_analysis?.fullScriptText).toBe('服务器内容')
  })

  it('passes through runs from another id untouched', () => {
    const incoming = makeRun({ id: 'run-2' })
    expect(mergePolledRun(makeRun(), incoming, 'item-1')).toBe(incoming)
  })
})

describe('performWithDraftFlush', () => {
  it('switches only after the draft flush resolves', async () => {
    const order: string[] = []
    await performWithDraftFlush(async () => {
      order.push('flush')
    }, () => {
      order.push('switch')
    })
    expect(order).toEqual(['flush', 'switch'])
  })

  it('does not switch items when the draft flush fails, and propagates the error', async () => {
    let switched = false
    await expect(performWithDraftFlush(
      async () => {
        throw new Error('保存草稿失败')
      },
      () => {
        switched = true
      },
    )).rejects.toThrow('保存草稿失败')
    expect(switched).toBe(false)
  })

  it('still runs the action when there is nothing to flush', async () => {
    await expect(performWithDraftFlush(async () => {}, () => 'ok')).resolves.toBe('ok')
  })
})

describe('workflow response guards', () => {
  it('drops a late response from run A after switching to run B', () => {
    expect(shouldAcceptWorkflowResponse({ runId: 'a', sequence: 1 }, 'b', 1)).toBe(false)
  })

  it('drops an older sequence within the same run and accepts the latest one', () => {
    expect(shouldAcceptWorkflowResponse({ runId: 'a', sequence: 2 }, 'a', 3)).toBe(false)
    expect(shouldAcceptWorkflowResponse({ runId: 'a', sequence: 3 }, 'a', 3)).toBe(true)
  })

  it('rejects responses when no run is active', () => {
    expect(shouldAcceptWorkflowResponse({ runId: 'a', sequence: 1 }, null, 1)).toBe(false)
  })
})

describe('dirty handling after run submission', () => {
  it.each([
    [false, false, true],
    [false, true, true],
    [true, false, false],
    [true, true, true],
  ])('hadDirty=%s flushSaved=%s => %s', (hadDirty, flushSaved, expected) => {
    expect(shouldClearDirtyAfterRun(hadDirty, flushSaved)).toBe(expected)
  })
})

describe('real shot trial in-flight guard', () => {
  it('allows one request per item and shot, releases it, and isolates other shots', () => {
    const guard = createInFlightKeyGuard()
    const release = guard.acquire('item-1:shot-1')
    expect(() => guard.acquire('item-1:shot-1')).toThrow('该镜头正在试跑，请稍候')
    expect(() => guard.acquire('item-1:shot-2')).not.toThrow()
    release()
    expect(() => guard.acquire('item-1:shot-1')).not.toThrow()
  })

  it('resets real trial confirmation only when item or skill scope changes', () => {
    expect(hasSkillTrialScopeChanged(
      { itemId: 'a', skillId: 's1' }, { itemId: 'b', skillId: 's1' },
    )).toBe(true)
    expect(hasSkillTrialScopeChanged(
      { itemId: 'a', skillId: 's1' }, { itemId: 'a', skillId: 's2' },
    )).toBe(true)
    expect(hasSkillTrialScopeChanged(
      { itemId: 'a', skillId: 's1' }, { itemId: 'a', skillId: 's1' },
    )).toBe(false)
  })
})

describe('QC panel view model', () => {
  const violations = Array.from({ length: 7 }, (_, index) => ({
    rule: `rule-${index}`,
    path: `shots[${index}].prompt`,
    message: `问题 ${index}`,
  }))

  it('hides passed reports and distinguishes failed from warning', () => {
    expect(buildQcPanelViewModel({ status: 'passed', violations, retryCount: 0, checkedAt: '' })).toBeNull()
    expect(buildQcPanelViewModel({ status: 'failed', violations: [], retryCount: 0, checkedAt: '' })?.level).toBe('failed')
    expect(buildQcPanelViewModel({ status: 'warning', violations: [], retryCount: 0, checkedAt: '' })?.level).toBe('warning')
  })

  it('shows at most five violations and reports the folded remainder', () => {
    const panel = buildQcPanelViewModel({ status: 'failed', violations, retryCount: 1, checkedAt: '' })
    expect(panel?.visibleViolations).toHaveLength(5)
    expect(panel?.hiddenCount).toBe(2)
  })
})

describe('startWorkflowSyncPolling', () => {
  const listeners = new Set<() => void>()
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fakeDocument.visibilityState = 'visible'
    vi.stubGlobal('document', fakeDocument)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    listeners.clear()
    vi.useRealTimers()
  })

  it('runs serially without overlapping requests', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const stop = startWorkflowSyncPolling(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 1000))
      inFlight -= 1
    }, 4000)

    await vi.advanceTimersByTimeAsync(13000)
    stop()
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(maxInFlight).toBe(1)
  })

  it('pauses while the tab is hidden and fires immediately when visible again', async () => {
    const calls: number[] = []
    const stop = startWorkflowSyncPolling(() => {
      calls.push(Date.now())
    }, 4000)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(1)

    fakeDocument.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(12000)
    expect(calls.length).toBe(1)

    fakeDocument.visibilityState = 'visible'
    listeners.forEach((listener) => listener())
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(2)
    stop()
  })

  it('aborts the in-flight request on cleanup and stops scheduling', async () => {
    const signals: AbortSignal[] = []
    let calls = 0
    const stop = startWorkflowSyncPolling((signal) => {
      signals.push(signal)
      calls += 1
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve())
      })
    }, 4000)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(20000)
    expect(calls).toBe(1)
  })

  it('swallows callback failures and keeps polling', async () => {
    let calls = 0
    const stop = startWorkflowSyncPolling(() => {
      calls += 1
      throw new Error('network down')
    }, 4000)
    await vi.advanceTimersByTimeAsync(9000)
    stop()
    expect(calls).toBe(3)
  })
})
