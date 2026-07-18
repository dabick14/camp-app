import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { SmsLogEntry } from '../types'

export async function listRecentSmsLog(campId: string, max = 50): Promise<SmsLogEntry[]> {
  const q = query(
    collection(db, 'camps', campId, 'smsLog'),
    orderBy('createdAt', 'desc'),
    limit(max),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry)
}

// No orderBy here — a compound (participantId ==, createdAt orderBy) query
// needs a composite index. Same pattern as listAllocationsByParticipant:
// fetch by the single equality filter, sort client-side.
export async function listSmsLogForParticipant(
  campId: string,
  participantId: string,
): Promise<SmsLogEntry[]> {
  const q = query(
    collection(db, 'camps', campId, 'smsLog'),
    where('participantId', '==', participantId),
  )
  const snap = await getDocs(q)
  const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry)
  entries.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
  return entries
}
