import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  query,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { generateReferenceCode } from '../types'
import type { PaymentBatch, PaymentMethod } from '../types'
import type { Participant } from '@/features/participants/types'

function batchesRef(campId: string) {
  return collection(db, 'camps', campId, 'paymentBatches')
}

function batchRef(campId: string, batchId: string) {
  return doc(db, 'camps', campId, 'paymentBatches', batchId)
}

function participantRef(campId: string, participantId: string) {
  return doc(db, 'camps', campId, 'participants', participantId)
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

/**
 * Reconciles a batch with a known variance (claimed sum ≠ received).
 * Sets varianceAcknowledged: true. Does NOT confirm any participants — they
 * remain claimed-but-unconfirmed and therefore unroomable. Use the per-person
 * override (Day 4c) if you must room someone before the variance is resolved.
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
 * Reconciles an OPEN batch and confirms all claimed-but-unconfirmed participants
 * in the batch's sub-group as PAID, in a single atomic transaction.
 *
 * Guards:
 * - Batch must be OPEN
 * - Every ID in claimedParticipantIds must exist, belong to the batch's
 *   sub-group, still be claimed, and not yet confirmed
 * - Σ feeOwed of those participants must exactly equal batch.amountReceived
 *
 * On success:
 * - Each participant gets amountPaid = feeOwed, confirmedAt, confirmedBy,
 *   confirmedBatchId (making them PAID via the existing derivePaymentState)
 * - Batch gets status = 'RECONCILED', amountAllocated = amountReceived
 *
 * Un-confirming confirmed participants is out of scope for v1 (Phase 2).
 */
export async function reconcileAndConfirm(
  campId: string,
  batchId: string,
  claimedParticipantIds: string[],
  uid: string,
): Promise<void> {
  if (claimedParticipantIds.length === 0) {
    throw new Error('No claimed participants to confirm')
  }

  await runTransaction(db, async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────────
    const batchSnap = await tx.get(batchRef(campId, batchId))
    if (!batchSnap.exists()) throw new Error('Batch not found')
    const batchData = batchSnap.data() as PaymentBatch
    if (batchData.status !== 'OPEN') throw new Error('Batch is not OPEN')

    const participantSnaps = await Promise.all(
      claimedParticipantIds.map((id) => tx.get(participantRef(campId, id))),
    )

    let expectedSum = 0
    for (let i = 0; i < participantSnaps.length; i++) {
      const snap = participantSnaps[i]
      if (!snap.exists()) {
        throw new Error(`Participant ${claimedParticipantIds[i]} not found`)
      }
      const p = snap.data() as Participant
      if (p.subGroupId !== batchData.subGroupId) {
        throw new Error(`Participant ${claimedParticipantIds[i]} belongs to a different sub-group`)
      }
      if (!p.paymentClaimed) {
        throw new Error(`Participant ${claimedParticipantIds[i]} is no longer claimed`)
      }
      if (p.confirmedBatchId) {
        throw new Error(`Participant ${claimedParticipantIds[i]} is already confirmed`)
      }
      expectedSum += p.feeOwed
    }

    if (expectedSum !== batchData.amountReceived) {
      throw new Error(
        `Amount mismatch: claimed participants owe ${expectedSum} but batch received ${batchData.amountReceived}. ` +
          `Use "Reconcile with Variance" instead.`,
      )
    }

    // ── WRITE PHASE ───────────────────────────────────────────────────────────
    const now = serverTimestamp()
    for (let i = 0; i < participantSnaps.length; i++) {
      const p = participantSnaps[i].data() as Participant
      tx.update(participantRef(campId, claimedParticipantIds[i]), {
        amountPaid: p.feeOwed,
        confirmedAt: now,
        confirmedBy: uid,
        confirmedBatchId: batchId,
        updatedAt: now,
        updatedBy: uid,
      })
    }

    tx.update(batchRef(campId, batchId), {
      status: 'RECONCILED',
      amountAllocated: batchData.amountReceived,
      updatedAt: now,
      updatedBy: uid,
    })
  })
}

/**
 * Reopens a RECONCILED batch.
 *
 * Guard: only acts if batch is currently RECONCILED; throws if already OPEN.
 * INVARIANT: clears varianceAcknowledged: false in the same write, so the
 * field is never stale-true on an open batch.
 * NOTE: confirmed participants are NOT un-confirmed when a batch is reopened —
 * un-confirming is out of scope for v1 (Phase 2).
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

/**
 * Returns true if the sub-group's registration is currently gated:
 * i.e. it has at least one OPEN batch with unallocated balance > 0.
 * Mirrors the server-side gate in leaderRegisterParticipant (which is the
 * authoritative integrity check). This is a client-side pre-check for UX only.
 */
export async function isSubGroupGated(campId: string, subGroupId: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      batchesRef(campId),
      where('subGroupId', '==', subGroupId),
      where('status', '==', 'OPEN'),
    ),
  )
  return snap.docs.some((d) => {
    const b = d.data()
    return (b.amountReceived as number) - (b.amountAllocated as number) > 0
  })
}
