'use client'

import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { FosShell } from './FosShell'

export function FosVideoRepaintClient() {
  const router = useRouter()
  return (
    <FosShell activeKey="screenwriter" hideSidebar>
      <main className="rv2-main">
        <div className="rv2-main-scroll rv2-main--setup">
          <section className="rv2-setup" aria-labelledby="repaint-unavailable">
            <div className="rv2-setup-inner">
              <div className="rv2-flow-kicker"><AppIcon name="info" className="h-3.5 w-3.5" /> 服务调整</div>
              <h1 id="repaint-unavailable" className="rv2-setup-title">视频转绘已停用</h1>
              <p className="rv2-setup-desc">旧版视频反译依赖独立的 Ark 上传链路，不能由 DeepSeek 文本接口或 Kuaizi 媒体接口直接替代。平台已停止这条链路，避免产生错误任务或费用。</p>
              <div className="rv2-billing-card">
                <span className="rv2-billing-icon"><AppIcon name="fileText" className="rv2-billing-icon-svg" /></span>
                <div className="rv2-billing-text"><p className="rv2-billing-title">已有剧本不受影响</p><p className="rv2-billing-desc">返回编剧工作台，仍可查看、编辑和保存当前账号下的剧本。</p></div>
              </div>
              <div className="rv2-actions"><button type="button" className="rv2-submit-btn" onClick={() => router.push({ pathname: '/writer-workbench' })}>返回编剧工作台 <AppIcon name="arrowRight" className="rv2-submit-btn-icon" /></button></div>
            </div>
          </section>
        </div>
      </main>
    </FosShell>
  )
}
