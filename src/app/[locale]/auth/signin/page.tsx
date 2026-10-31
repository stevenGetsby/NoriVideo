'use client'

import { useRef, useState } from 'react'
import { getSession, signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { FosAuthShell } from '@/components/frameos/FosAuthShell'
import { Link } from '@/i18n/navigation'
import { SURFACE_LOGIN_ERRORS } from '@/lib/app-surface'
import { AlertCircle, ArrowRight, ArrowUpRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, UserRound } from '@/components/ui/icons'
import { AuthHelpButton } from '@/components/frameos/auth/AuthHelpButton'

export default function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const submitting = useRef(false)
  const usernameInput = useRef<HTMLInputElement>(null)
  const locale = useLocale()
  const english = locale === 'en'
  const t = useTranslations('auth')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    if (!username.trim()) {
      setError(english ? 'Please enter your account name.' : '请输入账号，不能只填写空格。')
      usernameInput.current?.focus()
      return
    }
    submitting.current = true
    setLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        username: username.trim(),
        password,
        redirect: false,
      })

      if ((result?.status || 0) >= 500) {
        setError(english ? 'The sign-in service is temporarily unavailable. Please try again shortly; your credentials may be correct.' : '登录服务暂时异常，请稍后重试；账号密码未必有误。')
      } else if (result?.error === 'RateLimited') {
        setError(t('rateLimited'))
      } else if (result?.error === SURFACE_LOGIN_ERRORS.adminRequired) {
        setError(english ? 'Your credentials are correct. Platform admins must use the separate admin sign-in below.' : '账号密码正确，但平台 Admin 必须从下方的独立管理端入口登录。')
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
      submitting.current = false
      setLoading(false)
    }
  }

  return (
    <FosAuthShell
      title={t('welcomeBack')}
      subtitle={english ? 'Your next story starts in your workspace.' : '登录你的工作区，继续下一段好故事。'}
      footer={english ? 'New to LanMiaoTV? Ask your team administrator for an account and workspace access.' : '首次使用？请联系团队管理员获取账号，并分配角色与功能区权限。'}
    >
      <form onSubmit={handleSubmit} className="nori-auth-form" aria-busy={loading} aria-describedby={error ? 'nori-signin-error' : undefined}>
        <div className="nori-auth-field">
          <label htmlFor="username">{english ? 'Account' : '工作账号'}</label>
          <div className="nori-auth-input-wrap">
            <UserRound className="nori-auth-input-icon" strokeWidth={1.5} aria-hidden="true" />
            <input
              id="username"
              ref={usernameInput}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={loading}
              placeholder={english ? 'Your team account' : '请输入你的工作账号'}
            />
          </div>
        </div>
        <div className="nori-auth-field">
          <label htmlFor="password">{t('password')}</label>
          <div className="nori-auth-input-wrap">
            <KeyRound className="nori-auth-input-icon" strokeWidth={1.5} aria-hidden="true" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))}
              onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))}
              onBlur={() => setCapsLock(false)}
              required
              disabled={loading}
              aria-describedby={capsLock ? 'nori-caps-lock-hint' : undefined}
              placeholder={t('passwordPlaceholder')}
            />
            <button type="button" className="nori-auth-password-toggle" disabled={loading} aria-label={english ? showPassword ? 'Hide password' : 'Show password' : showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.5} aria-hidden="true" />}
            </button>
          </div>
          {capsLock ? <p id="nori-caps-lock-hint" className="nori-auth-caps-lock" role="status">{english ? 'Caps Lock is on.' : '大写锁定已开启，请注意密码大小写。'}</p> : null}
        </div>
        <div className="nori-auth-form-info">
          <ShieldCheck size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>{english ? 'Team-managed access' : '团队专属账号'}</span>
          <AuthHelpButton label={english ? 'Need help?' : '遇到登录问题？'} />
        </div>
        {error ? <div id="nori-signin-error" className="nori-auth-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></div> : null}
        <button type="submit" disabled={loading} className="nori-auth-submit">
          <span>{loading ? t('loginButtonLoading') : english ? 'Enter your workspace' : '进入创作工作台'}</span>
          {loading ? <Loader2 size={16} className="nori-auth-spinner" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <Link className="nori-auth-admin-link" href={{ pathname: '/admin/signin' }}>
          {english ? 'Platform admin sign-in' : '平台 Admin 独立管理入口'}<ArrowUpRight size={11} aria-hidden="true" />
        </Link>
      </form>
    </FosAuthShell>
  )
}
