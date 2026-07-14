import {
  collection, doc, getDocs, updateDoc, runTransaction,
  arrayUnion, arrayRemove, serverTimestamp, deleteField,
  query, where, limit, orderBy, startAfter,
} from 'firebase/firestore'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { RoomType } from '@/features/rooms/types'
import type { Participant } from '../types'

export async function listParticipants(campId: string): Promise<Participant[]> {
  const snap = await getDocs(collection(db, 'camps', campId, 'participants'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Participant)
}

const PARTICIPANT_PAGE_SIZE = 100

export async function listParticipantsPage(
  campId: string,
  cursor: QueryDocumentSnapshot | null,
): Promise<{ docs: Participant[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const ref = collection(db, 'camps', campId, 'participants')
  const q = cursor
    ? query(ref, orderBy('fullName'), limit(PARTICIPANT_PAGE_SIZE), startAfter(cursor))
    : query(ref, orderBy('fullName'), limit(PARTICIPANT_PAGE_SIZE))
  const snap = await getDocs(q)
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Participant)
  return {
    docs,
    lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === PARTICIPANT_PAGE_SIZE,
  }
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

// ─── room assignment transaction ──────────────────────────────────────────────
//
// All reads happen before any writes — required by Firestore transaction semantics.
// Returns the assigned room's number string on success.

export async function assignRoom(
  campId: string,
  participantId: string,
  participantGender: 'M' | 'F',
  oldRoomId: string | null | undefined,
  newRoomId: string,
  roomTypesCache: RoomType[],
  overrideReason: string | null,
  uid: string,
): Promise<string> {
  let assignedRoomNumber = ''

  await runTransaction(db, async (tx) => {
    // ── READ PHASE ──────────────────────────────────────────────────────────

    // 1. Read the new room
    const newRoomRef = doc(db, 'camps', campId, 'rooms', newRoomId)
    const newRoomSnap = await tx.get(newRoomRef)
    if (!newRoomSnap.exists()) throw new Error('Room no longer exists')
    const nr = newRoomSnap.data() as {
      gender: string
      capacity: number
      currentOccupancy: number
      number: string
      roomTypeId: string
    }

    if (nr.gender !== participantGender) {
      throw new Error('Gender mismatch — this room is designated for a different gender')
    }

    // 2. Capacity check (uses cached roomTypes — no extra Firestore read needed)
    if (nr.currentOccupancy >= nr.capacity) {
      const rt = roomTypesCache.find((r) => r.id === nr.roomTypeId)
      if (!rt?.allowOverbook) {
        throw new Error('Room is at hard capacity and does not allow overbooks')
      }
      // allowOverbook === true: proceed (admin already confirmed in the picker)
    }

    // 3. Read old room (if participant is moving rooms, not new assignment)
    const effectiveOldRoomId =
      oldRoomId && oldRoomId !== newRoomId ? oldRoomId : null

    let oldOccupancy = 0
    let oldRoomRef: ReturnType<typeof doc> | null = null
    if (effectiveOldRoomId) {
      oldRoomRef = doc(db, 'camps', campId, 'rooms', effectiveOldRoomId)
      const oldSnap = await tx.get(oldRoomRef)
      if (oldSnap.exists()) {
        oldOccupancy = (oldSnap.data() as { currentOccupancy: number }).currentOccupancy
      } else {
        // Old room doc missing — skip decrement but continue assignment
        oldRoomRef = null
      }
    }

    // ── WRITE PHASE ─────────────────────────────────────────────────────────

    // 4. Decrement old room occupancy (clamp at 0 defensively)
    if (oldRoomRef) {
      tx.update(oldRoomRef, {
        currentOccupancy: Math.max(0, oldOccupancy - 1),
        updatedAt: serverTimestamp(),
      })
    }

    // 5. Update participant
    const participantUpdate: Record<string, unknown> = {
      roomId: newRoomId,
      roomNumber: nr.number,
      roomAssignedBy: uid,
      roomAssignedAt: serverTimestamp(),
      checkInState: 'ARRIVED',
      checkedInBy: uid,
      checkedInAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    }
    if (overrideReason !== null) {
      participantUpdate.roomedWithoutFullPayment = true
      participantUpdate.roomedWithoutFullPaymentNote = overrideReason
    }
    tx.update(pRef(campId, participantId), participantUpdate)

    // 6. Increment new room occupancy
    tx.update(newRoomRef, {
      currentOccupancy: nr.currentOccupancy + 1,
      updatedAt: serverTimestamp(),
    })

    assignedRoomNumber = nr.number
  })

  return assignedRoomNumber
}

// ─── unassign room transaction ────────────────────────────────────────────────
//
// Decrements room occupancy, clears roomId/roomNumber/roomAssignedBy/At on
// participant. Does NOT touch checkInState — unassigning does not undo check-in.

export async function unassignRoom(
  campId: string,
  participantId: string,
  currentRoomId: string,
  uid: string,
): Promise<string> {
  let roomNumber = ''

  await runTransaction(db, async (tx) => {
    // READ
    const roomRef = doc(db, 'camps', campId, 'rooms', currentRoomId)
    const roomSnap = await tx.get(roomRef)

    // WRITE
    if (roomSnap.exists()) {
      const rd = roomSnap.data() as { currentOccupancy: number; number: string }
      roomNumber = rd.number
      tx.update(roomRef, {
        currentOccupancy: Math.max(0, rd.currentOccupancy - 1),
        updatedAt: serverTimestamp(),
      })
    }

    tx.update(pRef(campId, participantId), {
      roomId: deleteField(),
      roomNumber: deleteField(),
      roomAssignedBy: deleteField(),
      roomAssignedAt: deleteField(),
      // checkInState intentionally NOT cleared — per spec
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  })

  return roomNumber
}

// ─── clear override flag ──────────────────────────────────────────────────────
//
// "Mark as resolved" — sets roomedWithoutFullPayment to false.
// The note is preserved for audit. A new updatedAt marks when it was cleared.

export async function clearRoomedWithoutFullPaymentFlag(
  campId: string,
  participantId: string,
  uid: string,
): Promise<void> {
  await updateDoc(pRef(campId, participantId), {
    roomedWithoutFullPayment: false,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}
