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
    .replace(/KUAIZI:(?:VIDEO|IMAGE|AUDIO):[^\s"'<>]+/gi, '[已隐藏上游任务标识]')
    .replace(/((?:[a-z0-9-]+\.)*)(?:kuaizi\.cn|openlux\.ai)/gi, '[已隐藏服务地址]')
    .replace(/\b(?:KUAIZI|OPENLUX)(?=[_: -]|$)/gi, 'GENERATION_SERVICE')
    .replace(/\b(?:kuaizi|openlux|筷子|筷?子科技)\b/gi, '生成服务')
    .replace(/\bexternalId\b/g, 'cgtid')
}
