import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectDownloadDirectoryKey, writeProjectDownload, chooseProjectDownloadDirectory, type DownloadDirectoryHandle } from '@/lib/media/project-download-directory'

afterEach(() => vi.unstubAllGlobals())
function memoryDirectory() {
  const files = new Map<string, Blob>()
  const handle: DownloadDirectoryHandle = {
    name: '测试目录',
    getFileHandle: async (name, options) => {
      if (!files.has(name) && !options?.create) throw new DOMException('not found', 'NotFoundError')
      if (!files.has(name)) files.set(name, new Blob())
      return { createWritable: async () => ({ write: async (blob) => { files.set(name, blob) }, close: async () => {} }) }
    },
  }
  return { files, handle }
}
describe('per-member project download directories', () => {
  it('isolates directory keys for different members and projects', () => {
    expect(projectDownloadDirectoryKey('user-a', 'project-1')).not.toBe(projectDownloadDirectoryKey('user-b', 'project-1'))
    expect(projectDownloadDirectoryKey('user-a', 'project-1')).not.toBe(projectDownloadDirectoryKey('user-a', 'project-2'))
    expect(() => projectDownloadDirectoryKey('', 'project-1')).toThrow()
  })
  it('does not overwrite existing files even during concurrent repeated downloads', async () => {
    vi.stubGlobal('navigator', {})
    const { files, handle } = memoryDirectory()
    const blob = new Blob(['new'])
    files.set('机甲三国_测试_视频001_马俊.mp4', new Blob(['original']))
    const names = await Promise.all([writeProjectDownload(handle, '机甲三国_测试_视频001_马俊.mp4', blob), writeProjectDownload(handle, '机甲三国_测试_视频001_马俊.mp4', blob)])
    expect(new Set(names).size).toBe(2)
    expect(await files.get('机甲三国_测试_视频001_马俊.mp4')!.text()).toBe('original')
    expect(names).toEqual(['机甲三国_测试_视频001_马俊 (2).mp4', '机甲三国_测试_视频001_马俊 (3).mp4'])
  })
  it('rejects paths and insecure/unsupported directory picker environments', async () => {
    const { handle } = memoryDirectory()
    await expect(writeProjectDownload(handle, '../test.mp4', new Blob())).rejects.toThrow('文件名无效')
    vi.stubGlobal('window', { isSecureContext: false })
    await expect(chooseProjectDownloadDirectory('user', 'project')).rejects.toThrow('HTTPS')
  })
})
