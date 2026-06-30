import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { generateReferenceCode } from '../types'
import type { PaymentBatch, PaymentMethod } from '../types'

function batchesRef(campId: string) {
  return collection(db, 'camps', campId, 'paymentBatches')
}

function batchRef(campId: string, batchId: string) {
  return doc(db, 'camps', campId, 'paymentBatches', batchId)
}

export async function listBatches(campId: string): Promise<PaymentBatch[]> {
  const snap = await getDocs(batchesRef(campId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PaymentBatch)
}

export interface CreateBatchInput {
  subGroupId: string
  subGroupName: string
  amountReceived: number
  method: PaymentMethod
  externalReference?: string
  receivedAt: Date
  notes?: string
}

export async function createBatch(
  campId: string,
  input: CreateBatchInput,
  uid: string,
): Promise<string> {
  // Count all existing batches in the camp to derive the next sequence number.
  // Races are acceptable for v1 (single admin); worst case is a duplicate suffix
  // that can be manually corrected.
  const existingSnap = await getDocs(batchesRef(campId))
  const seq = existingSnap.size + 1

  const referenceCode = generateReferenceCode(input.subGroupName, seq)

  const payload = {
    referenceCode,
    subGroupId: input.subGroupId,
    subGroupName: input.subGroupName,
    amountReceived: input.amountReceived,
    amountAllocated: 0,
    method: input.method,
    ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    receivedAt: Timestamp.fromDate(input.receivedAt),
    receivedBy: uid,
    ...(input.notes ? { notes: input.notes } : {}),
    status: 'OPEN' as const,
    varianceAcknowledged: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const ref = await addDoc(batchesRef(campId), payload)
  return ref.id
}

export interface UpdateBatchInput {
  method?: PaymentMethod
  externalReference?: string
  receivedAt?: Date
  notes?: string
  /** Only allowed if amountAllocated === 0 */
  amountReceived?: number
}

export async function updateBatchMetadata(
  campId: string,
  batchId: string,
  input: UpdateBatchInput,
  uid: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }
  if (input.method !== undefined) patch.method = input.method
  if (input.receivedAt !== undefined) patch.receivedAt = Timestamp.fromDate(input.receivedAt)
  if (input.notes !== undefined) patch.notes = input.notes || null
  if (input.externalReference !== undefined) patch.externalReference = input.externalReference || null
  if (input.amountReceived !== undefined) patch.amountReceived = input.amountReceived

  await updateDoc(batchRef(campId, batchId), patch)
}

export async function markReconciled(
  campId: string,
  batchId: string,
  uid: string,
): Promise<void> {
  await updateDoc(batchRef(campId, batchId), {
    status: 'RECONCILED',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

/**
 * Reconciles a batch with a known variance (allocated ≠ received).
 * Sets varianceAcknowledged: true so it is clear the admin explicitly accepted
 * the discrepancy. Requires a note explaining the variance.
 */
export async function reconcileWithVariance(
  campId: string,
  batchId: string,
  varianceNote: string,
  uid: string,
): Promise<void> {
  if (!varianceNote.trim()) throw new Error('A variance note is required')
  await updateDoc(batchRef(campId, batchId), {
    status: 'RECONCILED',
    varianceAcknowledged: true,
    varianceNote: varianceNote.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

/**
 * Reopens a RECONCILED batch.
 *
 * Guard: only acts if batch is currently RECONCILED; throws if already OPEN.
 * INVARIANT: clears varianceAcknowledged: false in the same write, so the
 * field is never stale-true on an open batch.
 */
export async function reopenBatch(
  campId: string,
  batchId: string,
  uid: string,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(batchRef(campId, batchId))
    if (!snap.exists()) throw new Error('Batch not found')
    if (snap.data()!.status !== 'RECONCILED') {
      throw new Error('Batch is not reconciled — cannot reopen')
    }
    tx.update(batchRef(campId, batchId), {
      status: 'OPEN',
      varianceAcknowledged: false,
      reopenedAt: serverTimestamp(),
      reopenedBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  })
}
