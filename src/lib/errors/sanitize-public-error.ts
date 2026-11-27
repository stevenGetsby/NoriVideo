/** Provider messages can echo signed media URLs or credentials. Keep the
 * actionable HTTP/code/message while hiding secrets before persistence/UI. */
export function sanitizePublicError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      const query = url.indexOf('?')
      return query >= 0 ? `${url.slice(0, query)}?[已隐藏访问参数]` : url
    })
    .replace(/\b(?:kz|hm|sk)-[A-Za-z0-9_-]{12,}/g, '[已隐藏密钥]')
    .replace(/\bkzep_[A-Za-z0-9_-]+/g, '[已隐藏端点]')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [已隐藏令牌]')
    .replace(/(?:KUAIZI|HUIMENGI|TGG|AILINK|TOPENROUTER|OPENLUX):(?:VIDEO|IMAGE|AUDIO):[^\s"'<>]+/gi, '[已隐藏上游任务标识]')
    .replace(/((?:[a-z0-9-]+\.)*)(?:kuaizi\.cn|openlux\.ai|huimengi\.com|tggtoken\.org|jinghua\.security|bytestream\.com\.cn|chinadatapay\.com|deepseek\.com|moonshot\.ai)/gi, '[已隐藏服务地址]')
    .replace(/\b(?:KUAIZI|OPENLUX|HUIMENGI|TGG|AILINK|TOPENROUTER)(?=[_: -]|$)/gi, 'GENERATION_SERVICE')
    .replace(/(?:kuaizi|openlux|huimengi|tgg|ailink|topenrouter)/gi, '生成服务')
    .replace(/(?:筷子科技|筷子|绘梦工坊|绘梦|火山引擎|字节跳动)/g, '生成服务')
    .replace(/\bexternalId\b/g, 'cgtid')
}
