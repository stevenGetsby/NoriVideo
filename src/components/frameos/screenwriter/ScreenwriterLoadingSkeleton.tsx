export function ScreenwriterLoadingSkeleton({
  title = '正在加载',
}: {
  title?: string
}) {
  return (
    <div
      data-screenwriter-loading-skeleton="true"
      aria-busy="true"
      className="flex min-h-0 flex-1 overflow-hidden bg-[var(--fos-bg-1)]"
    >
      <aside className="hidden w-[220px] flex-none border-r border-[var(--fos-border-soft)] bg-[rgba(255,255,255,.02)] p-4 md:block">
        <SkeletonBlock className="mb-6 h-10 w-full" />
        <div className="space-y-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <SkeletonBlock className="h-7 w-7 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="h-2.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-[1080px]">
          <div className="mb-6">
            <div className="text-[14px] font-bold text-[var(--fos-text-3)]">{title}</div>
            <SkeletonBlock className="mt-3 h-8 w-64 max-w-full" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-5">
              <SkeletonBlock className="h-6 w-52" />
              <div className="mt-6 space-y-4">
                <SkeletonBlock className="h-24 w-full" />
                <SkeletonBlock className="h-24 w-full" />
                <SkeletonBlock className="h-24 w-5/6" />
              </div>
            </section>
            <aside className="space-y-5">
              <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-5">
                <SkeletonBlock className="h-5 w-36" />
                <div className="mt-5 space-y-3">
                  <SkeletonBlock className="h-16 w-full" />
                  <SkeletonBlock className="h-16 w-full" />
                </div>
              </section>
              <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-5">
                <SkeletonBlock className="h-20 w-full" />
                <SkeletonBlock className="mt-4 h-10 w-full" />
              </section>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`rounded-[6px] bg-[rgba(148,163,184,.20)] ${className}`} />
}
