import { describe, expect, it } from 'vitest'
import { resolveBillingPrincipals } from '@/lib/account/billing-identity'
import { buildTrustedTaskQuotaMeta, resolveGenerationPayerId, setAccountActorContext, withAccountPermissionContext, withTaskQuotaContext } from '@/lib/account/request-context'

describe('wallet/actor identity boundaries', () => {
  it('charges the actor wallet and keeps the manager as funding owner', () => {
    const child = { id: 'child', role: 'storyboard', workspaceOwnerId: 'manager' }
    expect(resolveBillingPrincipals(child)).toEqual({
      walletUserId: 'child',
      actorUserId: 'child',
      ownerUserId: 'manager',
      isMember: true,
    })
    expect(resolveBillingPrincipals({ ...child, id: 'manager', actorId: 'child' }))
      .toEqual(resolveBillingPrincipals(child))
    expect(resolveBillingPrincipals({ id: 'manager', role: 'admin', workspaceOwnerId: 'another-wallet' }))
      .toEqual({ walletUserId: 'manager', actorUserId: 'manager', ownerUserId: 'manager', isMember: false })
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
      expect(resolveGenerationPayerId('manager')).toBe(actor)
      expect(buildTrustedTaskQuotaMeta('manager', {})).toEqual({ quotaUserId: actor })
    })))
    expect(resolveGenerationPayerId('manager')).toBe('manager')
    withTaskQuotaContext('manager', { meta: { quotaUserId: [] } }, () => {
      expect(resolveGenerationPayerId('manager')).toBe('manager')
    })
  })
})
