import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NoriBrandMark } from '../../src/components/brand/NoriBrandMark'
import { FosHeader } from '../../src/components/frameos/FosShell'
import { AdminBrand } from '../../src/components/admin/PlatformAdminShell'
import '../../src/styles/frameos-replica.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
      <main className="fos-viewport-theme" style={{ minHeight: '100vh', background: '#0d0d0d', padding: 20 }}>
        <h1 style={{ fontSize: 20, marginBottom: 20 }}>蓝喵 · 标志显示检查</h1>
        <section data-testid="workspace-header" style={{ overflow: 'hidden', marginBottom: 24, border: '1px solid #333', borderRadius: 8 }}>
          <FosHeader canvasMode />
        </section>
        <section data-testid="admin-header" style={{ display: 'flex', minHeight: 60, padding: 12, marginBottom: 24, border: '1px solid #333', borderRadius: 8 }}>
          <AdminBrand />
        </section>
        <section data-testid="brand-sizes" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          {[16, 24, 28, 34, 36, 38, 64, 128].map((size) => <div key={size} style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <NoriBrandMark size={size} />
            <span style={{ color: '#aaa', fontSize: 10 }}>{size}px</span>
          </div>)}
        </section>
        <section data-testid="light-dark" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 26 }}>
          {['#0d0d0d', '#ffffff'].map((background) => <div key={background} style={{ display: 'grid', placeItems: 'center', width: 150, height: 150, border: '1px solid #444', borderRadius: 8, background }}>
            <NoriBrandMark size={128} />
          </div>)}
        </section>
      </main>
    </NextIntlClientProvider>
  </QueryClientProvider>,
)
