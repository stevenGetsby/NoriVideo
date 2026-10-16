import { describe, expect, it } from 'vitest'
import { resolveBillingPrincipals } from '@/lib/account/billing-identity'
import { buildTrustedTaskQuotaMeta, getGenerationQuotaUserId, setAccountActorContext, withAccountPermissionContext, withTaskQuotaContext } from '@/lib/account/request-context'

describe('wallet/actor identity boundaries', () => {
  it('uses the same shared wallet before and after server auth rewrites the data scope', () => {
    const child = { id: 'child', role: 'storyboard', workspaceOwnerId: 'manager' }
    expect(resolveBillingPrincipals(child)).toEqual({ walletUserId: 'manager', actorUserId: 'child', walletScope: 'workspace' })
    expect(resolveBillingPrincipals({ ...child, id: 'manager', actorId: 'child' })).toEqual(resolveBillingPrincipals(child))
    expect(resolveBillingPrincipals({ id: 'manager', role: 'admin', workspaceOwnerId: 'another-wallet' }))
      .toEqual({ walletUserId: 'manager', actorUserId: 'manager', walletScope: 'personal' })
  })
  it('strips caller-supplied task quota identity and uses only validated request context', async () => {
    expect(buildTrustedTaskQuotaMeta('manager', { quotaUserId: 'forged', locale: 'zh' })).toEqual({ locale: 'zh' })
    await withAccountPermissionContext([], async () => {
      setAccountActorContext('child', 'manager')
      expect(buildTrustedTaskQuotaMeta('manager', { quotaUserId: 'forged', locale: 'zh' }))
        .toEqual({ quotaUserId: 'child', locale: 'zh' })
    })
  })
  it('keeps two overlapping worker quota contexts isolated and restores the parent afterward', async () => {
    await Promise.all(['child-a', 'child-b'].map((actor) => withTaskQuotaContext('manager', { meta: { quotaUserId: actor } }, async () => {
      await Promise.resolve()
      expect(getGenerationQuotaUserId('manager')).toBe(actor)
      expect(buildTrustedTaskQuotaMeta('manager', {})).toEqual({ quotaUserId: actor })
    })))
    expect(getGenerationQuotaUserId('manager')).toBe('manager')
    withTaskQuotaContext('manager', { meta: { quotaUserId: [] } }, () => {
      expect(getGenerationQuotaUserId('manager')).toBe('manager')
    })
  })
})
