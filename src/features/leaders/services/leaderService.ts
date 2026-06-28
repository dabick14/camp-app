import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Leader } from '../types'

export async function listLeaders(campId: string): Promise<Leader[]> {
  const snap = await getDocs(query(collection(db, 'leaders'), where('campId', '==', campId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Leader)
}

// Activating/deactivating a leader goes through the setLeaderActive Cloud
// Function, not a direct client write — see firestore.rules. Reactivation
// must re-check the one-active-leader-per-sub-group rule, which requires a
// cross-document query that security rules can't express.
