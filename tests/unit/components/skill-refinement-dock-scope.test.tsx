// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowSkillDTO } from '@/lib/batch-workflow/types'

vi.mock('@/components/ui/icons', () => ({ AppIcon: () => null }))
vi.mock('@/lib/api-fetch', () => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/ui/feedback', () => ({ confirmAction: vi.fn(async () => true) }))

import { SkillRefinementDock } from '@/components/batch-workflow/SkillRefinementDock'
import { apiFetch } from '@/lib/api-fetch'

function skill(id: string): WorkflowSkillDTO {
  return {
    id, name: id, slug: id, version: 1, stage: 'script_analysis', track: 'short_drama',
    isBuiltin: false, systemPrompt: 'prompt', fewShotExamples: [], qcRules: null, modelPreferences: null,
  } as unknown as WorkflowSkillDTO
}

describe('SkillRefinementDock request scope', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(apiFetch).mockImplementation(async (url) => String(url).includes('/refine')
      ? Response.json({ proposal: { nextSystemPrompt: 'new prompt', nextFewShotExamples: [], nextQcRules: null, nextName: 'new', changeNote: '', changeSummary: [], nextModelPreferences: null } })
      : Response.json({ trialOutput: { beats: [] } }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  function render(itemId: string, itemRevision: number | undefined, skillId = 'skill-1') {
    root.render(<SkillRefinementDock
      open stage="script_analysis" currentSkill={skill(skillId)} allStageSkills={[skill(skillId)]}
      runId="run-1" itemId={itemId} itemRevision={itemRevision} stageOutput={{}}
      trialActive={false} onClose={vi.fn()} onTrialResult={vi.fn()} onDiscardTrial={vi.fn()}
      onSkillSaved={vi.fn()} onSwitchSkill={vi.fn()} onNotify={vi.fn()}
    />)
  }

  it('sends the supplied expectedRevision and preserves legacy behavior when omitted', async () => {
    await act(async () => render('item-1', 7))
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('切镜更细'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '仅出方案')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const trialButton = () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('锁上游试跑对比'))!
    await act(async () => trialButton().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const trialCalls = () => vi.mocked(apiFetch).mock.calls.filter(([url]) => String(url).includes('/trial'))
    expect(JSON.parse(String(trialCalls()[0][1]?.body)).expectedRevision).toBe(7)
    await act(async () => render('item-1', undefined))
    await act(async () => trialButton().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect('expectedRevision' in JSON.parse(String(trialCalls()[1][1]?.body))).toBe(false)
  })

  it('resets selected shot and cost confirmation when item or skill changes', async () => {
    await act(async () => root.render(<SkillRefinementDock
      open stage="video_gen" currentSkill={skill('skill-1')} allStageSkills={[skill('skill-1')]}
      runId="run-1" itemId="item-1" stageOutput={{}} trialShotOptions={[{ shotId: 'shot-1', label: '镜头 1' }]}
      onRealTrial={vi.fn()} trialActive={false} onClose={vi.fn()} onTrialResult={vi.fn()}
      onDiscardTrial={vi.fn()} onSkillSaved={vi.fn()} onSwitchSkill={vi.fn()} onNotify={vi.fn()}
    />))
    const select = container.querySelector('select')!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(select, 'shot-1')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(select.value).toBe('shot-1')
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(checkbox.checked).toBe(true)
    await act(async () => root.render(<SkillRefinementDock
      open stage="video_gen" currentSkill={skill('skill-2')} allStageSkills={[skill('skill-2')]}
      runId="run-1" itemId="item-2" stageOutput={{}} trialShotOptions={[{ shotId: 'shot-1', label: '镜头 1' }]}
      onRealTrial={vi.fn()} trialActive={false} onClose={vi.fn()} onTrialResult={vi.fn()}
      onDiscardTrial={vi.fn()} onSkillSaved={vi.fn()} onSwitchSkill={vi.fn()} onNotify={vi.fn()}
    />))
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('')
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
  })
})
