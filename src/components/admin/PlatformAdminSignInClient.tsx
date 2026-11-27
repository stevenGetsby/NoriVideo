'use client'

import { useState } from 'react'
import { getSession, signIn, signOut } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon, ShieldCheck } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { AdminBrand } from '@/components/admin/PlatformAdminShell'
import { SURFACE_LOGIN_ERRORS } from '@/lib/app-surface'
import './admin-console.css'

export function PlatformAdminSignInClient({ workspaceSignInUrl }: { workspaceSignInUrl: string }) {
  const locale = useLocale()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
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
        return
      }
      if (result?.error === SURFACE_LOGIN_ERRORS.workspaceRequired) {
        setError('账号密码正确，但管理账号和角色子账号必须从 LanmiaoTV 作品端登录。')
        return
      }
      if (result?.error || !result?.ok) {
        setError('账号或密码错误，或账号已被停用。')
        return
      }

      const session = await getSession()
      if (session?.user?.role !== 'super_admin') {
        await signOut({ redirect: false })
        setError('此入口仅供平台 Admin 使用，管理账号和角色子账号请从 LanmiaoTV 登录。')
        return
      }
      window.location.href = session.user.passwordChangeRequired
        ? `/${locale}/auth/change-password`
        : `/${locale}/admin/accounts`
    } catch {
      setError('登录失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="nori-admin-login nori-force-dark">
      <header className="nori-admin-header">
        <AdminBrand />
        <span className="nori-admin-role-pill ml-auto">
          <ShieldCheck />
          独立管理入口
        </span>
      </header>

      <div className="nori-admin-login-layout">
        <section className="nori-admin-login-copy">
          <p className="nori-admin-kicker">平台管理控制台</p>
          <h1>管理工作区负责人，不介入内容生产。</h1>
          <p>平台 Admin 统一维护管理账号、额度与全平台模型路由、白标策略。编剧、资产师、分镜师与审核员由各管理账号在 LanmiaoTV 内自行维护。</p>
          <ul>
            <li><AppIcon name="usersRound" />账号与用量</li>
            <li><AppIcon name="settingsHex" />服务与模型配置</li>
            <li><AppIcon name="clipboardCheckSolid" />小程序审核运营</li>
          </ul>
        </section>

        <section className="nori-admin-login-card">
          <h2>登录平台管理</h2>
          <p>该入口与 LanmiaoTV 工作台相互独立，需使用平台最高管理员凭据。</p>
          <form onSubmit={submit}>
            <label className="nori-admin-field">
              平台 Admin 账号
              <input
                className="fos-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="请输入账号"
                required
              />
            </label>
            <label className="nori-admin-field">
              密码
              <PasswordInput
                className="fos-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
                required
              />
            </label>
            {error ? <div className="nori-admin-alert is-error" role="alert">{error}</div> : null}
            <button
              className="fos-btn fos-btn-primary nori-admin-login-submit"
              disabled={loading}
              type="submit"
              title={loading ? '正在验证管理账号' : '登录 LanmiaoTV 管理控制台'}
            >
              {loading ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="arrowRight" className="h-4 w-4" />}
              {loading ? '正在验证…' : '进入管理控制台'}
            </button>
            <a className="nori-admin-login-back" href={workspaceSignInUrl}>
              管理账号和角色子账号请返回 LanmiaoTV
            </a>
          </form>
        </section>
      </div>
    </main>
  )
}
