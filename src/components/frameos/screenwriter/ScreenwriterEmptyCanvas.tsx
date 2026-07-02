export function ScreenwriterEmptyCanvas() {
  return (
    <div className="flex min-h-[520px] flex-1 items-center justify-center px-6 text-center">
      <div>
        <div className="text-[15px] font-bold text-white">请从左侧选择一份剧本开始编辑</div>
        <div className="mt-4 text-[13px] text-[var(--fos-text-3)]">或点击上方按钮，按当前模式创建一份新剧本。</div>
      </div>
    </div>
  )
}
