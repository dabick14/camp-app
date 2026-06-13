import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Participant } from '../types'

export async function listParticipants(campId: string): Promise<Participant[]> {
  const snap = await getDocs(collection(db, 'camps', campId, 'participants'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Participant)
}
