import { describe, expect, it } from 'vitest'
import { renderAssistantSystemPrompt } from '@/lib/assistant-platform/system-prompts'

describe('assistant-platform system prompts', () => {
  it('loads tutorial prompt from lib/prompts/skills', () => {
    const prompt = renderAssistantSystemPrompt('tutorial')

    expect(prompt).toContain('你是产品教程助手')
    expect(prompt).toContain('禁止编造不存在的页面')
  })

  it('loads the English tutorial prompt for English requests', () => {
    const prompt = renderAssistantSystemPrompt('tutorial', { locale: 'en' })

    expect(prompt).toContain('You are the product tutorial assistant')
    expect(prompt).toContain('Never invent pages')
  })
})
