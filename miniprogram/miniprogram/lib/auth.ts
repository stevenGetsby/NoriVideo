import { API_BASE } from '../config'
import { wxStorage } from './storage'
import type { ApiError, LoginResponse, MpMe } from './types'

const TOKEN_KEY = 'mp.token'
const EXP_KEY = 'mp.token.exp'
const USER_KEY = 'mp.user'

export function getToken(): string | null {
  return wxStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  wxStorage.setItem(TOKEN_KEY, token)
}

export function getUser(): MpMe | null {
  const raw = wxStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as MpMe
  } catch {
    return null
  }
}

export function setUser(user: MpMe): void {
  wxStorage.setItem(USER_KEY, JSON.stringify(user))
}

function isTimeline(): boolean {
  try {
    return wx.getLaunchOptionsSync().scene === 1154
  } catch {
    return false
  }
}

function tokenValid(): boolean {
  const token = wxStorage.getItem(TOKEN_KEY)
  const exp = wxStorage.getItem(EXP_KEY)
  if (!token || !exp) return false
  const t = Date.parse(exp)
  return Number.isFinite(t) && t - Date.now() > 60000
}

let pending: Promise<MpMe> | null = null

function login(): Promise<MpMe> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject({ code: 'NETWORK' } as ApiError)
          return
        }
        const launch = wx.getLaunchOptionsSync()
        wx.request({
          url: `${API_BASE}/api/mp/auth/login`,
          method: 'POST',
          data: { code: res.code, launch: { scene: launch.scene, path: launch.path, query: launch.query } },
          header: { 'content-type': 'application/json' },
          timeout: 10000,
          success: (r) => {
            if (r.statusCode >= 200 && r.statusCode < 300) {
              const data = r.data as LoginResponse
              wxStorage.setItem(TOKEN_KEY, data.token)
              wxStorage.setItem(EXP_KEY, data.expiresAt)
              wxStorage.setItem(USER_KEY, JSON.stringify(data.user))
              resolve(data.user)
            } else {
              const err = (r.data as { error?: { code?: string; message?: string } })?.error
              reject({ code: err?.code || 'MP_UNAUTHORIZED', message: err?.message, status: r.statusCode } as ApiError)
            }
          },
          fail: () => reject({ code: 'NETWORK' } as ApiError),
        })
      },
      fail: () => reject({ code: 'NETWORK' } as ApiError),
    })
  })
}

export function ensureLogin(): Promise<MpMe> {
  if (isTimeline()) return Promise.reject({ code: 'MP_TIMELINE' } as ApiError)
  if (tokenValid()) {
    const user = getUser()
    if (user) return Promise.resolve(user)
  }
  if (!pending) pending = login().finally(() => { pending = null })
  return pending
}

export function relogin(): Promise<MpMe> {
  wxStorage.removeItem(TOKEN_KEY)
  wxStorage.removeItem(EXP_KEY)
  if (!pending) pending = login().finally(() => { pending = null })
  return pending
}

export function logout(): void {
  wxStorage.removeItem(TOKEN_KEY)
  wxStorage.removeItem(EXP_KEY)
  wxStorage.removeItem(USER_KEY)
}
