import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosToolbox } from '../../src/components/frameos/views/FosToolbox'
import '../../src/styles/frameos-replica.css'

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    <main className="fos-app" style={{ overflow: 'hidden' }}><FosToolbox /></main>
  </NextIntlClientProvider>,
)
