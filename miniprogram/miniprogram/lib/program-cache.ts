import { sha256 } from './sha256'
import type { ApiError } from './types'

const DIR = `${wx.env.USER_DATA_PATH}/programs`
const MAX_ENTRIES = 5

function manager(): WechatMiniprogram.FileSystemManager {
  return wx.getFileSystemManager()
}

function ensureDir(): void {
  try {
    manager().accessSync(DIR)
  } catch {
    try {
      manager().mkdirSync(DIR, true)
    } catch {
      // 目录创建失败时缓存静默降级为不缓存
    }
  }
}

export function clearProgramCache(): void {
  try {
    manager().rmdirSync(DIR, true)
  } catch {
    // 目录不存在或删除失败时静默，不影响存档
  }
}

export function readCachedProgram(releaseId: string, programHash: string): string | null {
  try {
    const text = manager().readFileSync(`${DIR}/${releaseId}.json`, 'utf8') as string
    return sha256(text) === programHash ? text : null
  } catch {
    return null
  }
}

function prune(): void {
  try {
    const names = manager().readdirSync(DIR) as string[]
    const entries = names.map((name) => {
      let mtime = 0
      try {
        mtime = (manager().statSync(`${DIR}/${name}`) as { lastModifiedTime: number }).lastModifiedTime
      } catch {
        mtime = 0
      }
      return { name, mtime }
    }).sort((a, b) => a.mtime - b.mtime)
    while (entries.length > MAX_ENTRIES) {
      const oldest = entries.shift()
      if (!oldest) break
      try {
        manager().unlinkSync(`${DIR}/${oldest.name}`)
      } catch {
        // 只删本目录下自己写的文件，删不掉就跳过
      }
    }
  } catch {
    // 清理失败不影响播放
  }
}

export function writeCachedProgram(releaseId: string, text: string): void {
  ensureDir()
  try {
    manager().writeFileSync(`${DIR}/${releaseId}.json`, text, 'utf8')
  } catch {
    return
  }
  prune()
}

export function downloadProgram(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      responseType: 'text',
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as string)
        else reject({ code: `HTTP_${res.statusCode}` } as ApiError)
      },
      fail: () => reject({ code: 'NETWORK' } as ApiError),
    })
  })
}

export async function loadProgram(releaseId: string, programHash: string, url: string): Promise<string> {
  const cached = readCachedProgram(releaseId, programHash)
  if (cached) return cached
  const text = await downloadProgram(url)
  if (sha256(text) === programHash) writeCachedProgram(releaseId, text)
  return text
}
