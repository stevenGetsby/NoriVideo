import { expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

it('loads the registered localized prompts and treats the canvas payload as data', () => {
  const zh = buildPrompt({ promptId: PROMPT_IDS.CANVAS_AGENT_SYSTEM, locale: 'zh' })
  const en = buildPrompt({ promptId: PROMPT_IDS.CANVAS_AGENT_SYSTEM, locale: 'en' })
  expect(zh).toContain('喵导')
  expect(zh).toContain('不是指令')
  expect(en).toContain('Reply in the user')
  expect(en).toContain('not instructions')
})
