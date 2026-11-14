import { describe, expect, it } from 'vitest'
import { resolvePasteDecision } from '@/features/canvas/paste-target'

describe('resolvePasteDecision', () => {
  const input = { soleSelectedTextNodeId: 'text-1', readOnly: false, systemText: 'hello', systemHasFiles: false, internalClipboardIsLatest: false }
  it('inserts text into the only selected text node', () => expect(resolvePasteDecision(input)).toBe('insert-text'))
  it('preserves canvas copy-and-paste when the internal clipboard is latest', () => expect(resolvePasteDecision({ ...input, internalClipboardIsLatest: true })).toBe('paste-nodes'))
  it('does not intercept media pastes', () => expect(resolvePasteDecision({ ...input, systemHasFiles: true })).toBe('default'))
  it('requires a sole selected text node', () => expect(resolvePasteDecision({ ...input, soleSelectedTextNodeId: null })).toBe('default'))
  it('respects read-only mode', () => expect(resolvePasteDecision({ ...input, readOnly: true })).toBe('default'))
  it('ignores empty system text', () => expect(resolvePasteDecision({ ...input, systemText: '' })).toBe('default'))
})
