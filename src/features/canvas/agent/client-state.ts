import type { UIMessage } from 'ai'

export const AGENT_SETTINGS_KEY = 'nori-canvas-agent-settings'
export const AGENT_MODEL_KEY = 'nori-canvas-agent-model'
export type CanvasAgentSettings = { autonomy: 'confirm_costly' | 'auto_budget'; budgetPoints: number; follow: boolean }
export const defaultAgentSettings: CanvasAgentSettings = { autonomy: 'confirm_costly', budgetPoints: 100, follow: true }
export function readAgentSettings(raw: string | null): CanvasAgentSettings {
  try {
    const value = JSON.parse(raw || 'null') as Partial<CanvasAgentSettings> | null
    if (!value || !Number.isInteger(value.budgetPoints) || value.budgetPoints! < 10 || value.budgetPoints! > 2000) return { ...defaultAgentSettings }
    return {
      autonomy: value.autonomy === 'auto_budget' ? 'auto_budget' : 'confirm_costly',
      budgetPoints: value.budgetPoints!,
      follow: value.follow !== false,
    }
  } catch { return { ...defaultAgentSettings } }
}

export function selectClientModel(pinned: string, keys: readonly string[], defaultKey: string | null) {
  if (keys.includes(pinned)) return pinned
  return defaultKey && keys.includes(defaultKey) ? defaultKey : keys[0] ?? ''
}

export function sanitizeRestoredMessages(messages: UIMessage[]) {
  let interrupted = false
  const restored = messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part): UIMessage['parts'] => {
      if (part.type === 'reasoning') return []
      if (part.type.startsWith('tool-') && 'state' in part
        && ['input-streaming', 'input-available', 'approval-requested'].includes(part.state ?? '')) {
        interrupted = true
        return [{ ...part, state: 'output-error', errorText: 'STOPPED: 页面关闭，操作未执行' } as UIMessage['parts'][number]]
      }
      return [part]
    }),
  }))
  return { messages: restored, interrupted }
}
