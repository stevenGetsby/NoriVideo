'use client'

import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import Navbar from '@/components/Navbar'

// CanvasGraph 依赖浏览器 API（ResizeObserver 等），仅在客户端渲染。
const CanvasGraph = dynamic(() => import('@/features/canvas/CanvasGraph'), {
  ssr: false,
  loading: () => <div style={{ padding: 24 }}>Loading canvas…</div>,
})

export default function CanvasDetailPage() {
  const params = useParams<{ projectId?: string; canvasId?: string }>()
  const t = useTranslations('canvas')

  if (!params?.projectId || !params?.canvasId) {
    return <div style={{ padding: 24 }}>{t('missingParams')}</div>
  }

  const { projectId, canvasId } = params

  return (
    <div className="glass-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Navbar />
      <header
        style={{
          padding: '10px 18px',
          borderBottom: '1px solid rgba(148,163,184,0.28)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(255,255,255,0.76)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <Link
          href={{ pathname: `/workspace/${projectId}`, query: { stage: 'storyboard' } }}
          style={{ fontSize: 13, color: '#334155', textDecoration: 'none', fontWeight: 700 }}
        >
          ← {t('backToWorkspace')}
        </Link>
        <span style={{ color: '#9ca3af' }}>/</span>
        <Link
          href={{ pathname: `/workspace/${projectId}/canvas` }}
          style={{ fontSize: 13, color: '#475569', textDecoration: 'none' }}
        >
          {t('listTitle')}
        </Link>
        <span style={{ color: '#9ca3af' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>{t('canvasIdLabel')}: {canvasId}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{t('hintProduction')}</span>
      </header>
      <div style={{ flex: 1, position: 'relative' }}>
        <CanvasGraph projectId={projectId} canvasId={canvasId} />
      </div>
    </div>
  )
}
