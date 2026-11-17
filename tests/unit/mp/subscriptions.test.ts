import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpReservation: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  mpSubscription: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  mpWork: { update: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
const workBySlug = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/mp/catalog', () => ({ workBySlug }))

import { addSubscription, setReservation } from '@/lib/mp/library'

const WORK = { id: 'mpw1', slug: 'abcd1234', status: 'scheduled' }

beforeEach(() => {
  vi.clearAllMocks()
  workBySlug.mockResolvedValue({ ...WORK })
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
    return Promise.all(arg as Promise<unknown>[])
  })
  prismaMock.mpReservation.findUnique.mockResolvedValue(null)
  prismaMock.mpReservation.create.mockResolvedValue({ id: 'res1' })
  prismaMock.mpReservation.delete.mockResolvedValue({ id: 'res1' })
  prismaMock.mpSubscription.findUnique.mockResolvedValue(null)
  prismaMock.mpSubscription.create.mockResolvedValue({ id: 'sub1', credits: 1 })
  prismaMock.mpSubscription.update.mockResolvedValue({ id: 'sub1', credits: 2 })
  prismaMock.mpWork.update.mockResolvedValue({ ...WORK })
  prismaMock.mpWork.findUnique.mockResolvedValue({ reserveCount: 3 })
})

describe('setReservation', () => {
  it('creates a reservation and increments reserveCount', async () => {
    const result = await setReservation('abcd1234', 'c1', true)
    expect(result).toEqual({ reserved: true, reserveCount: 3 })
    expect(prismaMock.mpReservation.create).toHaveBeenCalledWith({ data: { consumerId: 'c1', mpWorkId: 'mpw1' } })
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { reserveCount: { increment: 1 } } })
  })

  it('rejects works that are not scheduled', async () => {
    workBySlug.mockResolvedValue({ ...WORK, status: 'live' })
    await expect(setReservation('abcd1234', 'c1', true)).rejects.toMatchObject({ code: 'MP_INVALID_STATE', status: 409 })
    expect(prismaMock.mpReservation.create).not.toHaveBeenCalled()
  })

  it('is idempotent when already reserved', async () => {
    prismaMock.mpReservation.findUnique.mockResolvedValue({ id: 'res1' })
    const result = await setReservation('abcd1234', 'c1', true)
    expect(result.reserved).toBe(true)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('tolerates a concurrent create (P2002)', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.0.0' }))
    await expect(setReservation('abcd1234', 'c1', true)).resolves.toEqual({ reserved: true, reserveCount: 3 })
  })

  it('deletes and decrements when cancelling', async () => {
    prismaMock.mpReservation.findUnique.mockResolvedValue({ id: 'res1' })
    const result = await setReservation('abcd1234', 'c1', false)
    expect(result.reserved).toBe(false)
    expect(prismaMock.mpReservation.delete).toHaveBeenCalledWith({ where: { id: 'res1' } })
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { reserveCount: { decrement: 1 } } })
  })

  it('is a no-op when cancelling without a reservation', async () => {
    const result = await setReservation('abcd1234', 'c1', false)
    expect(result.reserved).toBe(false)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('addSubscription', () => {
  it('creates a subscription with one credit', async () => {
    const result = await addSubscription('abcd1234', 'c1', 'work_live', true)
    expect(result).toEqual({ credits: 1 })
    expect(prismaMock.mpSubscription.create).toHaveBeenCalledWith({ data: { consumerId: 'c1', mpWorkId: 'mpw1', kind: 'work_live', credits: 1 } })
  })

  it('accepts chapter_update', async () => {
    await addSubscription('abcd1234', 'c1', 'chapter_update', true)
    expect(prismaMock.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'chapter_update' }) })
  })

  it('increments credits up to the cap of 20', async () => {
    prismaMock.mpSubscription.findUnique.mockResolvedValue({ id: 'sub1', credits: 19 })
    prismaMock.mpSubscription.update.mockResolvedValue({ id: 'sub1', credits: 20 })
    const result = await addSubscription('abcd1234', 'c1', 'work_live', true)
    expect(result.credits).toBe(20)
    expect(prismaMock.mpSubscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { credits: 20 } })
  })

  it('does not exceed the cap', async () => {
    prismaMock.mpSubscription.findUnique.mockResolvedValue({ id: 'sub1', credits: 20 })
    prismaMock.mpSubscription.update.mockResolvedValue({ id: 'sub1', credits: 20 })
    const result = await addSubscription('abcd1234', 'c1', 'work_live', true)
    expect(result.credits).toBe(20)
    expect(prismaMock.mpSubscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { credits: 20 } })
  })

  it('returns current credits without writing when not accepted', async () => {
    prismaMock.mpSubscription.findUnique.mockResolvedValue({ id: 'sub1', credits: 3 })
    const result = await addSubscription('abcd1234', 'c1', 'work_live', false)
    expect(result).toEqual({ credits: 3 })
    expect(prismaMock.mpSubscription.update).not.toHaveBeenCalled()
    expect(prismaMock.mpSubscription.create).not.toHaveBeenCalled()
  })

  it('returns zero credits when not accepted and no row exists', async () => {
    const result = await addSubscription('abcd1234', 'c1', 'work_live', 'accept')
    expect(result).toEqual({ credits: 0 })
  })

  it('rejects an unknown kind before touching the work', async () => {
    await expect(addSubscription('abcd1234', 'c1', 'daily', true)).rejects.toMatchObject({ code: 'MP_VALIDATION', status: 400 })
    expect(workBySlug).not.toHaveBeenCalled()
  })
})
