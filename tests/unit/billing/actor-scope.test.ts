import { describe, expect, it, vi } from 'vitest'
import {
  isManagerPaid,
  taskWhere,
  transactionWhere,
  usageCostWhere,
  type RecordScope,
} from '@/lib/billing/actor-scope'

const team: RecordScope = { kind: 'team', ownerId: 'manager', accountIds: ['manager', 'member'] }
const self: RecordScope = { kind: 'self', ownerId: 'manager', actorId: 'member' }

describe('actor-scoped billing records', () => {
  it('scopes team usage to all active or disabled team accounts', () => {
    expect(usageCostWhere(team)).toEqual({ userId: { in: ['manager', 'member'] } })
    expect(transactionWhere(team)).toEqual({ userId: 'manager' })
    expect(taskWhere(team)).toEqual({ userId: 'manager' })
  })
  it('includes member-owned and historical manager-paid rows', () => {
    expect(usageCostWhere(self)).toEqual({ OR: [
      { userId: 'member' },
      { userId: 'manager', metadata: { contains: '"quotaUserId":"member"' } },
    ] })
    expect(transactionWhere(self)).toEqual({ OR: [
      { userId: 'member' },
      { userId: 'manager', type: 'consume', billingMeta: { contains: '"quotaUserId":"member"' } },
      { userId: 'manager', type: { in: ['allocate_out', 'allocate_in'] }, description: { contains: '"counterpartId":"member"' } },
    ] })
    expect(taskWhere(self)).toEqual({ userId: 'manager', payload: { path: '$.meta.quotaUserId', equals: 'member' } })
  })
  it('only marks manager-owned rows in a member scope as manager paid', () => {
    expect(isManagerPaid({ userId: 'manager' }, self)).toBe(true)
    expect(isManagerPaid({ userId: 'manager', type: 'allocate_out' }, self)).toBe(false)
    expect(isManagerPaid({ userId: 'member' }, self)).toBe(false)
    expect(isManagerPaid({ userId: 'manager' }, team)).toBe(false)
  })
})
