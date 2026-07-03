/**
 * Day 5b-ii tests — reconcile-and-confirm transaction + gate UX check.
 *
 * All tests use the Admin SDK against the Firestore emulator (same pattern as
 * payments5b.test.ts). The inline functions mirror the client-side transaction
 * logic in batchService.ts / src/features/participants/types.ts so the Admin
 * SDK (which bypasses rules) can exercise the exact same Firestore paths.
 *
 * INVARIANTS under test:
 *   I3. reconcileAndConfirm is all-or-nothing: either ALL claimed participants
 *       are confirmed (amountPaid = feeOwed) + batch RECONCILED, or nothing changes.
 *   I4. Reconcile-with-variance does NOT confirm any participant.
 *   I5. varianceAcknowledged resets to false in the same write whenever a batch
 *       leaves RECONCILED for OPEN.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

function db() { return getFirestore() }
function uniq() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedCamp(campId: string) {
  await db().doc(`camps/${campId}`).set({
    name: 'Test Camp', location: 'Accra', registrationOpen: true, currency: 'GHS',
  })
}

interface ParticipantOpts {
  feeOwed?: number
  amountPaid?: number
  paymentClaimed?: boolean
  confirmedBatchId?: string
  registrationState?: 'REGISTERED' | 'CANCELLED'
}

async function seedParticipant(
  campId: string,
  pId: string,
  subGroupId: string,
  opts: ParticipantOpts = {},
) {
  await db().doc(`camps/${campId}/participants/${pId}`).set({
    fullName: `Participant ${pId}`,
    phone: `05${Math.floor(Math.random() * 9e7 + 1e7)}`,
    gender: 'M',
    subGroupId,
    subGroupName: 'Test Council',
    roomTypePreferenceId: 'rt1',
    roomTypePreferenceName: 'Standard',
    feeOwed: opts.feeOwed ?? 400,
    amountPaid: opts.amountPaid ?? 0,
    paymentClaimed: opts.paymentClaimed ?? true,
    ...(opts.confirmedBatchId ? { confirmedBatchId: opts.confirmedBatchId } : {}),
    registrationState: opts.registrationState ?? 'REGISTERED',
    checkInState: 'NOT_ARRIVED',
    tags: [],
    source: 'leader',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

async function seedBatch(
  campId: string,
  batchId: string,
  subGroupId: string,
  opts: {
    amountReceived?: number
    amountAllocated?: number
    status?: 'OPEN' | 'RECONCILED'
    varianceAcknowledged?: boolean
  } = {},
) {
  await db().doc(`camps/${campId}/paymentBatches/${batchId}`).set({
    referenceCode: 'TEST-001',
    subGroupId,
    subGroupName: 'Test Council',
    amountReceived: opts.amountReceived ?? 800,
    amountAllocated: opts.amountAllocated ?? 0,
    method: 'MOMO',
    receivedAt: Timestamp.now(),
    receivedBy: 'admin',
    status: opts.status ?? 'OPEN',
    varianceAcknowledged: opts.varianceAcknowledged ?? false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

// ── Inline transaction logic (mirrors batchService.ts reconcileAndConfirm) ────

async function reconcileAndConfirm(
  campId: string,
  batchId: string,
  claimedParticipantIds: string[],
  uid: string,
) {
  if (claimedParticipantIds.length === 0) throw new Error('No claimed participants to confirm')

  await db().runTransaction(async (tx) => {
    const batchSnap = await tx.get(db().doc(`camps/${campId}/paymentBatches/${batchId}`))
    if (!batchSnap.exists) throw new Error('Batch not found')
    const batch = batchSnap.data()!
    if (batch.status !== 'OPEN') throw new Error('Batch is not OPEN')

    const pSnaps = await Promise.all(
      claimedParticipantIds.map((id) => tx.get(db().doc(`camps/${campId}/participants/${id}`))),
    )

    let expectedSum = 0
    for (let i = 0; i < pSnaps.length; i++) {
      const snap = pSnaps[i]
      if (!snap.exists) throw new Error(`Participant ${claimedParticipantIds[i]} not found`)
      const p = snap.data()!
      if (p.subGroupId !== batch.subGroupId) {
        throw new Error(`Participant ${claimedParticipantIds[i]} belongs to a different sub-group`)
      }
      if (!p.paymentClaimed) {
        throw new Error(`Participant ${claimedParticipantIds[i]} is no longer claimed`)
      }
      if (p.confirmedBatchId) {
        throw new Error(`Participant ${claimedParticipantIds[i]} is already confirmed`)
      }
      expectedSum += p.feeOwed as number
    }

    if (expectedSum !== (batch.amountReceived as number)) {
      throw new Error(
        `Amount mismatch: expected ${expectedSum} but received ${batch.amountReceived}`,
      )
    }

    const now = FieldValue.serverTimestamp()
    for (let i = 0; i < pSnaps.length; i++) {
      const p = pSnaps[i].data()!
      tx.update(db().doc(`camps/${campId}/participants/${claimedParticipantIds[i]}`), {
        amountPaid: p.feeOwed,
        confirmedAt: now,
        confirmedBy: uid,
        confirmedBatchId: batchId,
        updatedAt: now,
        updatedBy: uid,
      })
    }

    tx.update(db().doc(`camps/${campId}/paymentBatches/${batchId}`), {
      status: 'RECONCILED',
      amountAllocated: batch.amountReceived,
      updatedAt: now,
      updatedBy: uid,
    })
  })
}

async function reconcileWithVariance(
  campId: string,
  batchId: string,
  varianceNote: string,
  uid: string,
) {
  await db().doc(`camps/${campId}/paymentBatches/${batchId}`).update({
    status: 'RECONCILED',
    varianceAcknowledged: true,
    varianceNote,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  })
}

async function reopenBatchGuarded(campId: string, batchId: string, uid: string) {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(db().doc(`camps/${campId}/paymentBatches/${batchId}`))
    if (!snap.exists) throw new Error('Batch not found')
    if (snap.data()!.status !== 'RECONCILED') throw new Error('Batch is not reconciled — cannot reopen')
    tx.update(db().doc(`camps/${campId}/paymentBatches/${batchId}`), {
      status: 'OPEN',
      varianceAcknowledged: false,
      reopenedAt: FieldValue.serverTimestamp(),
      reopenedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    })
  })
}

// Mirrors derivePaymentState from src/features/participants/types.ts
function paymentState(feeOwed: number, amountPaid: number): string {
  if (feeOwed === 0) return 'WAIVED'
  if (amountPaid >= feeOwed) return 'PAID'
  if (amountPaid > 0) return 'PARTIAL'
  return 'PENDING'
}

// Mirrors isSubGroupGated from batchService.ts — admin SDK version
async function isSubGroupGated(campId: string, subGroupId: string): Promise<boolean> {
  const snap = await db()
    .collection(`camps/${campId}/paymentBatches`)
    .where('subGroupId', '==', subGroupId)
    .where('status', '==', 'OPEN')
    .get()
  return snap.docs.some((d) => {
    const b = d.data()
    return (b.amountReceived as number) - (b.amountAllocated as number) > 0
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Clean match — Reconcile & Confirm
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileAndConfirm — clean match', () => {
  it('confirms all claimed participants as PAID and marks batch RECONCILED', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { amountReceived: 800 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })
    await seedParticipant(campId, p2, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    await reconcileAndConfirm(campId, batchId, [p1, p2], 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('RECONCILED')
    expect(batchSnap.data()!.amountAllocated).toBe(800)

    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const p2Snap = await db().doc(`camps/${campId}/participants/${p2}`).get()

    // amountPaid set to feeOwed → PAID
    expect(p1Snap.data()!.amountPaid).toBe(400)
    expect(p2Snap.data()!.amountPaid).toBe(400)

    // Audit fields set
    expect(p1Snap.data()!.confirmedBatchId).toBe(batchId)
    expect(p1Snap.data()!.confirmedBy).toBe('admin')
    expect(p1Snap.data()!.confirmedAt).toBeDefined()
    expect(p2Snap.data()!.confirmedBatchId).toBe(batchId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Roomability flips after confirmation
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileAndConfirm — roomability', () => {
  it('participant is NOT roomable before confirm and IS roomable after', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { amountReceived: 500 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 500, amountPaid: 0, paymentClaimed: true })

    // Before: not roomable
    const before = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const d = before.data()!
    expect(paymentState(d.feeOwed, d.amountPaid)).toBe('PENDING')

    await reconcileAndConfirm(campId, batchId, [p1], 'admin')

    // After: PAID → roomable
    const after = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const d2 = after.data()!
    expect(paymentState(d2.feeOwed, d2.amountPaid)).toBe('PAID')
    // Gate: PAID and WAIVED are roomable without override; PENDING/PARTIAL are not
    const roomable = paymentState(d2.feeOwed, d2.amountPaid) === 'PAID' ||
                     paymentState(d2.feeOwed, d2.amountPaid) === 'WAIVED'
    expect(roomable).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Short / over lump — Reconcile & Confirm blocked
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileAndConfirm — amount mismatch', () => {
  it('rejects when Σ feeOwed < amountReceived (short); no participant confirmed; batch stays OPEN', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    // Received 1000 but participant only owes 400 — short by 600
    await seedBatch(campId, batchId, sgId, { amountReceived: 1000 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    await expect(reconcileAndConfirm(campId, batchId, [p1], 'admin')).rejects.toThrow('mismatch')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('OPEN')

    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)
    expect(p1Snap.data()!.confirmedBatchId).toBeUndefined()
  })

  it('rejects when Σ feeOwed > amountReceived (over); no participant confirmed; batch stays OPEN', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`

    await seedCamp(campId)
    // Two participants (400 + 400 = 800) but batch only received 600 — over the lump
    await seedBatch(campId, batchId, sgId, { amountReceived: 600 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })
    await seedParticipant(campId, p2, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    await expect(reconcileAndConfirm(campId, batchId, [p1, p2], 'admin')).rejects.toThrow('mismatch')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('OPEN')

    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const p2Snap = await db().doc(`camps/${campId}/participants/${p2}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)
    expect(p2Snap.data()!.amountPaid).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Reconcile-with-variance does NOT confirm participants
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileWithVariance — does not confirm participants', () => {
  it('sets RECONCILED + varianceAcknowledged but leaves all participants unconfirmed', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { amountReceived: 1000 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })
    await seedParticipant(campId, p2, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    await reconcileWithVariance(campId, batchId, '₵200 kept as contingency', 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('RECONCILED')
    expect(batchSnap.data()!.varianceAcknowledged).toBe(true)
    expect(batchSnap.data()!.varianceNote).toBe('₵200 kept as contingency')

    // Participants NOT confirmed — INVARIANT I4
    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const p2Snap = await db().doc(`camps/${campId}/participants/${p2}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)
    expect(p2Snap.data()!.amountPaid).toBe(0)
    expect(p1Snap.data()!.confirmedBatchId).toBeUndefined()
    expect(p2Snap.data()!.confirmedBatchId).toBeUndefined()

    // Still unroomable (PENDING)
    const d1 = p1Snap.data()!
    expect(paymentState(d1.feeOwed, d1.amountPaid)).toBe('PENDING')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Reopen — guard, audit, double-reopen rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('reopenBatch — guards and invariants', () => {
  it('clears varianceAcknowledged and sets reopenedAt/reopenedBy (INVARIANT I5)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, {
      status: 'RECONCILED',
      varianceAcknowledged: true,
    })

    await reopenBatchGuarded(campId, batchId, 'admin')

    const snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.status).toBe('OPEN')
    expect(snap.data()!.varianceAcknowledged).toBe(false) // INVARIANT I5
    expect(snap.data()!.reopenedAt).toBeDefined()
    expect(snap.data()!.reopenedBy).toBe('admin')
  })

  it('rejects reopen on an already-OPEN batch (double-reopen)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { status: 'OPEN' })

    await expect(reopenBatchGuarded(campId, batchId, 'admin')).rejects.toThrow('not reconciled')
  })

  it('double-reopen sequence: reconcile → reopen → reopen again is rejected', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { status: 'RECONCILED' })

    await reopenBatchGuarded(campId, batchId, 'admin')  // first reopen: OK
    await expect(reopenBatchGuarded(campId, batchId, 'admin')).rejects.toThrow('not reconciled')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Atomicity — mid-transaction failure rolls back entirely
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileAndConfirm — atomicity', () => {
  it('rolls back if a participant ID in the list does not exist — no half-confirmed sub-group', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`
    const ghost = `ghost-${s}` // does NOT exist in Firestore

    await seedCamp(campId)
    // Batch received 800 — would match 400+400 but the ghost has no doc
    await seedBatch(campId, batchId, sgId, { amountReceived: 800 })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    // Pass both: p1 (valid) + ghost (missing) — transaction must abort
    await expect(
      reconcileAndConfirm(campId, batchId, [p1, ghost], 'admin'),
    ).rejects.toThrow('not found')

    // p1 must be untouched — Firestore transaction guarantee
    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)
    expect(p1Snap.data()!.confirmedBatchId).toBeUndefined()

    // Batch must still be OPEN
    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('OPEN')
  })

  it('rolls back if batch is already RECONCILED when transaction executes', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    // Batch already RECONCILED — guard should reject
    await seedBatch(campId, batchId, sgId, { amountReceived: 400, status: 'RECONCILED' })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    await expect(reconcileAndConfirm(campId, batchId, [p1], 'admin')).rejects.toThrow('not OPEN')

    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Gate UX — isSubGroupGated scoped check
// ─────────────────────────────────────────────────────────────────────────────

describe('isSubGroupGated — gate UX helper', () => {
  it('returns true when sub-group has an OPEN batch with unallocated balance', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    // amountReceived=500, amountAllocated=0 → unallocated balance=500 > 0 → gated
    await seedBatch(campId, batchId, sgId, { amountReceived: 500, amountAllocated: 0, status: 'OPEN' })

    expect(await isSubGroupGated(campId, sgId)).toBe(true)
  })

  it('returns false when the only OPEN batch is fully allocated (balance=0)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    // amountReceived=500, amountAllocated=500 → balance=0 → not gated
    await seedBatch(campId, batchId, sgId, { amountReceived: 500, amountAllocated: 500, status: 'OPEN' })

    expect(await isSubGroupGated(campId, sgId)).toBe(false)
  })

  it('returns false when the only batch is RECONCILED (even with unallocated balance)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    // RECONCILED batch does not gate registration
    await seedBatch(campId, batchId, sgId, { amountReceived: 500, amountAllocated: 200, status: 'RECONCILED' })

    expect(await isSubGroupGated(campId, sgId)).toBe(false)
  })

  it('returns false for a different sub-group that has no batches', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`
    const sgA = `sgA-${s}`, sgB = `sgB-${s}`

    await seedCamp(campId)
    // sgA has an OPEN batch with balance — sgB does not
    await seedBatch(campId, batchId, sgA, { amountReceived: 500, amountAllocated: 0, status: 'OPEN' })

    expect(await isSubGroupGated(campId, sgA)).toBe(true)
    expect(await isSubGroupGated(campId, sgB)).toBe(false) // sgB is unrelated
  })

  it('gate clears after batch is RECONCILED via reconcileAndConfirm', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, { amountReceived: 400, amountAllocated: 0, status: 'OPEN' })
    await seedParticipant(campId, p1, sgId, { feeOwed: 400, amountPaid: 0, paymentClaimed: true })

    // Gated before confirm
    expect(await isSubGroupGated(campId, sgId)).toBe(true)

    await reconcileAndConfirm(campId, batchId, [p1], 'admin')

    // Not gated after confirm
    expect(await isSubGroupGated(campId, sgId)).toBe(false)
  })
})
