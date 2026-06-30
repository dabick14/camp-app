import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Allocation, AllocationRow, PaymentBatch } from '../types'

function allocationsRef(campId: string) {
  return collection(db, 'camps', campId, 'allocations')
}

function allocationRef(campId: string, allocationId: string) {
  return doc(db, 'camps', campId, 'allocations', allocationId)
}

function batchRef(campId: string, batchId: string) {
  return doc(db, 'camps', campId, 'paymentBatches', batchId)
}

function participantRef(campId: string, participantId: string) {
  return doc(db, 'camps', campId, 'participants', participantId)
}

/**
 * Creates allocation docs for all rows in one atomic transaction.
 *
 * INVARIANT: after commit, batch.amountAllocated == sum of all non-voided
 * allocations for that batch. Enforced by doing the full increment in a
 * single transaction with no concurrent writers at this scale.
 *
 * Over-allocation guard: total (new + already allocated) must not exceed
 * amountReceived. Validated inside the transaction so a concurrent write
 * can't slip through.
 */
export async function createAllocations(
  campId: string,
  batchId: string,
  batchReferenceCode: string,
  rows: AllocationRow[],
  uid: string,
): Promise<void> {
  if (rows.length === 0) throw new Error('No rows to allocate')

  const totalNew = rows.reduce((s, r) => s + r.amount, 0)

  // Pre-generate allocation doc refs outside the transaction so we can use
  // tx.set() inside it (auto-id requires a ref, not a collection.add call).
  const allocationRefs = rows.map(() => doc(allocationsRef(campId)))

  await runTransaction(db, async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────────

    const batchSnap = await tx.get(batchRef(campId, batchId))
    if (!batchSnap.exists()) throw new Error('Batch not found')
    const batchData = batchSnap.data() as PaymentBatch

    if (batchData.status !== 'OPEN') {
      throw new Error('Cannot allocate to a reconciled batch. Reopen it first.')
    }

    const remaining = batchData.amountReceived - batchData.amountAllocated
    if (totalNew > remaining) {
      throw new Error(
        `Upload total (${totalNew}) exceeds remaining unallocated balance (${remaining}). ` +
        `Reduce amounts or split across batches.`,
      )
    }

    // Read each participant to get current amountPaid for the increment.
    const participantSnaps = await Promise.all(
      rows.map((r) => tx.get(participantRef(campId, r.participantId))),
    )

    // Validate all participants exist and belong to the batch's sub-group.
    for (let i = 0; i < rows.length; i++) {
      const snap = participantSnaps[i]
      if (!snap.exists()) {
        throw new Error(`Participant ${rows[i].participantId} not found`)
      }
      const pd = snap.data() as { subGroupId: string }
      if (pd.subGroupId !== batchData.subGroupId) {
        throw new Error(
          `Participant ${rows[i].participantName} does not belong to this batch's sub-group.`,
        )
      }
    }

    // ── WRITE PHASE ───────────────────────────────────────────────────────────

    const now = serverTimestamp()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const pSnap = participantSnaps[i]
      const currentPaid = (pSnap.data() as { amountPaid: number }).amountPaid

      // Create allocation doc
      tx.set(allocationRefs[i], {
        batchId,
        batchReferenceCode,
        participantId: row.participantId,
        participantName: row.participantName,
        amount: row.amount,
        createdAt: now,
        createdBy: uid,
        voided: false,
      })

      // Increment participant.amountPaid
      tx.update(participantRef(campId, row.participantId), {
        amountPaid: currentPaid + row.amount,
        updatedAt: now,
        updatedBy: uid,
      })
    }

    // Increment batch.amountAllocated by total of this upload
    tx.update(batchRef(campId, batchId), {
      amountAllocated: batchData.amountAllocated + totalNew,
      updatedAt: now,
      updatedBy: uid,
    })
  })
}

/**
 * Voids a single allocation.
 *
 * INVARIANT: in the same transaction —
 *   - batch.amountAllocated decremented by allocation.amount
 *   - participant.amountPaid decremented by allocation.amount
 *   - if batch was RECONCILED: flip to OPEN AND reset varianceAcknowledged: false
 *     (per spec: void on a reconciled batch re-blocks registration; per invariant:
 *     varianceAcknowledged must reset in the same write)
 */
export async function voidAllocation(
  campId: string,
  allocationId: string,
  reason: string,
  uid: string,
): Promise<void> {
  if (!reason.trim()) throw new Error('A void reason is required')

  await runTransaction(db, async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────────

    const allocSnap = await tx.get(allocationRef(campId, allocationId))
    if (!allocSnap.exists()) throw new Error('Allocation not found')
    const alloc = allocSnap.data() as Allocation
    if (alloc.voided) throw new Error('Allocation is already voided')

    const batchSnap = await tx.get(batchRef(campId, alloc.batchId))
    if (!batchSnap.exists()) throw new Error('Batch not found')
    const batch = batchSnap.data() as PaymentBatch

    const pSnap = await tx.get(participantRef(campId, alloc.participantId))
    if (!pSnap.exists()) throw new Error('Participant not found')
    const currentPaid = (pSnap.data() as { amountPaid: number }).amountPaid

    // ── WRITE PHASE ───────────────────────────────────────────────────────────

    const now = serverTimestamp()

    // Mark allocation voided
    tx.update(allocationRef(campId, allocationId), {
      voided: true,
      voidedBy: uid,
      voidedAt: now,
      voidReason: reason.trim(),
    })

    // Decrement participant.amountPaid (clamp at 0 defensively)
    tx.update(participantRef(campId, alloc.participantId), {
      amountPaid: Math.max(0, currentPaid - alloc.amount),
      updatedAt: now,
      updatedBy: uid,
    })

    // Decrement batch.amountAllocated; if batch was RECONCILED, reopen it
    // and reset varianceAcknowledged in the SAME write (invariant).
    const batchPatch: Record<string, unknown> = {
      amountAllocated: Math.max(0, batch.amountAllocated - alloc.amount),
      updatedAt: now,
      updatedBy: uid,
    }
    if (batch.status === 'RECONCILED') {
      batchPatch.status = 'OPEN'
      batchPatch.varianceAcknowledged = false
      batchPatch.reopenedAt = now
      batchPatch.reopenedBy = uid
    }
    tx.update(batchRef(campId, alloc.batchId), batchPatch)
  })
}

export async function listAllocationsByBatch(campId: string, batchId: string): Promise<Allocation[]> {
  const snap = await getDocs(
    query(allocationsRef(campId), where('batchId', '==', batchId)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Allocation)
}

export async function listAllocationsByParticipant(campId: string, participantId: string): Promise<Allocation[]> {
  const snap = await getDocs(
    query(allocationsRef(campId), where('participantId', '==', participantId)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Allocation)
}
