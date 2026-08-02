import { NextResponse } from 'next/server'
import { getBalance, getVisibleUserTotalSpent } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
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

    const billingUserId = session.user.actorId || session.user.id
    const [balance, visibleTotalSpent] = await Promise.all([
        getBalance(billingUserId),
        getVisibleUserTotalSpent(billingUserId),
    ])

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
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
        generationAllowed: canStartGeneration(balance.balance),
    })
})
