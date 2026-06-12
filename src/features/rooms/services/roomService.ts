import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Room } from '../types'

type RoomInput = Omit<Room, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>

function roomsRef(campId: string) {
  return collection(db, 'camps', campId, 'rooms')
}

export async function listRooms(campId: string): Promise<Room[]> {
  const snap = await getDocs(roomsRef(campId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Room)
}

export async function getRoom(campId: string, roomId: string): Promise<Room | null> {
  const snap = await getDoc(doc(db, 'camps', campId, 'rooms', roomId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Room
}

// currentOccupancy is always 0 on create — only transactional room assignment changes it
export async function createRoom(
  campId: string,
  data: Omit<RoomInput, 'currentOccupancy'>,
  uid: string,
): Promise<string> {
  const now = Timestamp.now()
  const payload = { ...data, currentOccupancy: 0, createdAt: now, createdBy: uid, updatedAt: now }
  Object.keys(payload).forEach((k) => (payload as Record<string, unknown>)[k] === undefined && delete (payload as Record<string, unknown>)[k])
  const ref = await addDoc(roomsRef(campId), payload)
  return ref.id
}

export async function updateRoom(
  campId: string,
  roomId: string,
  data: Partial<RoomInput>,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, 'camps', campId, 'rooms', roomId), {
    ...data,
    updatedAt: Timestamp.now(),
    updatedBy: uid,
  })
}

export async function deleteRoom(campId: string, roomId: string): Promise<void> {
  await deleteDoc(doc(db, 'camps', campId, 'rooms', roomId))
}

// Batch write — Firestore batch limit is 500 ops; for a typical camp this is safe
export async function bulkCreateRooms(
  campId: string,
  rooms: Omit<RoomInput, 'currentOccupancy'>[],
  uid: string,
): Promise<void> {
  const batch = writeBatch(db)
  const now = Timestamp.now()
  rooms.forEach((room) => {
    const ref = doc(roomsRef(campId))
    const data = { ...room, currentOccupancy: 0, createdAt: now, createdBy: uid, updatedAt: now }
    // Firestore rejects undefined values — strip them before writing
    Object.keys(data).forEach((k) => (data as Record<string, unknown>)[k] === undefined && delete (data as Record<string, unknown>)[k])
    batch.set(ref, data)
  })
  await batch.commit()
}
