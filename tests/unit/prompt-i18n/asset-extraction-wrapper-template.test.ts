import { describe, expect, it } from 'vitest'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('FrameOS asset extraction wrapper templates', () => {
  it('registers character extraction with asset-list character wrapper fields', () => {
    for (const locale of ['zh', 'en'] as const) {
      const template = getPromptTemplate(PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE, locale)

      expect(template).toContain('"status"')
      expect(template).toContain('"extraction_status"')
      expect(template).toContain('"has_deprecated_characters"')
      expect(template).toContain('"new_characters"')
      expect(template).toContain('"updated_characters"')
    }
  })

  it('registers environment extraction with asset-list environment wrapper fields', () => {
    for (const locale of ['zh', 'en'] as const) {
      const template = getPromptTemplate(PROMPT_IDS.NP_SELECT_LOCATION, locale)

      expect(template).toContain('"status"')
      expect(template).toContain('"extraction_status"')
      expect(template).toContain('"has_deprecated_environments"')
      expect(template).toContain('"environments"')
      expect(template).toContain('"environment_id"')
    }
  })
})
