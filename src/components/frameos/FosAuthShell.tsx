import type { ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon, type AppIconName } from '@/components/ui/icons'

export function FosAuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  const isolationFeatures: Array<{ icon: AppIconName; label: string }> = [
    { icon: 'folder', label: '工作区共享' },
    { icon: 'user', label: '角色分权' },
    { icon: 'lock', label: '后端鉴权' },
  ]

  return (
    <main className="fos-app min-h-screen bg-[#090a0d] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-280px] h-[620px] w-[760px] -translate-x-1/2 rounded-full bg-[#315bf2]/15 blur-[130px]" />
        <div className="absolute bottom-[-260px] right-[-180px] h-[560px] w-[560px] rounded-full bg-[#7c3aed]/10 blur-[120px]" />
      </div>
      <header className="relative z-10 flex h-16 items-center border-b border-white/[.06] px-6 lg:px-10">
        <Link href={{ pathname: '/' }} className="fos-logo">
          <span className="fos-logo-mark"><i /><i /><i /></span>
          <span className="fos-logo-text"><span className="a">Nori</span><span className="b">Video</span></span>
        </Link>
        <span className="ml-auto rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-[11px] text-white/45">工作区角色权限已启用</span>
      </header>
      <div className="fos-auth-layout relative z-10 mx-auto grid min-h-[calc(100vh-64px)] max-w-[1120px] items-center gap-12 px-6 py-12 lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:block">
          <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#315bf2]/30 bg-[#315bf2]/15 text-[#88a6ff]">
            <AppIcon name="folderHeart" className="h-6 w-6" />
          </div>
          <h2 className="max-w-[560px] text-[38px] font-bold leading-[1.15] tracking-[-.03em]">同一工作区，按角色安全协作</h2>
          <p className="mt-5 max-w-[540px] text-[15px] leading-7 text-white/45">子账号可读取管理账号工作区的项目与资产；编剧、资产师、分镜师只可修改各自负责的内容。</p>
          <div className="mt-8 grid max-w-[560px] grid-cols-3 gap-3">
            {isolationFeatures.map((item) => (
              <div key={item.label} className="rounded-[12px] border border-white/[.07] bg-white/[.025] px-4 py-4 text-[13px] font-semibold text-white/65">
                <AppIcon name={item.icon} className="mb-3 h-4 w-4 text-[#6f91ff]" />{item.label}
              </div>
            ))}
          </div>
        </section>
        <section className="w-full rounded-[18px] border border-white/[.09] bg-[#121318]/95 p-7 shadow-[0_30px_90px_rgba(0,0,0,.45)] sm:p-9">
          <h1 className="text-[25px] font-bold tracking-[-.02em]">{title}</h1>
          <p className="mt-2 text-[13px] leading-6 text-white/40">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 border-t border-white/[.07] pt-5 text-center text-[13px] text-white/40">{footer}</div>
        </section>
      </div>
    </main>
  )
}
