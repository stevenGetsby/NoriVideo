import type { CanvasAgentTurnState } from './bridge-types'
import { CanvasAgentToolError } from './tool-error'

type HistoryReading = { getDepth(): number; getLastLabel(): string | null; getHead(): symbol | null }
type ActiveTurn = CanvasAgentTurnState & { executing: number }

export function createCanvasAgentTurnController() {
  let current: ActiveTurn | null = null
  return {
    begin(text: string) {
      if (current) throw new CanvasAgentToolError('CANVAS_LOCKED')
      current = {
        label: `喵导：${text.replace(/\s+/gu, ' ').trim().slice(0, 24) || '整理画布'}`,
        executing: 0, recorded: false, historyDepth: null, historyToken: null, ended: false,
      }
    },
    end(): CanvasAgentTurnState | null {
      if (!current) return null
      const { label, recorded, historyDepth, historyToken } = current
      current = null
      return { label, recorded, historyDepth, historyToken, ended: true }
    },
    async run<T>(task: () => T | Promise<T>): Promise<T> {
      const turn = current
      if (!turn) throw new CanvasAgentToolError('STOPPED')
      turn.executing += 1
      try { return await task() } finally { turn.executing -= 1 }
    },
    labelFor(label: string) {
      return current && current.executing > 0 ? current.label : label
    },
    isExecuting: () => Boolean(current && current.executing > 0),
    record(label: string, write: (label: string) => void, getDepth: () => number, getHead: () => symbol | null) {
      if (current && current.executing > 0) {
        if (current.recorded && current.historyToken === getHead()) return
        write(current.label)
        current.recorded = true
        current.historyDepth = getDepth()
        current.historyToken = getHead()
        return
      }
      if (current) current.recorded = false
      write(label)
    },
    canUndo(receipt: CanvasAgentTurnState, history: HistoryReading, locked: boolean) {
      return receipt.ended && receipt.recorded && !locked && !current && receipt.historyDepth === history.getDepth()
        && receipt.label === history.getLastLabel() && receipt.historyToken !== null && receipt.historyToken === history.getHead()
    },
  }
}
