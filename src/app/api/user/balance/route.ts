import { NextResponse } from 'next/server'
import { getBalance, getVisibleUserTotalSpent } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET /api/user/balance
 * 获取当前用户余额
 */
export const GET = apiHandler(async () => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const [balance, visibleTotalSpent] = await Promise.all([
        getBalance(session.user.id),
        getVisibleUserTotalSpent(session.user.id),
    ])

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
        balance: balance.balance,
        frozenAmount: balance.frozenAmount,
        totalSpent: visibleTotalSpent
    })
})
