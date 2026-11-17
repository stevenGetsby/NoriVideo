const WAN = 10000

export function formatCount(n: number): string {
  const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  if (value < WAN) return String(value)
  return `${(value / WAN).toFixed(1)}万`
}

export function formatDuration(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function beijing(iso: string | number): Date {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  return new Date((Number.isFinite(t) ? t : 0) + 8 * 3600 * 1000)
}

export function formatDate(iso: string | number, withTime = false): string {
  const d = beijing(iso)
  const base = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
  if (!withTime) return base
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${base} ${hh}:${mm}`
}

export function formatRelative(iso: string | number, now: number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return formatDate(iso)
}
