'use client'

import { useState } from 'react'
import { getSession, signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { FosAuthShell } from '@/components/frameos/FosAuthShell'
import { Link } from '@/i18n/navigation'
import { SURFACE_LOGIN_ERRORS } from '@/lib/app-surface'

export default function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const locale = useLocale()
  const t = useTranslations('auth')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        username: username.trim(),
        password,
        redirect: false,
      })

      if ((result?.status || 0) >= 500) {
        setError('登录服务暂时异常，请稍后重试；账号密码未必有误。')
      } else if (result?.error === 'RateLimited') {
        setError(t('rateLimited'))
      } else if (result?.error === SURFACE_LOGIN_ERRORS.adminRequired) {
        setError('账号密码正确，但平台 Admin 必须从下方的独立管理端入口登录。')
      } else if (result?.error || !result?.ok) {
        setError(t('loginFailed'))
      } else {
        const session = await getSession()
        window.location.href = session?.user?.role === 'super_admin'
          ? `/${locale}/admin/accounts`
          : `/${locale}/works`
      }
    } catch {
      setError(t('loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <FosAuthShell
      title={t('welcomeBack')}
      subtitle="登录后进入所属工作区，写权限由当前角色的功能区决定。"
      footer="没有账号？请联系管理账号分配账号、密码、角色与功能区权限。"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="username" className="mb-2 block text-[12px] font-semibold text-white/60">账号</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            className="fos-input w-full"
            style={{ height: 44 }}
            placeholder="请输入账号"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-[12px] font-semibold text-white/60">{t('password')}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="fos-input w-full"
            style={{ height: 44 }}
            placeholder={t('passwordPlaceholder')}
          />
        </div>
        {error ? <div className="rounded-[9px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-[13px] text-red-200">{error}</div> : null}
        <button type="submit" disabled={loading} className="fos-btn fos-btn-primary h-11 w-full font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? t('loginButtonLoading') : t('loginButton')}
        </button>
        <Link className="block text-center text-[11px] text-white/35 transition hover:text-white/60" href={{ pathname: '/admin/signin' }}>
          平台 Admin 请使用独立管理端口
        </Link>
      </form>
    </FosAuthShell>
  )
}
