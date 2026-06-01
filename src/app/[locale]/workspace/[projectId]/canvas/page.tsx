'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { canvasApi } from '@/features/canvas/api/client'
import { canvasQueryKeys } from '@/features/canvas/state/keys'
import type { Canvas } from '@/features/canvas/types'
import { Link, useRouter } from '@/i18n/navigation'
import Navbar from '@/components/Navbar'
import { AppIcon } from '@/components/ui/icons'

export default function CanvasListPage() {
  const params = useParams<{ projectId?: string }>()
  const t = useTranslations('canvas')
  const tc = useTranslations('common')
  const router = useRouter()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const projectId = params?.projectId ?? ''

  const listKey = canvasQueryKeys.list(projectId)
  const listQuery = useQuery<Canvas[]>({
    queryKey: listKey,
    queryFn: () => canvasApi.list(projectId),
    enabled: Boolean(projectId),
  })

  const createMutation = useMutation({
    mutationFn: () => canvasApi.create(projectId, { title: title.trim() || t('defaultCanvasName') }),
    onSuccess: () => {
      setTitle('')
      qc.invalidateQueries({ queryKey: listKey })
    },
  })

  const productionCanvas = useMemo(() => {
    const canvases = listQuery.data ?? []
    return canvases.find((canvas) => canvas.title === 'Production Canvas') ?? canvases[0] ?? null
  }, [listQuery.data])

  const openProductionMutation = useMutation({
    mutationFn: async () => {
      if (productionCanvas) return productionCanvas
      return await canvasApi.create(projectId, { title: 'Production Canvas', themeColor: '#2563eb' })
    },
    onSuccess: (canvas) => {
      qc.invalidateQueries({ queryKey: listKey })
      router.push({ pathname: `/workspace/${projectId}/canvas/${canvas.id}` })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (canvasId: string) => canvasApi.remove(projectId, canvasId),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  })

  if (!projectId) {
    return <div style={{ padding: 24 }}>{t('missingParams')}</div>
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{t('listTitle')}</h1>
          <Link href={{ pathname: `/workspace/${projectId}` }} style={{ fontSize: 13, color: '#3f3f46' }}>
            ← {t('backToWorkspace')}
          </Link>
        </div>

        <section
          className="glass-surface-elevated"
          style={{
            padding: 24,
            marginBottom: 24,
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <AppIcon name="sparkles" className="w-5 h-5 text-[var(--glass-tone-info-fg)]" />
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{t('productionTitle')}</h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, maxWidth: 720 }}>
              {t('productionDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openProductionMutation.mutate()}
            disabled={openProductionMutation.isPending || listQuery.isLoading}
            className="glass-btn-base glass-btn-primary px-5 py-3 text-sm font-semibold inline-flex items-center gap-2"
            style={{ cursor: openProductionMutation.isPending ? 'wait' : 'pointer' }}
          >
            <AppIcon name="play" className="w-4 h-4" />
            {openProductionMutation.isPending ? tc('loading') : t('openProduction')}
          </button>
        </section>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('newCanvasPlaceholder')}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: createMutation.isPending ? 'wait' : 'pointer',
          }}
        >
          {createMutation.isPending ? tc('loading') : t('newCanvasButton')}
        </button>
      </div>

      {listQuery.isLoading && <p>{tc('loading')}</p>}
      {listQuery.error && <p style={{ color: '#b91c1c' }}>{String(listQuery.error)}</p>}

      {listQuery.data && listQuery.data.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('emptyState')}</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {listQuery.data?.map((c) => (
          <li
            key={c.id}
            style={{
              padding: '12px 16px',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Link
              href={`/workspace/${projectId}/canvas/${c.id}`}
              style={{ flex: 1, color: '#111827', textDecoration: 'none', fontWeight: 500 }}
            >
              {c.title}
            </Link>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              {new Date(c.updatedAt).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => {
                if (confirm(t('confirmDelete', { title: c.title }))) {
                  deleteMutation.mutate(c.id)
                }
              }}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {tc('delete')}
            </button>
          </li>
        ))}
      </ul>
      </main>
    </div>
  )
}
