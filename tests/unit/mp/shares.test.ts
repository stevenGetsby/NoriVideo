import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpShare: { findUnique: vi.fn(), create: vi.fn() },
  mpWork: { findUnique: vi.fn() },
}))
const workBySlug = vi.hoisted(() => vi.fn())
const storageMock = vi.hoisted(() => ({ getObjectBuffer: vi.fn(), uploadObject: vi.fn() }))
const cdnMock = vi.hoisted(() => ({ mpMediaUrl: vi.fn() }))
const wxMock = vi.hoisted(() => ({ getUnlimitedWxacode: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/mp/catalog', () => ({ workBySlug }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/storage/cdn', () => cdnMock)
vi.mock('@/lib/mp/wx', () => wxMock)

import { registerShare, shareWxacode } from '@/lib/mp/shares'

const WORK = { id: 'mpw1', slug: 'abcd1234', status: 'live' }
const ID = 'Ab3dEf9hIj'
const KEY = `mp/wxacode/s/${ID}.png`

beforeEach(() => {
  vi.clearAllMocks()
  workBySlug.mockResolvedValue({ ...WORK })
  prismaMock.mpShare.findUnique.mockResolvedValue(null)
  prismaMock.mpShare.create.mockResolvedValue({ id: ID })
  prismaMock.mpWork.findUnique.mockResolvedValue({ slug: 'abcd1234' })
  storageMock.getObjectBuffer.mockRejectedValue(new Error('missing'))
  storageMock.uploadObject.mockResolvedValue(undefined)
  cdnMock.mpMediaUrl.mockImplementation(async (key: string) => `https://cdn.example/${key}`)
  wxMock.getUnlimitedWxacode.mockResolvedValue(Buffer.from('png'))
})

describe('registerShare', () => {
  it('creates a share row for the work', async () => {
    const result = await registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'ending', endingNodeId: 'n1' })
    expect(result).toEqual({ ok: true })
    expect(prismaMock.mpShare.create).toHaveBeenCalledWith({
      data: { id: ID, consumerId: 'c1', mpWorkId: 'mpw1', kind: 'ending', endingNodeId: 'n1' },
    })
  })

  it('accepts all four kinds and defaults endingNodeId to null', async () => {
    for (const kind of ['work', 'ending', 'timeline', 'poster']) {
      await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind })).resolves.toEqual({ ok: true })
    }
    expect(prismaMock.mpShare.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'work', endingNodeId: null }),
    })
  })

  it('is idempotent when the id already belongs to the caller', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c1' })
    await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'work' })).resolves.toEqual({ ok: true })
    expect(prismaMock.mpShare.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the id belongs to someone else', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c2' })
    await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'work' })).rejects.toMatchObject({ code: 'MP_INVALID_STATE', status: 409 })
  })

  it('rejects malformed ids and unknown kinds before touching the work', async () => {
    await expect(registerShare('c1', { id: 'short', slug: 'abcd1234', kind: 'work' })).rejects.toMatchObject({ code: 'MP_VALIDATION', status: 400 })
    await expect(registerShare('c1', { id: 'Ab3dEf9hI!', slug: 'abcd1234', kind: 'work' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'topic' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(workBySlug).not.toHaveBeenCalled()
  })

  it('tolerates a concurrent create that lands on the caller', async () => {
    prismaMock.mpShare.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.0.0' }))
    prismaMock.mpShare.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ consumerId: 'c1' })
    await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'work' })).resolves.toEqual({ ok: true })
  })

  it('returns 409 when a concurrent create lands on someone else', async () => {
    prismaMock.mpShare.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.0.0' }))
    prismaMock.mpShare.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ consumerId: 'c2' })
    await expect(registerShare('c1', { id: ID, slug: 'abcd1234', kind: 'work' })).rejects.toMatchObject({ code: 'MP_INVALID_STATE', status: 409 })
  })
})

describe('shareWxacode', () => {
  it('generates, uploads and returns the CDN url', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c1', mpWorkId: 'mpw1' })
    const result = await shareWxacode('c1', ID)
    expect(wxMock.getUnlimitedWxacode).toHaveBeenCalledWith(`s=${ID}&w=abcd1234`, 'pages/work/index')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(Buffer.from('png'), KEY, undefined, 'image/png')
    expect(result).toEqual({ url: `https://cdn.example/${KEY}` })
  })

  it('reuses the stored PNG without calling WeChat again', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c1', mpWorkId: 'mpw1' })
    storageMock.getObjectBuffer.mockResolvedValue(Buffer.from('png'))
    const result = await shareWxacode('c1', ID)
    expect(wxMock.getUnlimitedWxacode).not.toHaveBeenCalled()
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(result).toEqual({ url: `https://cdn.example/${KEY}` })
  })

  it('rejects ids that are missing or owned by someone else', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue(null)
    await expect(shareWxacode('c1', ID)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c2', mpWorkId: 'mpw1' })
    await expect(shareWxacode('c1', ID)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(wxMock.getUnlimitedWxacode).not.toHaveBeenCalled()
  })

  it('rejects malformed ids', async () => {
    await expect(shareWxacode('c1', 'nope')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(prismaMock.mpShare.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the work row is gone', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ consumerId: 'c1', mpWorkId: 'mpw1' })
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(shareWxacode('c1', ID)).rejects.toMatchObject({ code: 'MP_WORK_NOT_FOUND', status: 404 })
  })
})
