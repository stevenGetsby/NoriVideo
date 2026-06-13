import { StorageConfigError } from '@/lib/storage/errors'
import { LocalStorageProvider } from '@/lib/storage/providers/local'
import { MinioStorageProvider } from '@/lib/storage/providers/minio'
import { CosStorageProvider } from '@/lib/storage/providers/cos'
import { TosStorageProvider } from '@/lib/storage/providers/tos'
import type { StorageFactoryOptions, StorageProvider, StorageType } from '@/lib/storage/types'
import { isTestModeEnabled } from '@/lib/test-mode'

function normalizeStorageType(rawType: string | undefined): StorageType {
  const normalized = (rawType || 'minio').trim().toLowerCase()
  if (normalized === 'minio' || normalized === 'local' || normalized === 'cos' || normalized === 'tos') {
    return normalized
  }
  throw new StorageConfigError(`Unsupported STORAGE_TYPE: ${rawType}`)
}

export function createStorageProvider(options: StorageFactoryOptions = {}): StorageProvider {
  const defaultStorageType = process.env.STORAGE_TYPE || (isTestModeEnabled() ? 'local' : undefined)
  const type = normalizeStorageType(options.storageType || defaultStorageType)

  if (type === 'minio') {
    return new MinioStorageProvider()
  }
  if (type === 'local') {
    return new LocalStorageProvider()
  }
  if (type === 'tos') {
    return new TosStorageProvider()
  }

  return new CosStorageProvider()
}
