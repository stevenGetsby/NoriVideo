import { ApiError, type ApiErrorCode } from '@/lib/api-errors'

// MP_* codes live outside the closed UnifiedErrorCode catalog; apiHandler
// passes ApiError subclasses through untouched, so the overridden code/status
// reach the response as-is.
const MP_ERROR_SPECS = {
  MP_VALIDATION: { status: 400, base: 'INVALID_PARAMS', message: '输入内容不符合要求' },
  MP_UNAUTHORIZED: { status: 401, base: 'UNAUTHORIZED', message: '请先登录' },
  MP_USER_BANNED: { status: 403, base: 'FORBIDDEN', message: '账号已被封禁' },
  MP_WORK_NOT_FOUND: { status: 404, base: 'NOT_FOUND', message: '作品不存在或已下架' },
  MP_PAYLOAD_TOO_LARGE: { status: 413, base: 'INVALID_PARAMS', message: '存档体积超过上限' },
  MP_CONTENT_RISKY: { status: 422, base: 'SENSITIVE_CONTENT', message: '内容含有违规信息，请修改后重试' },
  MP_PREFLIGHT_FAILED: { status: 422, base: 'INVALID_PARAMS', message: '发布前检查未通过' },
  MP_RELEASE_IN_PROGRESS: { status: 409, base: 'CONFLICT', message: '已有一个版本在生成或审核中' },
  MP_INVALID_STATE: { status: 409, base: 'CONFLICT', message: '当前状态不能执行此操作' },
  MP_NOT_PLAYABLE: { status: 409, base: 'CONFLICT', message: '作品尚未上线，暂不可游玩' },
  MP_RATE_LIMITED: { status: 429, base: 'RATE_LIMIT', message: '操作过于频繁，请稍后再试' },
  MP_WX_UNAVAILABLE: { status: 502, base: 'EXTERNAL_ERROR', message: '微信服务暂时不可用，请稍后重试' },
  MP_DY_UNAVAILABLE: { status: 502, base: 'EXTERNAL_ERROR', message: '抖音服务暂时不可用，请稍后重试' },
  MP_CDN_NOT_CONFIGURED: { status: 503, base: 'MISSING_CONFIG', message: '媒体服务未配置' },
} as const satisfies Record<string, { status: number; base: ApiErrorCode; message: string }>

export type MpErrorCode = keyof typeof MP_ERROR_SPECS

export class MpApiError extends ApiError {
  constructor(code: MpErrorCode, details?: Record<string, unknown>) {
    const spec = MP_ERROR_SPECS[code]
    super(spec.base, { message: spec.message, ...details })
    this.name = 'MpApiError'
    this.code = code as unknown as ApiErrorCode
    this.status = spec.status
  }
}
