import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import SignIn from '../../src/app/[locale]/auth/signin/page'
import SignUp from '../../src/app/[locale]/auth/signup/page'
import zh from '../../messages/zh/auth.json'
import en from '../../messages/en/auth.json'
import { LanmiaoHome } from '../../src/components/home/LanmiaoHome'

const params = new URLSearchParams(location.search)
const locale = params.get('lang') === 'en' ? 'en' : 'zh'
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale={locale} messages={{ auth: locale === 'en' ? en : zh }} timeZone="Asia/Shanghai">
    {params.get('home') === '1' ? <LanmiaoHome locale={locale} icp={params.get('icp') === '0' ? null : '测试备案号-1'} /> : params.get('signup') === '1' ? <SignUp /> : <SignIn />}
  </NextIntlClientProvider>,
)
