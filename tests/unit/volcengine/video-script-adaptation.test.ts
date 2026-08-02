import { describe, expect, it, vi } from 'vitest'
import {
  adaptVideoScriptWithArk,
  buildVideoScriptAdaptationInput,
} from '@/lib/volcengine/video-script-adaptation'

describe('video script adaptation', () => {
  it('returns the source script without invoking a text model when the brief is empty', async () => {
    const invoke = vi.fn()
    const result = await adaptVideoScriptWithArk({
      apiKey: '',
      sourceScript: '第1集\n\n1-1\n场景：柴房 - 夜',
      adaptationBrief: '   ',
      invoke,
    })

    expect(result).toEqual({
      script: '第1集\n\n1-1\n场景：柴房 - 夜',
      mode: 'source_copy',
      model: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('combines source, contract, and user requirements for the Ark text model', async () => {
    const invoke = vi.fn(async () => ({
      text: '```text\n第1集《The Debt》\n\n1-1\n场景：Warehouse - Night\n```',
      reasoning: '',
      usage: { promptTokens: 120, completionTokens: 45 },
      raw: {},
    }))
    const result = await adaptVideoScriptWithArk({
      apiKey: 'test-key',
      sourceScript: '第1集\n\n1-1\n场景：柴房 - 夜',
      adaptationBrief: '改为北美当代背景，使用英文对白',
      adaptationContract: { story_invariants: ['主角被困'] },
      model: 'doubao-test',
      invoke,
    })

    expect(result.script).toContain('The Debt')
    expect(result.mode).toBe('llm')
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 45 })
    const call = (invoke.mock.calls as unknown as Array<[{ input: unknown }]>)[0]?.[0]
    expect(JSON.stringify(call?.input)).toContain('改为北美当代背景')
    expect(JSON.stringify(call?.input)).toContain('主角被困')
    expect(JSON.stringify(call?.input)).toContain('场景：柴房')
  })

  it('labels source, contract, and brief as separate inputs', () => {
    const input = buildVideoScriptAdaptationInput({
      sourceScript: '原剧本',
      adaptationBrief: '转绘要求',
      adaptationContract: { do_not_localize: ['证据链'] },
    })
    expect(input).toContain('用户转绘需求：\n转绘要求')
    expect(input).toContain('adaptation_contract')
    expect(input).toContain('<source_script>\n原剧本\n</source_script>')
  })
})
