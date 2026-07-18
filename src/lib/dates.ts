import { Timestamp } from 'firebase/firestore'

// Converts a Firestore Timestamp to the YYYY-MM-DD string HTML date inputs expect.
// Uses local time to avoid UTC-midnight drift.
export function tsToDateStr(ts: Timestamp): string {
  const d = ts.toDate()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Converts a YYYY-MM-DD string back to a Timestamp using local midnight.
export function dateStrToTs(s: string): Timestamp {
  const [y, m, d] = s.split('-').map(Number)
  return Timestamp.fromDate(new Date(y, m - 1, d))
}

export function formatDateRange(start: Timestamp, end: Timestamp): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${fmt.format(start.toDate())} – ${fmt.format(end.toDate())}`
}

// Coarse relative age ("just now" / "3h ago" / "5d ago") for admin-facing
// lists where the exact time matters less than "how stale is this."
export function formatAge(ts: Timestamp): string {
  const ms = Date.now() - ts.toDate().getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
