import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { deleteStoredImage, uploadImageToFolder } from '@/lib/imageUpload'
import type { Ticket, TicketImage, TicketStatus } from '../types'

function ticketsRef(campId: string) {
  return collection(db, 'camps', campId, 'tickets')
}

function ticketRef(campId: string, ticketId: string) {
  return doc(db, 'camps', campId, 'tickets', ticketId)
}

export async function listTickets(campId: string): Promise<Ticket[]> {
  const snap = await getDocs(ticketsRef(campId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ticket)
}

export async function getTicket(campId: string, ticketId: string): Promise<Ticket | null> {
  const snap = await getDoc(ticketRef(campId, ticketId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Ticket
}

export async function createTicket(
  campId: string,
  data: { roomId: string; roomNumber: string; roomTypeName: string; title: string; description: string },
  uid: string,
): Promise<string> {
  const now = Timestamp.now()
  const payload = {
    ...data,
    status: 'OPEN' as TicketStatus,
    statusHistory: [{ status: 'OPEN' as TicketStatus, at: now, by: uid }],
    notes: [],
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
    updatedBy: uid,
  }
  const ref = await addDoc(ticketsRef(campId), payload)
  return ref.id
}

/** Advances (or reopens) a ticket's status, appending to the audit trail. */
export async function transitionTicketStatus(
  campId: string,
  ticketId: string,
  status: TicketStatus,
  uid: string,
): Promise<void> {
  await updateDoc(ticketRef(campId, ticketId), {
    status,
    // serverTimestamp() sentinels aren't allowed inside arrayUnion elements
    statusHistory: arrayUnion({ status, at: Timestamp.now(), by: uid }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

export async function addTicketNote(
  campId: string,
  ticketId: string,
  text: string,
  uid: string,
): Promise<void> {
  await updateDoc(ticketRef(campId, ticketId), {
    notes: arrayUnion({ text, at: Timestamp.now(), by: uid }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

/**
 * Uploads a photo for a ticket (the issue itself, or proof-of-fix) and
 * attaches it to the ticket doc. Same two-step shape as
 * uploadReceiptToBatch — on failure, the caller retries the whole call.
 */
export async function uploadTicketImage(
  campId: string,
  ticketId: string,
  file: File,
  uid: string,
  onProgress?: (pct: number) => void,
): Promise<TicketImage> {
  const image = await uploadImageToFolder(
    `camps/${campId}/tickets/${ticketId}/images`,
    file,
    uid,
    onProgress,
  )

  await updateDoc(ticketRef(campId, ticketId), {
    imageUrls: arrayUnion(image),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })

  return image
}

/** Deletes the Storage object and removes it from the ticket doc's image array. */
export async function removeTicketImage(
  campId: string,
  ticketId: string,
  image: TicketImage,
  uid: string,
): Promise<void> {
  await deleteStoredImage(image.storagePath)

  await updateDoc(ticketRef(campId, ticketId), {
    imageUrls: arrayRemove(image),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}
