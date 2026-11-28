import { describe, expect, it } from 'vitest'
import {
  assertNormalizedWorkflowArtifact,
  assertStrictWorkflowArtifact,
  buildQcCorrectionPrompt,
  evaluateWorkflowQuality,
  WORKFLOW_MAX_SHOTS,
} from '@/lib/batch-workflow/quality'

const shot = { shotId: 's1', videoPrompt: '推近', visualDescription: '人物出现', durationSec: 5, referencedAssetIds: ['asset-1'] }

describe('workflow quality rules', () => {
  it('passes when length, count and keyword rules all match', () => {
    const report = evaluateWorkflowQuality({
      stage: 'storyboard',
      artifact: { shots: [shot] },
      qcRules: { maxChars: 1000, minShots: 1, maxShots: 2, requiredKeywords: ['推近'], forbiddenKeywords: ['水印'] },
      retryCount: 1,
      checkedAt: new Date('2026-11-28T00:00:00.000Z'),
    })
    expect(report).toEqual({ status: 'passed', violations: [], retryCount: 1, checkedAt: '2026-11-28T00:00:00.000Z' })
  })

  it('reports maxChars and minShots with stable collection paths', () => {
    const report = evaluateWorkflowQuality({
      stage: 'script_rewrite',
      artifact: { fullScriptText: '过长', scenes: [] },
      qcRules: { maxChars: 1, minShots: 2 },
    })
    expect(report.status).toBe('failed')
    expect(report.violations.map((entry) => [entry.rule, entry.path])).toEqual([
      ['maxChars', 'scenes'], ['minShots', 'scenes'],
    ])
  })

  it('reports maxShots and missing required keywords', () => {
    const report = evaluateWorkflowQuality({
      stage: 'storyboard', artifact: { shots: [shot, shot] },
      qcRules: { maxShots: 1, requiredKeywords: ['必须出现'] },
    })
    expect(report.violations.map((entry) => entry.rule)).toEqual(['maxShots', 'requiredKeywords'])
    expect(buildQcCorrectionPrompt(report)).toContain('maxShots')
    expect(buildQcCorrectionPrompt(report)).toContain('shots')
  })

  it('matches required and forbidden keywords case-insensitively', () => {
    const report = evaluateWorkflowQuality({
      stage: 'script_analysis', artifact: { fullScriptText: 'Launch', beats: [] },
      qcRules: { requiredKeywords: ['launch'], forbiddenKeywords: ['LAUNCH'] },
    })
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0].rule).toBe('forbiddenKeywords')
  })

  it('uses edited S1 text and never treats checklist prose as a machine failure', () => {
    const report = evaluateWorkflowQuality({
      stage: 'script_analysis',
      artifact: { fullScriptText: '禁用原文', editedScriptText: '已修正文本', beats: [] },
      qcRules: { forbiddenKeywords: ['禁用'], checklist: ['这段自然语言不应参与自动判定'] },
    })
    expect(report.status).toBe('passed')
    expect(report.violations).toEqual([])
  })
})

describe('strict and normalized workflow artifacts', () => {
  it('rejects empty or truncated S2/S3/S4 collections', () => {
    expect(() => assertStrictWorkflowArtifact('script_rewrite', { scenes: [] })).toThrow('非空 scenes')
    expect(() => assertStrictWorkflowArtifact('asset_extraction', { items: [{ id: 'a', kind: 'prop', name: '杯' }] })).toThrow('imagePrompt')
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: [] })).toThrow('可能已被截断')
  })

  it('rejects duplicate IDs and excessive shots', () => {
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: [shot, shot] }, ['asset-1'])).toThrow('shotId 重复')
    const tooMany = Array.from({ length: WORKFLOW_MAX_SHOTS + 1 }, (_, index) => ({ ...shot, shotId: `s${index}` }))
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: tooMany }, ['asset-1'])).toThrow('超过上限')
  })

  it('rejects invalid duration, unknown asset references and missing required shot text', () => {
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: [{ ...shot, durationSec: 0 }] }, ['asset-1'])).toThrow('durationSec 非法')
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: [{ ...shot, referencedAssetIds: ['missing'] }] }, ['asset-1'])).toThrow('非法资产')
    expect(() => assertStrictWorkflowArtifact('storyboard', { shots: [{ ...shot, videoPrompt: '' }] }, ['asset-1'])).toThrow('videoPrompt')
  })

  it('validates normalized artifacts after JSON repair instead of trusting repair success', () => {
    expect(() => assertNormalizedWorkflowArtifact('storyboard', { shots: [shot] }, [])).toThrow('不存在的资产')
    expect(() => assertNormalizedWorkflowArtifact('storyboard', { shots: [{ ...shot, referencedAssetIds: [] }] }, ['asset-1'])).not.toThrow()
    expect(() => assertNormalizedWorkflowArtifact('script_rewrite', {
      scenes: [{ sceneIndex: 1, durationSec: 5, visualAction: 'x' }, { sceneIndex: 1, durationSec: 5, visualAction: 'y' }],
    })).toThrow('sceneIndex 重复')
  })
})
