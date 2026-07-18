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
  deleteField,
  type FieldValue,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Camp, SmsSettings, SuperGroup } from '../types'

type CampInput = Omit<Camp, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>

// Firestore rejects undefined values — strip them before addDoc.
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

// For updateDoc: replace undefined with deleteField() so cleared optional
// fields (e.g. description cleared in the settings form) are actually removed.
function undefinedToDelete(
  obj: Record<string, unknown>,
): Record<string, unknown | FieldValue> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === undefined ? deleteField() : v]),
  )
}

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
    ...stripUndefined(data as Record<string, unknown>),
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
    ...undefinedToDelete(data as Record<string, unknown>),
    updatedAt: Timestamp.now(),
    updatedBy: uid,
  })
}

export async function saveSuperGroups(
  campId: string,
  superGroups: SuperGroup[],
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, 'camps', campId), {
    superGroups,
    updatedAt: Timestamp.now(),
    updatedBy: uid,
  })
}

export async function saveSmsSettings(
  campId: string,
  smsSettings: SmsSettings,
  uid: string,
): Promise<void> {
  // stripUndefined normally runs on the top-level update payload only —
  // smsSettings is nested one level in (a value, not spread), so an
  // undefined field inside it would slip past that and hit Firestore's
  // "Unsupported field value: undefined" error directly. Strip here too.
  await updateDoc(doc(db, 'camps', campId), {
    smsSettings: stripUndefined(smsSettings as unknown as Record<string, unknown>),
    updatedAt: Timestamp.now(),
    updatedBy: uid,
  })
}
