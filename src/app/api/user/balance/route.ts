import { NextResponse } from 'next/server'
import { getBalance, getVisibleUserTotalSpent } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getDailyUsageSnapshot, serializeDailyUsage } from '@/lib/billing/daily-limit'
import { resolveBillingPrincipals } from '@/lib/account/billing-identity'
import {
    POINTS_PER_CNY,
    GENERATION_CREDIT_FLOOR_CNY,
    GENERATION_CREDIT_FLOOR_POINTS,
    canStartGeneration,
    cnyToPoints,
} from '@/lib/billing/credit-policy'

/**
 * GET /api/user/balance
 * 获取当前用户余额
 */
export const GET = apiHandler(async () => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { walletUserId, actorUserId, walletScope } = resolveBillingPrincipals(session.user)
    const [balance, visibleTotalSpent, dailyUsage] = await Promise.all([
        getBalance(walletUserId),
        getVisibleUserTotalSpent(walletUserId),
        getDailyUsageSnapshot(actorUserId),
    ])

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
        walletScope,
        walletUserId,
        quotaUserId: actorUserId,
        balance: balance.balance,
        frozenAmount: balance.frozenAmount,
        totalSpent: visibleTotalSpent,
        balanceCny: balance.balance,
        frozenAmountCny: balance.frozenAmount,
        totalSpentCny: visibleTotalSpent,
        balancePoints: cnyToPoints(balance.balance),
        frozenPoints: cnyToPoints(balance.frozenAmount),
        totalSpentPoints: cnyToPoints(visibleTotalSpent),
        pointValueCny: 1 / POINTS_PER_CNY,
        pointsPerCny: POINTS_PER_CNY,
        generationCreditFloor: GENERATION_CREDIT_FLOOR_POINTS,
        generationCreditFloorPoints: GENERATION_CREDIT_FLOOR_POINTS,
        generationCreditFloorCny: GENERATION_CREDIT_FLOOR_CNY,
        generationAllowed: canStartGeneration(balance.balance) && !dailyUsage.exceeded,
        // 管理账号设置的每日用量上限：limitPoints 为 null 表示不限制。
        dailyLimitPoints: dailyUsage.limitPoints,
        dailyUsedPoints: dailyUsage.usedPoints,
        dailyRemainingPoints: dailyUsage.remainingPoints,
        dailyLimitExceeded: dailyUsage.exceeded,
        dailyLimitResetsAt: dailyUsage.windowEnd,
        dailyUsage: serializeDailyUsage(dailyUsage),
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' } })
})
