import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import SignIn from '../../src/app/[locale]/auth/signin/page'
import SignUp from '../../src/app/[locale]/auth/signup/page'
import zh from '../../messages/zh/auth.json'
import en from '../../messages/en/auth.json'

const params = new URLSearchParams(location.search)
const locale = params.get('lang') === 'en' ? 'en' : 'zh'
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale={locale} messages={{ auth: locale === 'en' ? en : zh }} timeZone="Asia/Shanghai">
    {params.get('signup') === '1' ? <SignUp /> : <SignIn />}
  </NextIntlClientProvider>,
)
