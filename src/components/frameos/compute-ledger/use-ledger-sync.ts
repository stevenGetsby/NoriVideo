/**
 * 「正在补齐历史」自动重取：complete===false 时每 2 秒重取当前面板，最多 20 次，
 * 之后停止并置 exhausted（外壳改提示「请稍后点立即刷新」）。卸载 / complete 变化必清定时器。
 */
import { useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 20

export function useLedgerSync(complete: boolean | undefined, reload: () => void): { exhausted: boolean } {
  const [exhausted, setExhausted] = useState(false)
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    if (complete !== false) {
      setExhausted(false)
      return
    }
    let count = 0
    const timer = window.setInterval(() => {
      count += 1
      if (count >= MAX_POLLS) {
        window.clearInterval(timer)
        setExhausted(true)
        return
      }
      reloadRef.current()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [complete])

  return { exhausted }
}
