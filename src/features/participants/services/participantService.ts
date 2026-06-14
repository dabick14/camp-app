import {
  collection, doc, getDocs, updateDoc,
  arrayUnion, arrayRemove, serverTimestamp, deleteField,
  query, where, limit,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Participant } from '../types'

export async function listParticipants(campId: string): Promise<Participant[]> {
  const snap = await getDocs(collection(db, 'camps', campId, 'participants'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Participant)
}

function pRef(campId: string, participantId: string) {
  return doc(db, 'camps', campId, 'participants', participantId)
}

function audit(updatedBy: string) {
  return { updatedAt: serverTimestamp(), updatedBy }
}

export async function cancelRegistration(campId: string, participantId: string, updatedBy: string) {
  await updateDoc(pRef(campId, participantId), {
    registrationState: 'CANCELLED',
    ...audit(updatedBy),
  })
}

export async function restoreRegistration(campId: string, participantId: string, updatedBy: string) {
  await updateDoc(pRef(campId, participantId), {
    registrationState: 'REGISTERED',
    ...audit(updatedBy),
  })
}

export async function undoCheckIn(campId: string, participantId: string, updatedBy: string) {
  await updateDoc(pRef(campId, participantId), {
    checkInState: 'NOT_ARRIVED',
    checkedInBy: deleteField(),
    checkedInAt: deleteField(),
    ...audit(updatedBy),
  })
}

export async function changeRoomType(
  campId: string,
  participantId: string,
  roomTypePreferenceId: string,
  roomTypePreferenceName: string,
  feeOwed: number,
  updatedBy: string,
) {
  await updateDoc(pRef(campId, participantId), {
    roomTypePreferenceId,
    roomTypePreferenceName,
    feeOwed,
    ...audit(updatedBy),
  })
}

export async function waiveFee(
  campId: string,
  participantId: string,
  feeWaiverNote: string,
  updatedBy: string,
) {
  await updateDoc(pRef(campId, participantId), {
    feeOwed: 0,
    feeWaiverNote,
    ...audit(updatedBy),
  })
}

export async function editNotes(
  campId: string,
  participantId: string,
  notes: string,
  updatedBy: string,
) {
  const trimmed = notes.trim()
  await updateDoc(pRef(campId, participantId), {
    ...(trimmed ? { notes: trimmed } : { notes: deleteField() }),
    ...audit(updatedBy),
  })
}

export async function addTag(
  campId: string,
  participantId: string,
  tag: string,
  updatedBy: string,
) {
  await updateDoc(pRef(campId, participantId), {
    tags: arrayUnion(tag),
    ...audit(updatedBy),
  })
}

export async function removeTag(
  campId: string,
  participantId: string,
  tag: string,
  updatedBy: string,
) {
  await updateDoc(pRef(campId, participantId), {
    tags: arrayRemove(tag),
    ...audit(updatedBy),
  })
}

export async function checkPhoneDuplicate(
  campId: string,
  normalizedPhone: string,
): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, 'camps', campId, 'participants'),
      where('phone', '==', normalizedPhone),
      limit(5),
    ),
  )
  return snap.docs.some((d) => d.data().registrationState === 'REGISTERED')
}
