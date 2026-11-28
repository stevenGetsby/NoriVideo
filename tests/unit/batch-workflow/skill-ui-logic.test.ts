import { describe, expect, it } from 'vitest'
import {
  buildSkillMetaPatch,
  buildSkillPublishPatch,
  diffModelPreferences,
  flattenDryRunParams,
  isSkillSummaryOnly,
  sortQcViolations,
  validateRealTrialRequest,
} from '@/components/batch-workflow/stages/_helpers'
import type { WorkflowQcReport } from '@/lib/batch-workflow/types'

describe('Skill Library/Dock pure logic', () => {
  describe('isSkillSummaryOnly', () => {
    it('treats missing systemPrompt as summary-only', () => {
      expect(isSkillSummaryOnly({ systemPrompt: undefined })).toBe(true)
      expect(isSkillSummaryOnly({ systemPrompt: null })).toBe(true)
      expect(isSkillSummaryOnly({})).toBe(true)
    })
    it('treats a string systemPrompt (even empty) as full content', () => {
      expect(isSkillSummaryOnly({ systemPrompt: '' })).toBe(false)
      expect(isSkillSummaryOnly({ systemPrompt: '你是…' })).toBe(false)
    })
    it('tolerates null/undefined skill', () => {
      expect(isSkillSummaryOnly(null)).toBe(false)
      expect(isSkillSummaryOnly(undefined)).toBe(false)
    })
  })

  describe('buildSkillMetaPatch', () => {
    it('never includes content fields (systemPrompt/fewShotExamples/qcRules/modelPreferences)', () => {
      const out = buildSkillMetaPatch({
        name: '  新名字 ',
        description: '更新描述',
        isDefault: true,
        changeNote: '元信息微调',
      })
      expect(out).toEqual({ name: '新名字', description: '更新描述', isDefault: true, changeNote: '元信息微调' })
      expect(out).not.toHaveProperty('systemPrompt')
      expect(out).not.toHaveProperty('fewShotExamples')
      expect(out).not.toHaveProperty('qcRules')
      expect(out).not.toHaveProperty('modelPreferences')
      expect(out).not.toHaveProperty('saveAsNewVersion')
    })
    it('drops empty changeNote', () => {
      const out = buildSkillMetaPatch({ name: 'n', description: null, isDefault: false, changeNote: '   ' })
      expect(out).toEqual({ name: 'n', description: null, isDefault: false })
    })
  })

  describe('buildSkillPublishPatch', () => {
    it('always sets saveAsNewVersion: true and includes content fields', () => {
      const out = buildSkillPublishPatch({
        name: '派生',
        description: null,
        isDefault: false,
        systemPrompt: '  提示词  ',
        fewShotExamples: [],
        qcRules: null,
        changeNote: 'v2',
      })
      expect(out.saveAsNewVersion).toBe(true)
      expect(out.systemPrompt).toBe('提示词')
      expect(out.fewShotExamples).toEqual([])
      expect(out.qcRules).toBeNull()
      expect(out.changeNote).toBe('v2')
    })
    it('omits modelPreferences when undefined so the backend inherits', () => {
      const out = buildSkillPublishPatch({
        name: 'x', description: null, isDefault: false,
        systemPrompt: 's', fewShotExamples: [], qcRules: null,
      })
      expect(out).not.toHaveProperty('modelPreferences')
    })
  })

  describe('validateRealTrialRequest', () => {
    it('rejects when confirmCost is false', () => {
      expect(validateRealTrialRequest({ confirmCost: false, shotId: 's1' })).toContain('确认消耗视频额度')
    })
    it('rejects when shotId is missing', () => {
      expect(validateRealTrialRequest({ confirmCost: true, shotId: '' })).toContain('shotId')
      expect(validateRealTrialRequest({ confirmCost: true, shotId: null })).toContain('shotId')
      expect(validateRealTrialRequest({ confirmCost: true, shotId: '   ' })).toContain('shotId')
    })
    it('passes only when both are present', () => {
      expect(validateRealTrialRequest({ confirmCost: true, shotId: 'shot-42' })).toBeNull()
    })
  })

  describe('flattenDryRunParams', () => {
    it('returns an empty list for non-object outputs', () => {
      expect(flattenDryRunParams(null)).toEqual([])
      expect(flattenDryRunParams('str')).toEqual([])
      expect(flattenDryRunParams(42)).toEqual([])
      expect(flattenDryRunParams(undefined)).toEqual([])
    })
    it('flattens top-level fields and skips the dryRun marker', () => {
      const out = flattenDryRunParams({ dryRun: true, modelKey: 'seedance2.0', durationSec: 6, generateAudio: false })
      expect(out).toEqual([
        { key: 'durationSec', value: '6' },
        { key: 'generateAudio', value: '否' },
        { key: 'modelKey', value: 'seedance2.0' },
      ])
    })
    it('prefers a nested params bag when present', () => {
      const out = flattenDryRunParams({ dryRun: true, params: { modelKey: 'kling', aspectRatio: '9:16' } })
      expect(out).toEqual([
        { key: 'aspectRatio', value: '9:16' },
        { key: 'modelKey', value: 'kling' },
      ])
    })
    it('serializes objects and tolerates undefined/null values', () => {
      const out = flattenDryRunParams({
        dryRun: true,
        params: { nested: { a: 1 }, undef: undefined, nul: null },
      })
      const keys = out.map((r) => r.key).sort()
      expect(keys).toEqual(['nested', 'nul', 'undef'])
      expect(out.find((r) => r.key === 'nested')?.value).toBe('{"a":1}')
      expect(out.find((r) => r.key === 'undef')?.value).toBe('（未设置）')
      expect(out.find((r) => r.key === 'nul')?.value).toBe('null')
    })
  })

  describe('diffModelPreferences', () => {
    it('returns an empty list when both are null/undefined', () => {
      expect(diffModelPreferences(null, null)).toEqual([])
      expect(diffModelPreferences(undefined, undefined)).toEqual([])
    })
    it('lists each changed key with before/after', () => {
      const out = diffModelPreferences(
        { videoModelKey: 'kling-v1', durationSeconds: 5 },
        { videoModelKey: 'kling-v2', durationSeconds: 5, aspectRatio: '9:16' },
      )
      const keys = out.map((d) => d.key).sort()
      expect(keys).toEqual(['aspectRatio', 'videoModelKey'])
      const video = out.find((d) => d.key === 'videoModelKey')!
      expect(video.before).toBe('kling-v1')
      expect(video.after).toBe('kling-v2')
      const ratio = out.find((d) => d.key === 'aspectRatio')!
      expect(ratio.before).toBe('（未设置）')
      expect(ratio.after).toBe('9:16')
    })
    it('treats booleans readably', () => {
      const out = diffModelPreferences({ generateAudio: false }, { generateAudio: true })
      expect(out).toHaveLength(1)
      expect(out[0].before).toBe('关')
      expect(out[0].after).toBe('开')
    })
  })

  describe('sortQcViolations', () => {
    const qc: WorkflowQcReport = {
      status: 'failed',
      violations: [
        { rule: 'maxChars', message: '超过最大字数', path: 'beats[1].dialogue' },
        { rule: 'minShots', message: '镜头数不足', path: 'beats' },
        { rule: 'requiredKeywords', message: '缺少关键词', path: 'beats[0].sceneHeading' },
      ],
      retryCount: 1,
      checkedAt: '2026-01-01T00:00:00Z',
    }

    it('returns every violation with rule/message/path intact', () => {
      const out = sortQcViolations(qc)
      expect(out).toHaveLength(3)
      const allKeys = out.flatMap((v) => [v.rule, v.message, v.path])
      expect(allKeys).toContain('maxChars')
      expect(allKeys).toContain('beats[1].dialogue')
      expect(allKeys).toContain('缺少关键词')
    })
    it('sorts deterministically by path then rule', () => {
      const out = sortQcViolations(qc)
      expect(out.map((v) => v.path)).toEqual(['beats', 'beats[0].sceneHeading', 'beats[1].dialogue'])
    })
    it('tolerates a missing or null report', () => {
      expect(sortQcViolations(null)).toEqual([])
      expect(sortQcViolations(undefined)).toEqual([])
      expect(sortQcViolations({ ...qc, violations: undefined as unknown as [] })).toEqual([])
    })
  })
})
