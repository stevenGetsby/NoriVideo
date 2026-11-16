const BEIJING_OFFSET_MS = 8 * 3600_000
const pad = (value: number) => String(value).padStart(2, '0')

/** 'M月D日 HH:mm' in Beijing time (UTC+8, no DST). */
export function formatBeijing(iso: string): string {
  const date = new Date(new Date(iso).getTime() + BEIJING_OFFSET_MS)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

export function formatDuration(totalSec: number): string {
  return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`
}

/** ISO → 'YYYY-MM-DDTHH:mm' wall clock in Beijing, for datetime-local inputs. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(new Date(iso).getTime() + BEIJING_OFFSET_MS)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/** 'YYYY-MM-DDTHH:mm' Beijing wall clock → ISO. */
export function fromDatetimeLocal(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) - BEIJING_OFFSET_MS
  return new Date(ms).toISOString()
}
