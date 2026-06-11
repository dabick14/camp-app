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
