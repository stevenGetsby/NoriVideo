export type PasteDecision = 'insert-text' | 'paste-nodes' | 'default'

export function resolvePasteDecision(input: {
  soleSelectedTextNodeId: string | null
  readOnly: boolean
  systemText: string
  systemHasFiles: boolean
  internalClipboardIsLatest: boolean
}): PasteDecision {
  if (!input.soleSelectedTextNodeId || input.readOnly || input.systemHasFiles) return 'default'
  if (input.internalClipboardIsLatest) return 'paste-nodes'
  return input.systemText ? 'insert-text' : 'default'
}
