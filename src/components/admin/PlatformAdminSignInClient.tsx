'use client'

import { useState } from 'react'
import { getSession, signIn, signOut } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { SURFACE_LOGIN_ERRORS } from '@/lib/app-surface'

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
        setError('账号密码正确，但管理账号和角色子账号必须从 NoriVideo 项目端登录。')
        return
      }
      if (result?.error || !result?.ok) {
        setError('账号或密码错误，或账号已被停用。')
        return
      }

      const session = await getSession()
      if (session?.user?.role !== 'super_admin') {
        await signOut({ redirect: false })
        setError('此入口仅供平台 Admin 使用，管理账号和角色子账号请从 NoriVideo 登录。')
        return
      }
      window.location.href = `/${locale}/admin/accounts`
    } catch {
      setError('登录失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="nori-admin-login relative min-h-screen overflow-hidden bg-[#070a12] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12rem] top-[-10rem] h-[34rem] w-[34rem] rounded-full bg-cyan-500/[.10] blur-[120px]" />
        <div className="absolute bottom-[-16rem] right-[-8rem] h-[38rem] w-[38rem] rounded-full bg-indigo-500/[.12] blur-[140px]" />
        <div className="absolute inset-0 opacity-[.12] [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <header className="relative z-10 flex h-16 items-center border-b border-white/[.07] px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.08] text-cyan-200">
            <AppIcon name="lock" className="h-4 w-4" />
          </span>
          <div>
            <strong className="block text-[13px] tracking-[.08em] text-white">NORI CONTROL</strong>
            <span className="block text-[9px] tracking-[.16em] text-white/30">PLATFORM ADMINISTRATION</span>
          </div>
        </div>
        <span className="ml-auto rounded-full border border-white/[.08] bg-white/[.035] px-3 py-1 text-[10px] text-white/35">独立管理入口</span>
      </header>

      <div className="nori-admin-login-layout relative z-10 mx-auto grid min-h-[calc(100vh-64px)] max-w-[1080px] items-center gap-16 px-6 py-12 lg:grid-cols-[1fr_420px]">
        <section className="hidden lg:block">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/[.06] px-3 py-1.5 text-[11px] text-cyan-100/70">
            <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />平台级账号控制台
          </span>
          <h1 className="max-w-[560px] text-[42px] font-semibold leading-[1.12] tracking-[-.035em]">管理工作区负责人，<br />不介入内容生产。</h1>
          <p className="mt-5 max-w-[520px] text-[14px] leading-7 text-white/40">平台 Admin 只创建和维护管理账号。每位管理账号在 NoriVideo 内独立维护自己的编剧、资产师与分镜师。</p>
          <div className="mt-8 flex gap-3 text-[11px] text-white/45">
            <span className="rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2">管理账号 CRUD</span>
            <span className="rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2">工作区隔离</span>
            <span className="rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2">权限审计</span>
          </div>
        </section>

        <section className="rounded-2xl border border-white/[.09] bg-[#0e1320]/95 p-7 shadow-[0_32px_100px_rgba(0,0,0,.55)] sm:p-9">
          <div className="mb-7">
            <span className="text-[10px] font-semibold tracking-[.16em] text-cyan-200/60">PLATFORM ADMIN</span>
            <h2 className="mt-2 text-[25px] font-semibold tracking-[-.02em]">登录平台控制台</h2>
            <p className="mt-2 text-[12px] leading-5 text-white/35">该入口与 NoriVideo 工作台相互独立。</p>
          </div>
          <form className="space-y-5" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-[11px] font-medium text-white/55">平台 Admin 账号</span>
              <input
                className="fos-input h-11 w-full"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="请输入账号"
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[11px] font-medium text-white/55">密码</span>
              <input
                className="fos-input h-11 w-full"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
                required
              />
            </label>
            {error ? <div className="rounded-lg border border-red-400/20 bg-red-400/[.08] px-3 py-2.5 text-[11px] leading-5 text-red-200">{error}</div> : null}
            <button className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 text-[12px] font-semibold text-[#071018] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={loading} type="submit">
              {loading ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="arrowRight" className="h-4 w-4" />}
              {loading ? '正在验证…' : '进入管理控制台'}
            </button>
            <a className="block text-center text-[11px] text-white/35 transition hover:text-white/60" href={workspaceSignInUrl}>
              管理账号和角色子账号请返回 NoriVideo 项目端
            </a>
          </form>
        </section>
      </div>
    </main>
  )
}
