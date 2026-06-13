import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recoveryProbeTestUtils,
  startRecoveryProbe,
} from '@/lib/query/hooks/run-stream/recovery-probe'

describe('recovery probe', () => {
  afterEach(() => {
    vi.useRealTimers()
    recoveryProbeTestUtils.clearSuccessfulProbeScopes()
  })

  it('probes once and stops when no active run is found', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockResolvedValue(null)
    const onRecovered = vi.fn()

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(resolveActiveRunId).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      storageScopeKey: 'episode-1',
    })
    expect(onRecovered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)

    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(onRecovered).not.toHaveBeenCalled()

    cleanup()
  })

  it('recovers immediately when the probe finds an active run', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockResolvedValue('run-2')
    const onRecovered = vi.fn()

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered,
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(onRecovered).toHaveBeenCalledWith('run-2')

    cleanup()
  })
})
