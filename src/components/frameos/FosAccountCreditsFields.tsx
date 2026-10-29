'use client'

import { MAX_ACCOUNT_CREDITS, MIN_ACCOUNT_POINT_CREDITS } from '@/lib/account/credits'

export function FosAccountCreditsFields({
  coins,
  points,
  onCoinsChange,
  onPointsChange,
}: {
  coins: string
  points: string
  onCoinsChange: (value: string) => void
  onPointsChange: (value: string) => void
}) {
  return (
    <div className="mt-5 rounded-[10px] border border-white/[.07] bg-white/[.025] p-4">
      <div className="mb-3">
        <span className="block text-[11px] font-semibold text-white/60">账号积分</span>
        <p className="mt-1 text-[10px] text-white/35">右上角会显示当前登录账号自己的金币与积分；新账号默认均为 0。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] text-white/45">
            <i className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] not-italic text-amber-950">¥</i>
            金币
          </span>
          <input
            className="fos-input w-full"
            type="number"
            min={0}
            max={MAX_ACCOUNT_CREDITS}
            step={1}
            inputMode="numeric"
            value={coins}
            onChange={(event) => onCoinsChange(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] text-white/45">
            <i className="flex h-4 w-4 items-center justify-center rounded-full bg-[linear-gradient(100deg,#3c8bff_0%,#6c5cff_52%,#a855f7_100%)] text-[8px] not-italic text-white">◆</i>
            积分
          </span>
          <input
            className="fos-input w-full"
            type="number"
            min={MIN_ACCOUNT_POINT_CREDITS}
            max={MAX_ACCOUNT_CREDITS}
            step={0.01}
            inputMode="decimal"
            value={points}
            onChange={(event) => onPointsChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
