import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MentionPromptEditor, type MentionPromptAsset } from '../../src/components/frameos/materials/MentionPromptEditor'
import '../../src/styles/frameos-replica.css'

const assets: MentionPromptAsset[] = [
  { id: 'asset-zhang', name: '张三丰', mediaType: 'image' },
  { id: 'asset-rain', name: '雨夜街巷', mediaType: 'image' },
]

function Fixture() {
  const [value, setValue] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [pasted, setPasted] = useState<string[]>([])
  return (
    <main style={{ padding: 48, maxWidth: 700 }}>
      <MentionPromptEditor
        value={value}
        assets={assets}
        onChange={setValue}
        hint={null}
        onSelectAsset={(asset) => { setSelected((items) => [...items, asset.id || asset.name]) }}
        onPasteMatch={(_value, matched) => { setPasted(matched.map((asset) => asset.id || asset.name)) }}
      />
      <output data-testid="prompt-value">{value}</output>
      <output data-testid="selected-assets">{JSON.stringify(selected)}</output>
      <output data-testid="pasted-assets">{JSON.stringify(pasted)}</output>
      <button type="button" onClick={() => setValue('外部重置 @雨')}>外部重置</button>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
