import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTextEntryTarget } from '@/features/canvas/context-menu-target'

type Stub = { tagName: string; type?: string; isContentEditable?: boolean; parentElement?: Stub | null }

const el = (tagName: string, extra: Partial<Stub> = {}): Stub => ({ tagName, parentElement: null, ...extra })

describe('isTextEntryTarget', () => {
  it('treats textareas and text-like inputs as text entry', () => {
    expect(isTextEntryTarget(el('TEXTAREA'))).toBe(true)
    expect(isTextEntryTarget(el('textarea'))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'search' }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT'))).toBe(true)
  })

  it('ignores buttons, checkboxes and other non-typing inputs', () => {
    for (const type of ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit']) {
      expect(isTextEntryTarget(el('INPUT', { type }))).toBe(false)
    }
    expect(isTextEntryTarget(el('BUTTON'))).toBe(false)
    expect(isTextEntryTarget(el('DIV'))).toBe(false)
  })

  it('treats contenteditable hosts and their non-editable children (mention chips) as text entry', () => {
    const host = el('DIV', { isContentEditable: true })
    const chip = el('SPAN', { isContentEditable: false, parentElement: host })
    expect(isTextEntryTarget(host)).toBe(true)
    expect(isTextEntryTarget(chip)).toBe(true)
  })

  it('does not treat plain node surfaces as text entry', () => {
    const node = el('DIV', { parentElement: el('DIV', { parentElement: el('MAIN') }) })
    expect(isTextEntryTarget(node)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(undefined)).toBe(false)
    expect(isTextEntryTarget({})).toBe(false)
  })
})

describe('canvas context menu keeps text editing intact', () => {
  const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
  const start = graph.indexOf('onContextMenuCapture={(event) => {')
  const handler = graph.slice(start, graph.indexOf('onDoubleClick=', start))

  it('lets right-clicks inside editors fall through to the native menu without blurring them', () => {
    expect(start).toBeGreaterThan(0)
    const guard = handler.indexOf('isTextEntryTarget(target)')
    const prevent = handler.indexOf('event.preventDefault()')
    expect(guard).toBeGreaterThan(-1)
    expect(prevent).toBeGreaterThan(guard)
    const guardBlock = handler.slice(guard, prevent)
    expect(guardBlock).toContain('event.stopPropagation()')
    expect(guardBlock).toContain('return')
    expect(guardBlock).not.toContain('preventDefault')
  })
})
