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
import type { RoomType } from '../types'

function roomTypesRef(campId: string) {
  return collection(db, 'camps', campId, 'roomTypes')
}

export async function listRoomTypes(campId: string): Promise<RoomType[]> {
  const q = query(roomTypesRef(campId), orderBy('order'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RoomType)
}

export async function createRoomType(
  campId: string,
  data: { name: string; price: number; defaultCapacity: number; allowOverbook: boolean; order: number },
): Promise<string> {
  const now = Timestamp.now()
  const ref = await addDoc(roomTypesRef(campId), { ...data, createdAt: now, updatedAt: now })
  return ref.id
}

export async function updateRoomType(
  campId: string,
  id: string,
  data: Partial<{ name: string; price: number; defaultCapacity: number; allowOverbook: boolean; order: number }>,
): Promise<void> {
  await updateDoc(doc(db, 'camps', campId, 'roomTypes', id), {
    ...data,
    updatedAt: Timestamp.now(),
  })
}

export async function reorderRoomTypes(campId: string, orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  const now = Timestamp.now()
  orderedIds.forEach((id, index) => {
    batch.update(doc(db, 'camps', campId, 'roomTypes', id), { order: index, updatedAt: now })
  })
  await batch.commit()
}
