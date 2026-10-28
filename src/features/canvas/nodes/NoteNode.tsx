'use client'

import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

export type NoteNodeData = {
  text?: string
  onChangeText?: (text: string) => void
}

function NoteNodeImpl({ data, selected }: NodeProps) {
  const noteData = data as NoteNodeData
  const [text, setText] = useState<string>(noteData?.text ?? '')

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      setText(next)
      noteData?.onChangeText?.(next)
    },
    [noteData]
  )

  return (
    <div
      style={{
        width: 220,
        minHeight: 120,
        padding: 12,
        borderRadius: 12,
        background: '#fafafa',
        border: selected ? '2px solid #b1b1b1' : '1px solid #d1d1d1',
        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'grab',
      }}
      className="nori-canvas-note"
    >
      <Handle type="target" position={Position.Top} style={{ background: '#b1b1b1' }} />
      <textarea
        value={text}
        onChange={handleChange}
        placeholder="Note..."
        rows={4}
        className="nodrag"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          resize: 'none',
          outline: 'none',
          fontSize: 13,
          color: '#404040',
          fontFamily: 'inherit',
        }}
      />
      <Handle type="source" position={Position.Bottom} style={{ background: '#b1b1b1' }} />
    </div>
  )
}

export const NoteNode = memo(NoteNodeImpl)
NoteNode.displayName = 'NoteNode'
