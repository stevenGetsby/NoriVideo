// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api-fetch'
import { useTaskTargetStateMap, type TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'

vi.mock('@/lib/api-fetch', () => ({ apiFetch: vi.fn() }))

const target = { targetType: 'NovelPromotionPanel', targetId: 'panel-1' }

it('resumes task polling when a query first fetched in a hidden tab becomes visible while still fresh', async () => {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  let visibility: DocumentVisibilityState = 'hidden'
  const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  const processing: TaskTargetState = {
    ...target,
    phase: 'processing',
    runningTaskId: 'task-1',
    runningTaskType: 'IMAGE_PANEL',
    intent: 'generate',
    hasOutputAtStart: false,
    progress: 20,
    stage: null,
    stageLabel: null,
    lastError: null,
    updatedAt: null,
  }
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(Response.json({ states: [processing] }))
    .mockResolvedValueOnce(Response.json({ states: [{ ...processing, phase: 'completed', progress: 100 }] }))

  function Probe() {
    const result = useTaskTargetStateMap('visibility-project', [target])
    return <span>{result.getState(target.targetType, target.targetId)?.phase}</span>
  }

  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>))
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(container.textContent).toBe('processing')
    expect(apiFetch).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(2400)
    })
    expect(container.textContent).toBe('completed')
    expect(apiFetch).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })
    expect(apiFetch).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    visibilitySpy.mockRestore()
    vi.mocked(apiFetch).mockReset()
    vi.useRealTimers()
    environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  }
})
