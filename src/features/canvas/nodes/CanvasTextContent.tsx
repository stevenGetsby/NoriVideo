'use client'

import { useEffect, useRef, useState } from 'react'
import { useCanvasEditor } from '../CanvasEditorContext'
import TextMarkBar from '../components/TextMarkBar'
import { marksEqual, normalizeMarks, rebaseMarks, setHighlight, splitByMarks, toggleBold } from '../text-marks'
import type { CanvasTextMark } from '../types'

function MarkedText({ text, marks }: { text: string; marks?: CanvasTextMark[] }) {
  return <>{splitByMarks(text, marks).map((segment, index) => <span key={index} className={`nori-text-mark${segment.bold ? ' is-bold' : ''}${segment.highlight ? ` hl-${segment.highlight}` : ''}`}>{segment.text}</span>)}</>
}

export default function CanvasTextContent({ id, value, marks, readOnly }: { id: string; value: string; marks?: CanvasTextMark[]; readOnly: boolean }) {
  const editor = useCanvasEditor()
  const [draft, setDraft] = useState(value)
  const [draftMarks, setDraftMarks] = useState(() => normalizeMarks(marks, value.length))
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const editing = editor.textEditingNodeId === id
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (editing) return
    setDraft(value)
    setDraftMarks(normalizeMarks(marks, value.length))
  }, [editing, marks, value])
  useEffect(() => {
    const preview = previewRef.current
    const edit = () => { if (!readOnly) editor.setTextEditing(id) }
    preview?.addEventListener('nori:edit-text', edit)
    return () => preview?.removeEventListener('nori:edit-text', edit)
  }, [id, readOnly, editor])
  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.focus({ preventScroll: true })
    ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
    setSelection({ start: ref.current.value.length, end: ref.current.value.length })
  }, [editing])

  const save = () => {
    editor.setTextEditing(null)
    if (draft !== value || !marksEqual(draftMarks, normalizeMarks(marks, value.length))) editor.updateNodeData(id, { text: draft, textMarks: draftMarks }, draft === value ? '标注文本' : '编辑文本')
  }
  const select = () => { if (ref.current) setSelection({ start: ref.current.selectionStart, end: ref.current.selectionEnd }) }
  const apply = (next: CanvasTextMark[]) => { setDraftMarks(normalizeMarks(next, draft.length)); select() }

  if (editing && !readOnly) {
    return <>
      <div className="nori-canvas-text-editor-wrap">
        {draftMarks.length > 0 ? <div ref={mirrorRef} className="nori-canvas-text-mirror" aria-hidden><MarkedText text={draft} marks={draftMarks} />{'​'}</div> : null}
        <textarea
          ref={ref}
          className={`nodrag nowheel nori-canvas-text-editor${draftMarks.length > 0 ? ' has-marks' : ''}`}
          value={draft}
          onChange={(event) => { setDraftMarks(rebaseMarks(draftMarks, draft, event.target.value)); setDraft(event.target.value) }}
          onBlur={save}
          onSelect={select}
          onKeyUp={select}
          onMouseUp={select}
          onScroll={() => { if (mirrorRef.current && ref.current) mirrorRef.current.scrollTop = ref.current.scrollTop }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setDraft(value); setDraftMarks(normalizeMarks(marks, value.length)); editor.setTextEditing(null) }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
            if (selection.start === selection.end) return
            if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); event.stopPropagation(); apply(toggleBold(draftMarks, selection.start, selection.end)) }
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'h') { event.preventDefault(); event.stopPropagation(); apply(setHighlight(draftMarks, selection.start, selection.end, 'yellow')) }
          }}
        />
      </div>
      {ref.current && selection.start < selection.end ? <TextMarkBar target={ref.current} selection={selection} marks={draftMarks} onChange={apply} /> : null}
    </>
  }
  return (
    <button ref={previewRef} type="button" className="nori-canvas-text-preview" onDoubleClick={() => !readOnly && editor.setTextEditing(id)}>
      {value.trim() ? <MarkedText text={value} marks={marks} /> : <span>（双击编辑文本）</span>}
    </button>
  )
}
