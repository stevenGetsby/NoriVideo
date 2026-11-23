import { expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { readAgentSettings, selectClientModel, sanitizeRestoredMessages } from '@/features/canvas/agent/client-state'

it('never replays unfinished tools when restoring a thread', () => {
  const messages = [{ id: 'm', role: 'assistant', parts: [
    { type: 'tool-build_graph', toolCallId: 'stale', state: 'input-available', input: {} },
    { type: 'tool-arrange', toolCallId: 'complete', state: 'output-available', input: {}, output: { status: 'done' } },
  ] }] as UIMessage[]
  const result = sanitizeRestoredMessages(messages)
  expect(result.interrupted).toBe(true)
  expect(result.messages[0].parts[0]).toMatchObject({ state: 'output-error', errorText: 'STOPPED: 页面关闭，操作未执行' })
  expect(result.messages[0].parts[1]).toBe(messages[0].parts[1])
  expect(messages[0].parts[0]).toMatchObject({ state: 'input-available' })
})

it('uses only advertised keys and defaults to confirmation on corrupt storage', () => {
  expect(selectClientModel('removed', ['a', 'b'], 'b')).toBe('b')
  expect(selectClientModel('a', ['a', 'b'], 'b')).toBe('a')
  expect(selectClientModel('a', [], null)).toBe('')
  expect(readAgentSettings('{bad json').autonomy).toBe('confirm_costly')
  expect(readAgentSettings('{"autonomy":"auto_budget","budgetPoints":-1}').autonomy).toBe('confirm_costly')
})
