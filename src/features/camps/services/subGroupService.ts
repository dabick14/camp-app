import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { SubGroup } from '../types'

function subGroupsRef(campId: string) {
  return collection(db, 'camps', campId, 'subGroups')
}

export async function listSubGroups(campId: string): Promise<SubGroup[]> {
  const q = query(subGroupsRef(campId), orderBy('order'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubGroup)
}

export async function createSubGroup(
  campId: string,
  name: string,
  order: number,
): Promise<string> {
  const now = Timestamp.now()
  const ref = await addDoc(subGroupsRef(campId), { name, order, createdAt: now, updatedAt: now })
  return ref.id
}

export async function updateSubGroup(
  campId: string,
  id: string,
  data: { name?: string; order?: number },
): Promise<void> {
  await updateDoc(doc(db, 'camps', campId, 'subGroups', id), {
    ...data,
    updatedAt: Timestamp.now(),
  })
}

// Writes order: 0, 1, 2 ... for each ID in the given array.
export async function reorderSubGroups(campId: string, orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  const now = Timestamp.now()
  orderedIds.forEach((id, index) => {
    batch.update(doc(db, 'camps', campId, 'subGroups', id), { order: index, updatedAt: now })
  })
  await batch.commit()
}
