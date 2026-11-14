'use client'

import { useEffect, useState } from 'react'

const DISMISS_KEY_PREFIX = 'nori-engine-notice-dismissed-'

export function OldBrowserNotice() {
  const [engineVersion, setEngineVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const v = document.documentElement.dataset.engineVersion
    if (!v) return
    setEngineVersion(v)
    if (v !== '0' && typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem(DISMISS_KEY_PREFIX + v) === '1') setDismissed(true)
      } catch {}
    }
  }, [])

  if (!engineVersion || dismissed) return null

  const isIE = engineVersion === '0'

  const dismiss = () => {
    if (isIE) return
    try {
      window.localStorage.setItem(DISMISS_KEY_PREFIX + engineVersion, '1')
    } catch {}
    setDismissed(true)
  }

  return (
    <div className="nori-old-browser-notice" role="status">
      <div className="nori-old-browser-notice-text">
        {isIE
          ? '当前浏览器无法使用画布。请改用最新版 Chrome 或 Edge。'
          : `当前浏览器内核较旧（Chrome ${engineVersion}），已自动按 100% 比例显示，以保证画布框选和拖拽准确。升级到最新版 Chrome 或 Edge 可获得完整体验；如果使用 360、QQ 等浏览器，请切换到「极速模式」并更新内核。`}
      </div>
      {!isIE ? (
        <button type="button" className="nori-old-browser-notice-dismiss" onClick={dismiss}>
          我知道了
        </button>
      ) : null}
    </div>
  )
}
