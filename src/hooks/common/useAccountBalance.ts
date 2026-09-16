'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { normalizeAccountPointCredit } from '@/lib/account/credits'
import { apiFetch } from '@/lib/api-fetch'
import { BALANCE_CHANGED_EVENT } from '@/lib/billing/client'

export function useAccountBalance() {
  const { data: session } = useSession()
  const [livePoints, setLivePoints] = useState<number | null>(null)
  const [generationAllowed, setGenerationAllowed] = useState<boolean | null>(null)

  const refreshBalance = useCallback(async () => {
    if (!session?.user?.id) return
    try {
      const response = await apiFetch('/api/user/balance', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json() as { balancePoints?: unknown; generationAllowed?: unknown }
      const value = Number(payload.balancePoints)
      if (Number.isFinite(value)) setLivePoints(value)
      if (typeof payload.generationAllowed === 'boolean') setGenerationAllowed(payload.generationAllowed)
    } catch {
      // Keep the last visible value during a transient network failure.
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id) {
      setLivePoints(null)
      setGenerationAllowed(null)
      return
    }
    void refreshBalance()
    const timer = window.setInterval(() => void refreshBalance(), 15_000)
    const refresh = () => void refreshBalance()
    window.addEventListener(BALANCE_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(BALANCE_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [refreshBalance, session?.user?.id])

  const points = livePoints ?? normalizeAccountPointCredit(session?.user?.pointCredits)
  return {
    points,
    generationAllowed: generationAllowed ?? points > 0,
    refreshBalance,
  }
}
