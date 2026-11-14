import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eraser } from '@/components/ui/icons'
import { clearMarks, setHighlight, toggleBold } from '../text-marks'
import type { CanvasTextHighlight, CanvasTextMark } from '../types'

const colors: CanvasTextHighlight[] = ['yellow', 'green', 'pink', 'blue']
const labels = { yellow: '黄色高亮', green: '绿色高亮', pink: '粉色高亮', blue: '蓝色高亮' }

export default function TextMarkBar({ target, selection, marks, onChange }: {
  target: HTMLTextAreaElement
  selection: { start: number; end: number }
  marks: CanvasTextMark[]
  onChange: (marks: CanvasTextMark[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect()
        const width = ref.current?.offsetWidth || 230
        setPosition({ left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + (rect.width - width) / 2)), top: Math.max(8, rect.top - 44) })
      })
    }
    update()
    document.addEventListener('selectionchange', update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', update); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [target])
  const active = marks.filter((mark) => mark.end > selection.start && mark.start < selection.end)
  const bold = active.length > 0 && active.every((mark) => mark.bold)
  const label = navigator.platform.toLowerCase().includes('mac') ? '加粗（⌘B）' : '加粗（Ctrl+B）'
  const act = (callback: () => void) => { callback(); target.focus({ preventScroll: true }); target.setSelectionRange(selection.start, selection.end) }
  return createPortal(<div ref={ref} className="nori-text-mark-bar fos-viewport-theme nodrag" style={position}>
    <button type="button" aria-label={label} title={label} aria-pressed={bold} onMouseDown={(event) => event.preventDefault()} onClick={() => act(() => onChange(toggleBold(marks, selection.start, selection.end)))}>B</button>
    <i />
    {colors.map((color) => <button key={color} type="button" className={`nori-text-mark-color hl-${color}`} aria-label={labels[color]} title={labels[color]} aria-pressed={active.length > 0 && active.every((mark) => mark.highlight === color)} onMouseDown={(event) => event.preventDefault()} onClick={() => act(() => onChange(setHighlight(marks, selection.start, selection.end, color)))}><span /></button>)}
    <i />
    <button type="button" aria-label="清除标注" title="清除标注" onMouseDown={(event) => event.preventDefault()} onClick={() => act(() => onChange(clearMarks(marks, selection.start, selection.end)))}><Eraser size={16} /></button>
  </div>, document.body)
}
