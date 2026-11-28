import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecipeSummaryPopover } from '@/components/batch-workflow/RecipeSummaryPopover'
import type { WorkflowSkillDTO } from '@/lib/batch-workflow/types'

vi.mock('@/components/ui/viewport-popover', () => ({
  ViewportPopover: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
}))

function renderSummary(skill: Partial<WorkflowSkillDTO> | null) {
  return renderToStaticMarkup(createElement(RecipeSummaryPopover, {
    skill: skill as WorkflowSkillDTO | null,
    anchorRef: { current: null },
    onClose: () => {},
  }))
}

describe('RecipeSummaryPopover (read-only for non-admin accounts)', () => {
  it('shows only name, version, description, change note and updated time', () => {
    const html = renderSummary({
      name: '剧本解析配方',
      version: 4,
      description: '用于解析参考视频剧本',
      changeNote: '收紧对白长度',
      updatedAt: '2026-11-20T08:00:00.000Z',
      isBuiltin: true,
    })
    expect(html).toContain('剧本解析配方 v4')
    expect(html).toContain('内置配方')
    expect(html).toContain('用于解析参考视频剧本')
    expect(html).toContain('收紧对白长度')
    expect(html).toContain('更新时间')
  })

  it('never renders prompt, few-shot examples or QC rules even if present on the object', () => {
    const html = renderSummary({
      name: '洗稿配方',
      version: 2,
      description: '用途说明',
      changeNote: 'note',
      updatedAt: '2026-11-20T08:00:00.000Z',
      systemPrompt: 'SECRET-SYSTEM-PROMPT',
      fewShotExamples: [{ input: 'SECRET-FEWSHOT', output: 'x' }],
      qcRules: { requiredKeywords: ['SECRET-QC'] },
    } as Partial<WorkflowSkillDTO>)
    expect(html).not.toContain('SECRET-SYSTEM-PROMPT')
    expect(html).not.toContain('SECRET-FEWSHOT')
    expect(html).not.toContain('SECRET-QC')
  })

  it('shows an empty state when the stage has no bound recipe', () => {
    expect(renderSummary(null)).toContain('当前阶段尚未绑定配方')
  })
})
