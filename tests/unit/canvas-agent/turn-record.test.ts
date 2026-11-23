import { expect, it } from 'vitest'
import { createCanvasAgentTurnController } from '@/features/canvas/agent/turn-record'
import { createCanvasHistoryStack } from '@/features/canvas/state/canvas-history-stack'

const snapshot = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }

it('coalesces multiple writes into one undo entry and never swallows a manual change between tools', async () => {
  const stack = createCanvasHistoryStack()
  const turn = createCanvasAgentTurnController()
  const record = (label: string) => turn.record(label, (next) => stack.record(next, snapshot), stack.getDepth, stack.getHead)
  turn.begin('帮我做分镜')
  await turn.run(() => { record('添加节点'); record('连线'); record('分组'); record('提交生成') })
  expect(stack.getDepth()).toBe(1)
  expect(stack.getLastLabel()).toBe('喵导：帮我做分镜')
  record('用户移动节点')
  expect(stack.getDepth()).toBe(2)
  expect(stack.getLastLabel()).toBe('用户移动节点')
  await turn.run(() => { record('修改节点'); record('调整参数') })
  expect(stack.getDepth()).toBe(3)
  const receipt = turn.end()!
  expect(turn.canUndo(receipt, stack, false)).toBe(true)
  expect(turn.canUndo(receipt, stack, true)).toBe(false)
  expect(turn.canUndo({ ...receipt, ended: false }, stack, false)).toBe(false)
  expect(turn.canUndo({ ...receipt, recorded: false }, stack, false)).toBe(false)
  expect(turn.canUndo({ ...receipt, historyDepth: 2 }, stack, false)).toBe(false)
  record('新手动改动')
  expect(turn.canUndo(receipt, stack, false)).toBe(false)
})

it('checks the actual history entry even when the capped stack depth and label are identical', async () => {
  const stack = createCanvasHistoryStack(1)
  const turn = createCanvasAgentTurnController()
  turn.begin('重复标签')
  await turn.run(() => turn.record('修改', (next) => stack.record(next, snapshot), stack.getDepth, stack.getHead))
  const receipt = turn.end()!
  stack.record(receipt.label, snapshot)
  expect(turn.canUndo(receipt, stack, false)).toBe(false)
})
