'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

function ModalShell({ title, subtitle, width = 1000, children, onClose }: { title: string; subtitle?: string; width?: number; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-6 pt-[12vh]" onClick={onClose}>
      <div className="w-full rounded-[16px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] p-6 shadow-2xl" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-[18px] font-bold text-white">{title}</h3>
            {subtitle ? <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fos-text-4)] hover:bg-[var(--fos-fill-mid)] hover:text-white">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ServiceRecordsModal({ onClose }: { onClose: () => void }) {
  const cols = ['申诉编号', '项目', '详细信息', '模型', '申诉时间', '申诉人', '处理状态']
  return (
    <ModalShell title="服务记录" subtitle="查看你提交过的申诉记录及处理进度" onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <button className="flex h-9 items-center gap-2 rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px] text-[var(--fos-text-3)]">
          <AppIcon name="clock" className="h-4 w-4" />按申诉日期
        </button>
        <span className="text-[12px] text-[var(--fos-text-4)]">共 0 条</span>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-soft)]">
        <div className="grid border-b border-[var(--fos-border-soft)] px-4 py-3 text-[12px] font-bold text-[var(--fos-text-3)]" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cols.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--fos-text-4)]">
          <AppIcon name="fileText" className="h-8 w-8" />
          <span className="text-[13px]">暂无服务记录</span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-[var(--fos-text-4)]">
        <button className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--fos-fill-mid)]"><AppIcon name="chevronLeft" className="h-4 w-4" /></button>
        <span className="font-bold text-[var(--fos-primary)]">1</span>
        <button className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--fos-fill-mid)]"><AppIcon name="chevronRight" className="h-4 w-4" /></button>
      </div>
    </ModalShell>
  )
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell title="提交反馈" subtitle="您的意见对我们非常重要" width={620} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-bold text-white">详细描述</span>
            <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">选填</span>
          </div>
          <div className="relative">
            <textarea className="fos-textarea" style={{ minHeight: 150 }} maxLength={500} placeholder="请详细描述您遇到的问题或建议..." />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[12px] text-[var(--fos-text-4)]">0 / 500</span>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-bold text-white">上传附件</span>
            <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">选填</span>
            <span className="text-[12px] text-[var(--fos-text-4)]">图片或视频，最多 9 个</span>
          </div>
          <button className="flex h-16 w-16 items-center justify-center rounded-[10px] border border-dashed border-[var(--fos-border-strong)] text-[var(--fos-text-4)] hover:border-[var(--fos-primary-border)] hover:text-[var(--fos-text-2)]">
            <AppIcon name="plus" className="h-5 w-5" />
          </button>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-bold text-white">联系方式</span>
            <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">选填</span>
          </div>
          <input className="fos-input" placeholder="微信或邮箱，方便我们回复您" />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button onClick={onClose} className="fos-btn fos-btn-ghost">取消</button>
        <button className="fos-btn fos-btn-primary"><AppIcon name="arrowRight" className="h-3.5 w-3.5" />提交反馈</button>
      </div>
    </ModalShell>
  )
}

export function AccountModal({ account, onClose }: { account: string; onClose: () => void }) {
  return (
    <ModalShell title="个人中心" width={620} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--fos-primary-soft)] text-[var(--fos-primary)]"><AppIcon name="userCircle" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-white">账号信息</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--fos-border-soft)] pt-4">
            <span className="text-[13px] text-[var(--fos-text-3)]">账号</span>
            <span className="text-[14px] font-bold text-white">{account}</span>
          </div>
        </div>
        <div className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[rgba(139,92,246,.16)] text-[#a78bfa]"><AppIcon name="lock" className="h-5 w-5" /></span>
            <span className="text-[15px] font-bold text-white">登录密码</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--fos-border-soft)] pt-4">
            <div>
              <div className="text-[13px] font-bold text-white">已设置登录密码</div>
              <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">可使用账号+密码方式登录</div>
            </div>
            <button className="fos-btn fos-btn-primary fos-btn-sm" disabled title="演示已禁用">修改密码</button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}

export function UpdatesToast({ onDone }: { onDone: () => void }) {
  useState(() => { setTimeout(onDone, 2200); return null })
  return (
    <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-[10px] border border-[rgba(34,197,94,.3)] bg-[rgba(20,40,28,.95)] px-4 py-2.5 text-[13px] text-white shadow-xl">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#22c55e] text-white"><AppIcon name="check" className="h-3 w-3" /></span>
        当前已是最新版本
      </div>
    </div>
  )
}
