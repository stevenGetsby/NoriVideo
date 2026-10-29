import { getInternalBaseUrl } from '@/lib/env'

const DEFAULT_TIMEOUT_MS = 60_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function fetchWithTimeoutAndRetry(
  url: string,
  options: RequestInit & {
    timeoutMs?: number
    maxRetries?: number
    logPrefix?: string
  } = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = 3,
    logPrefix: _logPrefix = '[Media fetch]',
    ...fetchOptions
  } = options
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const fullUrl = url.startsWith('/') ? `${getInternalBaseUrl()}${url}` : url
      const response = await fetch(fullUrl, {
        ...fetchOptions,
        signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
      })
      if (response.ok) return response
      const errorText = await response.text()
      if (response.status >= 400 && response.status < 500
        && response.status !== 408 && response.status !== 429) {
        return new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
      lastError = new Error(`HTTP ${response.status}: ${errorText}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(errorMessage(error))
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** (attempt - 1)))
    }
  }
  throw lastError || new Error('媒体下载失败')
}
