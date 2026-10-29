'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { ArrowUpRight, KeyRound, Layers3, UsersRound, X } from '@/components/ui/icons'

export function AuthHelpButton({ label, className = '' }: { label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const english = useLocale() === 'en'
  useEffect(() => {
    if (!open || !dialog.current) return
    const element = dialog.current
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [open])

  const steps = english
    ? [
      { icon: UsersRound, title: 'Get your team account', body: 'Ask your team administrator for an account and assigned workspace. Self-registration is not available.' },
      { icon: KeyRound, title: 'Sign in to your workspace', body: 'Use the account and password you received. If you cannot sign in, ask your administrator to check your account status or reset your password.' },
      { icon: Layers3, title: 'Create together', body: 'Your role and permissions determine which parts of the workspace you can edit. Platform administrators use the separate admin sign-in.' },
    ]
    : [
      { icon: UsersRound, title: '获取团队账号', body: '联系团队管理员分配工作账号与所属工作区。平台不开放自行注册。' },
      { icon: KeyRound, title: '登录创作工作台', body: '使用管理员分配的账号和密码登录。如无法登录，请联系管理员核对账号状态或重置密码。' },
      { icon: Layers3, title: '与团队一起创作', body: '角色与功能区权限决定可编辑的内容；平台 Admin 请使用登录表单下方的独立管理入口。' },
    ]

  return (
    <>
      <button type="button" className={`nori-auth-help-trigger ${className}`} onClick={() => setOpen(true)}>{label}<ArrowUpRight size={13} aria-hidden="true" /></button>
      {open ? <dialog
        className="nori-auth-help-dialog"
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); setOpen(false) }}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
      >
        <div className="nori-auth-help-panel" onClick={(event) => event.stopPropagation()}>
          <header><div><p>LANMIAOTV / QUICK START</p><h2 id={titleId}>{english ? 'Your next story starts here.' : '开始你的下一部作品。'}</h2></div><button type="button" aria-label={english ? 'Close guide' : '关闭使用指南'} onClick={() => setOpen(false)} autoFocus><X size={19} /></button></header>
          <ol>{steps.map(({ icon: Icon, title, body }) => <li key={title}><span><Icon size={19} strokeWidth={1.5} aria-hidden="true" /></span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
          <button type="button" className="nori-auth-help-done" onClick={() => setOpen(false)}>{english ? 'Got it' : '了解了，开始创作'}</button>
        </div>
      </dialog> : null}
    </>
  )
}
