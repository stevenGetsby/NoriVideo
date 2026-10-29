import { describe, expect, it } from 'vitest'
import { storyErrorMessage } from '@/features/interactive/story-api-error'

const reply = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })

describe('story api error copy', () => {
  it('hides server internals but keeps validation messages', async () => {
    expect(await storyErrorMessage(reply(500, 'Invalid `prisma.work.findMany()` invocation'), '加载影游失败')).toBe('加载影游失败：服务暂时不可用，请稍后重试')
    expect(await storyErrorMessage(reply(400, '影游名称不能为空'), '创建影游失败')).toBe('影游名称不能为空')
  })
})
