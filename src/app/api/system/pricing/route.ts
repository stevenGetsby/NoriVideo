import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { listBuiltinPricingCatalog, type PricingApiType } from '@/lib/model-pricing/catalog'
import { BUILTIN_PRICING_VERSION } from '@/lib/model-pricing/version'
import { BILLING_CURRENCY } from '@/lib/billing/currency'

const API_TYPES: PricingApiType[] = ['text', 'image', 'video', 'voice', 'voice-design', 'lip-sync']

function pricingAmounts(entry: ReturnType<typeof listBuiltinPricingCatalog>[number]) {
  if (entry.pricing.mode === 'flat') return [entry.pricing.flatAmount ?? 0]
  return (entry.pricing.tiers || []).map((tier) => tier.amount)
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const entries = listBuiltinPricingCatalog()
  const byApiType = API_TYPES.map((apiType) => {
    const matched = entries.filter((entry) => entry.apiType === apiType)
    const amounts = matched.flatMap(pricingAmounts).filter((amount) => Number.isFinite(amount))
    return {
      apiType,
      providerCount: new Set(matched.map((entry) => entry.provider)).size,
      modelCount: matched.length,
      minAmount: amounts.length > 0 ? Math.min(...amounts) : null,
      maxAmount: amounts.length > 0 ? Math.max(...amounts) : null,
    }
  })

  return NextResponse.json({
    success: true,
    currency: BILLING_CURRENCY,
    version: BUILTIN_PRICING_VERSION,
    totalModels: entries.length,
    byApiType,
  })
})
