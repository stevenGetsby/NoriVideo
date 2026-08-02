import { FrameServiceRecordsDashboard } from '@/components/workspace/FrameServiceRecordsDashboard'
import { FosShell } from '@/components/frameos/FosShell'

export default function ServiceRecordsPage() {
  return (
    <FosShell activeKey="records">
      <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--fos-bg-0)] p-5 lg:p-7">
        <div className="mx-auto max-w-[1480px]">
          <div className="mb-5"><h1 className="text-[22px] font-bold tracking-[-.02em] text-white">服务记录与用量</h1><p className="mt-1.5 text-[12px] leading-5 text-[var(--fos-text-4)]">查看真实任务、项目消耗、账户流水、失败原因和服务使用统计。</p></div>
          <FrameServiceRecordsDashboard />
        </div>
      </main>
    </FosShell>
  )
}
