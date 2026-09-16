import { ApiError } from '@/lib/api-errors'

const FORM_DATA_PARSE_FAILURE = /failed to parse body as formdata/i

/**
 * 读取 multipart 表单时为 Next.js 中间件造成的截断给出可读错误。
 *
 * 中间件会把请求体克隆一份交给 Edge 运行时，克隆长度受
 * `experimental.middlewareClientMaxBodySize` 限制；超出上限的部分会被静默丢弃，
 * 最终在 `request.formData()` 处抛出 undici 的 "Failed to parse body as FormData."。
 * 这条错误对用户没有任何指导意义，因此在读取入口统一转换成明确的提示。
 */
export async function readRequestFormData(
  request: Request,
  options: { fileSizeLabel: string },
): Promise<FormData> {
  try {
    return await request.formData()
  } catch (error) {
    if (error instanceof TypeError && FORM_DATA_PARSE_FAILURE.test(error.message)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'UPLOAD_BODY_INCOMPLETE',
        message: `上传请求体未能完整接收，通常是文件过大或网络中断。单个文件上限为 ${options.fileSizeLabel}，请压缩后重试。`,
      })
    }
    throw error
  }
}
