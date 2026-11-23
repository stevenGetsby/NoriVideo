'use client'

import { useEffect, useState } from 'react'
import { FosShell } from './FosShell'
import { FosAssetLibrary } from './views/FosAssetLibrary'
import { FosMaterialLibrary } from './views/FosMaterialLibrary'

type AssetHubView = 'materials' | 'assets'

const VIEWS: Array<{ key: AssetHubView; label: string }> = [
  { key: 'materials', label: '素材文件' },
  { key: 'assets', label: '角色 · 场景 · 道具' },
]

export function FosAssetHubClient() {
  const [view, setView] = useState<AssetHubView>('materials')

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('view')
    if (param === 'assets' || param === 'materials') setView(param)
  }, [])

  const selectView = (next: AssetHubView) => {
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'materials') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    window.history.replaceState(window.history.state, '', url)
  }

  return (
    <FosShell activeKey="assetHub">
      <div className="flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-5 py-2" role="tablist" aria-label="资产库视图">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className="h-8 rounded-lg px-3 text-[12px] font-bold"
            style={{
              background: view === item.key ? 'var(--nori-asset-tab-active-bg)' : 'transparent',
              color: view === item.key ? 'var(--nori-asset-tab-active-text)' : 'var(--fos-text-2)',
            }}
            onClick={() => selectView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {view === 'materials' ? <FosMaterialLibrary /> : <FosAssetLibrary />}
    </FosShell>
  )
}
