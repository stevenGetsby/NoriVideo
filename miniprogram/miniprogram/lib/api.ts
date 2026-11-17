import { API_BASE } from '../config'
import { getToken, relogin, setToken } from './auth'
import type { ApiError } from './types'

export type AuthMode = 'required' | 'optional' | 'none'
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface RequestOptions {
  auth?: AuthMode
}

export function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  return send<T>(method, path, body, opts.auth ?? 'optional', true)
}

function send<T>(method: Method, path: string, body: unknown, auth: AuthMode, retry: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const header: Record<string, string> = { 'content-type': 'application/json' }
    if (auth !== 'none') {
      const token = getToken()
      if (token) header.Authorization = `Bearer ${token}`
    }
    wx.request({
      url: API_BASE + path,
      // wx.request 运行时支持 PATCH，社区 typings 的 method 联合漏了它。
      method: method as WechatMiniprogram.RequestOption['method'],
      data: body as Record<string, unknown>,
      header,
      timeout: 10000,
      success: (res) => {
        const headers = res.header as Record<string, string>
        const renewed = headers['X-Mp-Token'] || headers['x-mp-token']
        if (renewed) setToken(renewed)
        if (res.statusCode === 401 && auth === 'required' && retry) {
          relogin().then(() => send<T>(method, path, body, auth, false)).then(resolve, reject)
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
          return
        }
        const err = (res.data as { error?: { code?: string; message?: string; details?: unknown } })?.error
        reject({
          code: err?.code || `HTTP_${res.statusCode}`,
          message: err?.message,
          status: res.statusCode,
          details: err?.details,
        } as ApiError)
      },
      fail: () => reject({ code: 'NETWORK' } as ApiError),
    })
  })
}
