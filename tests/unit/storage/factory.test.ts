import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorageProvider } from '@/lib/storage/factory'
import { StorageConfigError, StorageProviderNotImplementedError } from '@/lib/storage/errors'
// These provider unit tests explicitly opt out of the fixed application
// config; no running app, bucket or credentials are changed.
vi.mock('@/lib/service-config', () => ({ getServiceStorageConfig: vi.fn(() => undefined) }))

describe('storage factory', () => {
  afterEach(() => {
    delete process.env.NORI_TEST_MODE
    delete process.env.NEXT_PUBLIC_NORI_TEST_MODE
    delete process.env.STORAGE_TYPE
  })

  it('creates local provider when STORAGE_TYPE=local', () => {
    const provider = createStorageProvider({ storageType: 'local' })
    expect(provider.kind).toBe('local')
  })

  it('uses local storage by default in test mode', () => {
    process.env.NORI_TEST_MODE = 'true'
    delete process.env.STORAGE_TYPE

    const provider = createStorageProvider()

    expect(provider.kind).toBe('local')
  })

  it('creates minio provider when STORAGE_TYPE=minio', () => {
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000'
    process.env.MINIO_REGION = 'us-east-1'
    process.env.MINIO_BUCKET = 'nori'
    process.env.MINIO_ACCESS_KEY = 'minioadmin'
    process.env.MINIO_SECRET_KEY = 'minioadmin'
    process.env.MINIO_FORCE_PATH_STYLE = 'true'

    const provider = createStorageProvider({ storageType: 'minio' })
    expect(provider.kind).toBe('minio')
  })

  it('throws explicit not-implemented error when STORAGE_TYPE=cos', () => {
    expect(() => createStorageProvider({ storageType: 'cos' })).toThrow(StorageProviderNotImplementedError)
  })

  it('throws config error on unknown storage type', () => {
    expect(() => createStorageProvider({ storageType: 'unknown' })).toThrow(StorageConfigError)
  })
})
