'use client'

import { useEffect, useState } from 'react'
import { getSession, signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { FosAuthShell } from '@/components/frameos/FosAuthShell'
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from '@/components/ui/icons'

function PasswordField({ id, label, value, onChange, autoComplete, disabled }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  disabled: boolean
}) {
  const [visible, setVisible] = useState(false)
  const english = useLocale() === 'en'
  return (
    <div className="nori-auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="nori-auth-input-wrap">
        <KeyRound className="nori-auth-input-icon" strokeWidth={1.5} aria-hidden="true" />
        <input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} required minLength={id === 'currentPassword' ? undefined : 8} maxLength={128} disabled={disabled} />
        <button type="button" className="nori-auth-password-toggle" disabled={disabled} aria-label={english ? visible ? 'Hide password' : 'Show password' : visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.5} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

export default function ChangePasswordPage() {
  const { data: session, status } = useSession()
  const locale = useLocale()
  const english = locale === 'en'
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.replace(`/${locale}/auth/signin`)
    } else if (status === 'authenticated' && session && !session.user.passwordChangeRequired) {
      window.location.replace(session.user.role === 'super_admin' ? `/${locale}/admin/accounts` : `/${locale}/works`)
    }
  }, [locale, session, status])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    if (newPassword !== confirmPassword) {
      setError(english ? 'The new passwords do not match.' : '两次输入的新密码不一致。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) {
        setError(data.message || (english ? 'Unable to change the password. Please try again.' : '修改密码失败，请稍后重试。'))
        return
      }
      await getSession()
      window.location.href = session?.user?.role === 'super_admin' ? `/${locale}/admin/accounts` : `/${locale}/works`
    } catch {
      setError(english ? 'The service is temporarily unavailable. Please try again.' : '服务暂时不可用，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading') {
    return <main className="nori-auth"><Loader2 className="nori-auth-spinner" aria-label={english ? 'Loading' : '加载中'} /></main>
  }
  if (status !== 'authenticated' || !session?.user || !session.user.passwordChangeRequired) return null

  return (
    <FosAuthShell
      title={english ? 'Set your own password' : '设置你的专属密码'}
      subtitle={english ? 'For your first sign-in, replace the initial password before entering the workspace.' : '首次登录需先替换管理员设置的初始密码，再进入工作区。'}
      footer={english ? 'Use 8–128 characters and keep this password private.' : '密码长度 8–128 个字符，请勿与初始密码相同或告知他人。'}
    >
      <form onSubmit={handleSubmit} className="nori-auth-form" aria-busy={loading} aria-describedby={error ? 'nori-password-error' : undefined}>
        <PasswordField id="currentPassword" label={english ? 'Initial password' : '当前初始密码'} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" disabled={loading} />
        <PasswordField id="newPassword" label={english ? 'New password' : '新密码'} value={newPassword} onChange={setNewPassword} autoComplete="new-password" disabled={loading} />
        <PasswordField id="confirmPassword" label={english ? 'Confirm new password' : '确认新密码'} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" disabled={loading} />
        <div className="nori-auth-form-info"><ShieldCheck size={12} strokeWidth={1.5} aria-hidden="true" /><span>{english ? 'Your current session stays signed in after the change.' : '修改成功后，当前登录状态会继续保留。'}</span></div>
        {error ? <div id="nori-password-error" className="nori-auth-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></div> : null}
        <button type="submit" disabled={loading} className="nori-auth-submit">
          <span>{loading ? (english ? 'Saving…' : '保存中…') : (english ? 'Save and enter workspace' : '保存并进入工作台')}</span>
          {loading ? <Loader2 size={16} className="nori-auth-spinner" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="nori-auth-admin-link" disabled={loading} onClick={() => void signOut({ callbackUrl: `/${locale}/auth/signin` })}>
          {english ? 'Sign out and use another account' : '退出登录，使用其他账号'}
        </button>
      </form>
    </FosAuthShell>
  )
}
