import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Camp } from '../types'

type CampInput = Omit<Camp, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>

export async function listCamps(): Promise<Camp[]> {
  const q = query(collection(db, 'camps'), orderBy('startDate'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Camp)
}

export async function getCamp(id: string): Promise<Camp | null> {
  const snap = await getDoc(doc(db, 'camps', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Camp
}

export async function createCamp(data: CampInput, uid: string): Promise<string> {
  const now = Timestamp.now()
  const ref = await addDoc(collection(db, 'camps'), {
    ...data,
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
  })
  return ref.id
}

export async function updateCamp(
  id: string,
  data: Partial<CampInput>,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, 'camps', id), {
    ...data,
    updatedAt: Timestamp.now(),
    updatedBy: uid,
  })
}
