'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { normalizeAccountPointCredit } from '@/lib/account/credits'
import { apiFetch } from '@/lib/api-fetch'
import { subscribeBalanceChanges } from '@/lib/billing/client'
import { resolveBillingPrincipals } from '@/lib/account/billing-identity'

export type DailyBalanceUsage = {
  /** null 表示该账号未设置每日上限 */
  limitPoints: number | null
  usedPoints: number
  remainingPoints: number | null
  exceeded: boolean
  resetsAt: string | null
}

function readFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeDailyBalanceUsage(payload: {
  dailyLimitPoints?: unknown
  dailyUsedPoints?: unknown
  dailyRemainingPoints?: unknown
  dailyLimitExceeded?: unknown
  dailyLimitResetsAt?: unknown
}): DailyBalanceUsage | null {
  const rawLimit = readFiniteNumber(payload.dailyLimitPoints)
  const limitPoints = rawLimit !== null && rawLimit >= 0 ? rawLimit : null
  const usedPoints = readFiniteNumber(payload.dailyUsedPoints)
  if (usedPoints === null && limitPoints === null) return null
  return {
    limitPoints,
    usedPoints: usedPoints ?? 0,
    remainingPoints: limitPoints === null ? null : readFiniteNumber(payload.dailyRemainingPoints),
    exceeded: limitPoints !== null && (limitPoints === 0 || payload.dailyLimitExceeded === true),
    resetsAt: typeof payload.dailyLimitResetsAt === 'string' ? payload.dailyLimitResetsAt : null,
  }
}

export function useAccountBalance() {
  const { data: session } = useSession()
  const principals = session?.user?.id ? resolveBillingPrincipals(session.user) : null
  const identityKey = principals ? `${principals.actorUserId}:${principals.walletUserId}` : ''
  const currentIdentityRef = useRef(identityKey)
  currentIdentityRef.current = identityKey
  const [snapshotIdentity, setSnapshotIdentity] = useState('')
  const [livePoints, setLivePoints] = useState<number | null>(null)
  const [generationAllowed, setGenerationAllowed] = useState<boolean | null>(null)
  const [dailyUsage, setDailyUsage] = useState<DailyBalanceUsage | null>(null)
  const requestSequenceRef = useRef(0)
  const appliedSequenceRef = useRef(0)
  const requestEpochRef = useRef(0)

  const refreshBalance = useCallback(async () => {
    if (!session?.user?.id) return
    const sequence = ++requestSequenceRef.current
    const epoch = requestEpochRef.current
    try {
      const response = await apiFetch('/api/user/balance', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json() as {
        balancePoints?: unknown
        generationAllowed?: unknown
        dailyLimitPoints?: unknown
        dailyUsedPoints?: unknown
        dailyRemainingPoints?: unknown
        dailyLimitExceeded?: unknown
        dailyLimitResetsAt?: unknown
      }
      // Compare completed responses, not started requests: on a slow link,
      // polling can start another read before the previous read finishes.
      // Rejecting every such response would leave the gate loading forever.
      if (sequence < appliedSequenceRef.current || epoch !== requestEpochRef.current || currentIdentityRef.current !== identityKey) return
      appliedSequenceRef.current = sequence
      const value = Number(payload.balancePoints)
      if (Number.isFinite(value)) setLivePoints(value)
      if (typeof payload.generationAllowed === 'boolean') setGenerationAllowed(payload.generationAllowed)
      setDailyUsage(normalizeDailyBalanceUsage(payload))
      setSnapshotIdentity(identityKey)
    } catch {
      // Keep the last visible value during a transient network failure.
    }
  }, [identityKey, session?.user?.id])

  useEffect(() => {
    setLivePoints(null)
    setGenerationAllowed(null)
    setDailyUsage(null)
    setSnapshotIdentity('')
    if (!identityKey) {
      return
    }
    void refreshBalance()
    // Different ports/devices cannot receive a browser BroadcastChannel.
    // Re-read the authoritative gate within 3s while visible, plus on focus.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshBalance()
    }, 3_000)
    const refresh = () => void refreshBalance()
    const unsubscribe = subscribeBalanceChanges(refresh)
    window.addEventListener('focus', refresh)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      requestEpochRef.current += 1
    }
  }, [identityKey, refreshBalance])

  const ready = snapshotIdentity === identityKey && Boolean(identityKey)
  const currentDailyUsage = ready ? dailyUsage : null
  const points = (ready ? livePoints : null) ?? normalizeAccountPointCredit(session?.user?.pointCredits)
  return {
    points,
    walletScope: principals?.walletScope || 'personal',
    loading: !ready,
    // A stale positive login snapshot cannot authorize generation while the
    // current server wallet/limit is still unknown.
    generationAllowed: ready && points > 0 && generationAllowed === true && !currentDailyUsage?.exceeded,
    generationDisabledReason: !ready ? '正在核对可用积分与每日额度'
      : currentDailyUsage?.limitPoints === 0
      ? '管理账号已禁止生成（每日上限 0）'
      : currentDailyUsage?.exceeded ? '今日生成额度已用尽，请联系管理账号调整上限' : points <= 0 ? '积分不足，无法生成' : null,
    generationDisabledLabel: !ready ? '核对额度中' : currentDailyUsage?.limitPoints === 0 ? '禁止生成' : currentDailyUsage?.exceeded ? '额度用尽' : '积分不足',
    dailyUsage: currentDailyUsage,
    refreshBalance,
  }
}
