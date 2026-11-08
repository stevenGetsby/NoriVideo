import { StorageProviderNotImplementedError } from '@/lib/storage/errors'
import type { DeleteObjectsResult, SignedUrlParams, StorageProvider, UploadObjectParams, UploadObjectResult } from '@/lib/storage/types'

export class CosStorageProvider implements StorageProvider {
  readonly kind = 'cos' as const

  constructor() {
    throw new StorageProviderNotImplementedError('cos')
  }

  async uploadObject(_params: UploadObjectParams): Promise<UploadObjectResult> {
    void _params
    throw new StorageProviderNotImplementedError('cos')
  }

  async deleteObject(_key: string): Promise<void> {
    void _key
    throw new StorageProviderNotImplementedError('cos')
  }

  async deleteObjects(_keys: string[]): Promise<DeleteObjectsResult> {
    void _keys
    throw new StorageProviderNotImplementedError('cos')
  }

  async getSignedObjectUrl(_params: SignedUrlParams): Promise<string> {
    void _params
    throw new StorageProviderNotImplementedError('cos')
  }

  async getObjectBuffer(_key: string): Promise<Buffer> {
    void _key
    throw new StorageProviderNotImplementedError('cos')
  }

  extractStorageKey(_input: string | null | undefined): string | null {
    void _input
    throw new StorageProviderNotImplementedError('cos')
  }

  toFetchableUrl(_inputUrl: string): string {
    void _inputUrl
    throw new StorageProviderNotImplementedError('cos')
  }

  generateUniqueKey(_params: { prefix: string; ext: string }): string {
    void _params
    throw new StorageProviderNotImplementedError('cos')
  }
}
