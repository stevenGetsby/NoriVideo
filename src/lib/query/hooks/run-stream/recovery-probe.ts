'use client'

const PROBE_SUCCESS_COOLDOWN_MS = 60_000
const successfulProbeScopes = new Map<string, number>()

type RecoveryProbeContext = {
  projectId: string
  storageScopeKey?: string
}

type StartRecoveryProbeArgs = {
  projectId: string
  storageKey: string
  storageScopeKey?: string
  hasRunState: () => boolean
  resolveActiveRunId: (context: RecoveryProbeContext) => Promise<string | null>
  onRecovered: (runId: string) => void
}

export function startRecoveryProbe(args: StartRecoveryProbeArgs): () => void {
  let cancelled = false

  const probe = async () => {
    if (cancelled || args.hasRunState()) return

    const lastSuccessAt = successfulProbeScopes.get(args.storageKey)
    if (lastSuccessAt) {
      const cooldownRemainingMs =
        PROBE_SUCCESS_COOLDOWN_MS - (Date.now() - lastSuccessAt)
      if (cooldownRemainingMs > 0) {
        return
      }
    }

    const activeRunId = await args.resolveActiveRunId({
      projectId: args.projectId,
      storageScopeKey: args.storageScopeKey,
    }).catch(() => null)

    if (cancelled || args.hasRunState()) return

    if (!activeRunId) {
      return
    }

    successfulProbeScopes.set(args.storageKey, Date.now())
    args.onRecovered(activeRunId)
  }

  void probe()

  return () => {
    cancelled = true
  }
}

export const recoveryProbeTestUtils = {
  clearSuccessfulProbeScopes() {
    successfulProbeScopes.clear()
  },
  PROBE_SUCCESS_COOLDOWN_MS,
}
