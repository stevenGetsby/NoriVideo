/** Provider messages can echo signed media URLs or credentials. Keep the
 * actionable HTTP/code/message while hiding secrets before persistence/UI. */
export function sanitizePublicError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      const query = url.indexOf('?')
      return query >= 0 ? `${url.slice(0, query)}?[已隐藏访问参数]` : url
    })
    .replace(/\bkz-[A-Za-z0-9_-]{12,}/g, '[已隐藏密钥]')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [已隐藏令牌]')
}
