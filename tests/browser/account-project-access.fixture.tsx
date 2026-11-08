import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosAccountManagementClient } from '@/components/frameos/FosAccountManagementClient'
import { FosProjectsClient } from '@/components/frameos/FosProjectsClient'
import { setFixtureSession } from './stubs/next-auth-react'
import '@/styles/frameos-replica.css'

Object.assign(window, { setFixtureSession })
const projects = new URLSearchParams(location.search).get('view') === 'projects'
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    {projects ? <FosProjectsClient /> : <FosAccountManagementClient />}
  </NextIntlClientProvider>,
)
