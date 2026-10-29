import { readApiErrorMessage } from '@/lib/api/read-error-message'

// 5xx bodies can carry raw database/driver output; only our own 4xx validation copy is user-facing.
export async function storyErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status >= 500) return `${fallback}：服务暂时不可用，请稍后重试`
  return await readApiErrorMessage(response, fallback)
}
