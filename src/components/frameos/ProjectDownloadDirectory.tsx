'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { chooseProjectDownloadDirectory, clearProjectDownloadDirectory, getProjectDownloadDirectory } from '@/lib/media/project-download-directory'

export function ProjectDownloadDirectory({ projectId }: { projectId: string }) {
  const { data: session } = useSession()
  const accountId = session?.user?.id || ''
  const [label, setLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setLabel(null); setError(null)
    if (accountId && projectId) void getProjectDownloadDirectory(accountId, projectId).then((handle) => {
      if (active) setLabel(handle?.name || null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [accountId, projectId])
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-[var(--fos-text-3)]">
    <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" disabled={!accountId || !projectId || busy} onClick={() => {
      // Invoke picker immediately inside the user's click (before any await).
      setBusy(true); setError(null)
      void chooseProjectDownloadDirectory(accountId, projectId).then((handle) => setLabel(handle.name)).catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : '选择目录失败')
      }).finally(() => setBusy(false))
    }}>{label ? '更改本地下载目录' : '设置本地下载目录'}</button>
    {label ? <><span className="max-w-[180px] truncate" title={label}>{label}</span><button type="button" disabled={busy} onClick={() => void clearProjectDownloadDirectory(accountId, projectId).then(() => setLabel(null)).catch(() => setError('清除目录失败'))}>取消固定目录</button></> : null}
    {error ? <p role="alert" className="w-full break-words text-neutral-200">{error}</p> : null}
  </div>
}
