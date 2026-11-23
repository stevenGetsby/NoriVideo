import { expect, it } from 'vitest'
import { capThreadMessages, canvasAgentThreadTitle } from '@/lib/canvas-agent/thread-content'

const message = (role: 'user' | 'assistant', text: string) => ({ role, parts: [{ type: 'text', text }] })

it('keeps at most the newest 200 messages and starts at a user turn', () => {
  const messages = Array.from({ length: 202 }, (_, index) => message(index % 3 ? 'assistant' : 'user', `message-${index}`))
  expect(capThreadMessages(messages)).toEqual(messages.slice(3))
})

it('caps UTF-8 bytes without saving an orphaned assistant result', () => {
  const early = message('user', '历史')
  const oversized = message('assistant', '喵'.repeat(550_000))
  const latest = [message('user', '本轮'), message('assistant', '已完成')]
  expect(capThreadMessages([early, oversized, ...latest])).toEqual(latest)
  expect(capThreadMessages([early, oversized])).toEqual([])
})

it('derives titles from the first user text without exposing assistant/tool output', () => {
  expect(canvasAgentThreadTitle([message('assistant', '不要显示'), message('user', '  新片\n分镜  ')]))
    .toBe('新片 分镜')
  expect(canvasAgentThreadTitle([message('assistant', '不要显示')])).toBe('新对话')
})
