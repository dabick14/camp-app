/**
 * Day 5b tests — allocation transactions, void, variance reconcile, gate loop.
 *
 * All tests use the Admin SDK against the Firestore emulator.
 * The Admin SDK is the same SDK used by Cloud Functions, so these tests
 * exercise the exact same Firestore paths the production code runs through,
 * without importing any client-SDK service code.
 *
 * INVARIANTS under test (must never be violated):
 *   I1. batch.amountAllocated == sum of non-voided allocations for that batch
 *   I2. varianceAcknowledged resets to false whenever a batch leaves RECONCILED
 *       for OPEN — in the SAME write
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { leaderRegisterParticipant } from './leaderRegisterParticipant'

// ── Admin SDK helpers ─────────────────────────────────────────────────────────

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

async function seedRoomType(campId: string, rtId: string, price = 400) {
  await db().doc(`camps/${campId}/roomTypes/${rtId}`).set({ name: 'Standard', price })
}

async function seedParticipant(
  campId: string,
  pId: string,
  subGroupId: string,
  subGroupName: string,
  feeOwed = 400,
  amountPaid = 0,
) {
  await db().doc(`camps/${campId}/participants/${pId}`).set({
    fullName: `Participant ${pId}`,
    phone: `05${Math.floor(Math.random() * 9e7 + 1e7)}`,
    gender: 'M',
    subGroupId,
    subGroupName,
    roomTypePreferenceId: 'rt1',
    roomTypePreferenceName: 'Standard',
    feeOwed,
    amountPaid,
    registrationState: 'REGISTERED',
    checkInState: 'NOT_ARRIVED',
    tags: [],
    roomedWithoutFullPayment: false,
    source: 'admin',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

async function seedBatch(
  campId: string,
  batchId: string,
  subGroupId: string,
  subGroupName: string,
  opts: {
    amountReceived?: number
    amountAllocated?: number
    status?: 'OPEN' | 'RECONCILED'
    varianceAcknowledged?: boolean
  } = {},
) {
  await db().doc(`camps/${campId}/paymentBatches/${batchId}`).set({
    referenceCode: `TEST-001`,
    subGroupId,
    subGroupName,
    amountReceived: opts.amountReceived ?? 1000,
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

async function seedAllocation(
  campId: string,
  allocId: string,
  batchId: string,
  participantId: string,
  amount: number,
  voided = false,
) {
  await db().doc(`camps/${campId}/allocations/${allocId}`).set({
    batchId,
    batchReferenceCode: 'TEST-001',
    participantId,
    participantName: `Participant ${participantId}`,
    amount,
    createdAt: Timestamp.now(),
    createdBy: 'admin',
    voided,
  })
}

// ── Inline transaction logic (mirrors client allocationService.ts) ─────────────
// Tests exercise the business logic using Admin SDK transactions directly.

async function createAllocations(
  campId: string,
  batchId: string,
  batchReferenceCode: string,
  rows: Array<{ participantId: string; participantName: string; amount: number }>,
  uid: string,
) {
  if (rows.length === 0) throw new Error('No rows')
  const totalNew = rows.reduce((s, r) => s + r.amount, 0)
  const allocationRefs = rows.map(() => db().collection(`camps/${campId}/allocations`).doc())

  await db().runTransaction(async (tx) => {
    const batchSnap = await tx.get(db().doc(`camps/${campId}/paymentBatches/${batchId}`))
    if (!batchSnap.exists) throw new Error('Batch not found')
    const batchData = batchSnap.data()!
    if (batchData.status !== 'OPEN') throw new Error('Batch is not OPEN')
    const remaining = (batchData.amountReceived as number) - (batchData.amountAllocated as number)
    if (totalNew > remaining) throw new Error(`Over-allocation: ${totalNew} > ${remaining}`)

    const pSnaps = await Promise.all(
      rows.map((r) => tx.get(db().doc(`camps/${campId}/participants/${r.participantId}`))),
    )
    for (let i = 0; i < rows.length; i++) {
      if (!pSnaps[i].exists) throw new Error(`Participant ${rows[i].participantId} not found`)
      const pd = pSnaps[i].data()!
      if (pd.subGroupId !== batchData.subGroupId) throw new Error('Sub-group mismatch')
    }

    const now = FieldValue.serverTimestamp()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const currentPaid = (pSnaps[i].data()!.amountPaid as number)
      tx.set(allocationRefs[i], {
        batchId, batchReferenceCode,
        participantId: row.participantId,
        participantName: row.participantName,
        amount: row.amount,
        createdAt: now, createdBy: uid, voided: false,
      })
      tx.update(db().doc(`camps/${campId}/participants/${row.participantId}`), {
        amountPaid: currentPaid + row.amount,
        updatedAt: now, updatedBy: uid,
      })
    }
    tx.update(db().doc(`camps/${campId}/paymentBatches/${batchId}`), {
      amountAllocated: (batchData.amountAllocated as number) + totalNew,
      updatedAt: now, updatedBy: uid,
    })
  })
}

async function voidAlloc(campId: string, allocId: string, reason: string, uid: string) {
  await db().runTransaction(async (tx) => {
    const allocSnap = await tx.get(db().doc(`camps/${campId}/allocations/${allocId}`))
    if (!allocSnap.exists) throw new Error('Allocation not found')
    const alloc = allocSnap.data()!
    if (alloc.voided) throw new Error('Already voided')

    const batchSnap = await tx.get(db().doc(`camps/${campId}/paymentBatches/${alloc.batchId}`))
    if (!batchSnap.exists) throw new Error('Batch not found')
    const batch = batchSnap.data()!

    const pSnap = await tx.get(db().doc(`camps/${campId}/participants/${alloc.participantId}`))
    if (!pSnap.exists) throw new Error('Participant not found')
    const currentPaid = (pSnap.data()!.amountPaid as number)

    const now = FieldValue.serverTimestamp()
    tx.update(db().doc(`camps/${campId}/allocations/${allocId}`), {
      voided: true, voidedBy: uid, voidedAt: now, voidReason: reason,
    })
    tx.update(db().doc(`camps/${campId}/participants/${alloc.participantId}`), {
      amountPaid: Math.max(0, currentPaid - (alloc.amount as number)),
      updatedAt: now, updatedBy: uid,
    })
    const batchPatch: Record<string, unknown> = {
      amountAllocated: Math.max(0, (batch.amountAllocated as number) - (alloc.amount as number)),
      updatedAt: now, updatedBy: uid,
    }
    // INVARIANT I2: varianceAcknowledged resets in the same write as status flip
    if (batch.status === 'RECONCILED') {
      batchPatch.status = 'OPEN'
      batchPatch.varianceAcknowledged = false
      batchPatch.reopenedAt = now
      batchPatch.reopenedBy = uid
    }
    tx.update(db().doc(`camps/${campId}/paymentBatches/${alloc.batchId}`), batchPatch)
  })
}

async function reconcileWithVariance(
  campId: string, batchId: string, varianceNote: string, uid: string,
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

// ── Helper: sum non-voided allocations from Firestore ─────────────────────────
async function sumActiveAllocations(campId: string, batchId: string): Promise<number> {
  const snap = await db()
    .collection(`camps/${campId}/allocations`)
    .where('batchId', '==', batchId)
    .where('voided', '==', false)
    .get()
  return snap.docs.reduce((s, d) => s + (d.data().amount as number), 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A — Allocation upload transaction
// ─────────────────────────────────────────────────────────────────────────────

describe('createAllocations — transaction', () => {
  it('creates allocation docs, increments participant amountPaid, increments batch amountAllocated', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'Test Council', { amountReceived: 1000, amountAllocated: 0 })
    await seedParticipant(campId, p1, sgId, 'Test Council', 400, 0)
    await seedParticipant(campId, p2, sgId, 'Test Council', 600, 0)

    await createAllocations(campId, batchId, 'TEST-001', [
      { participantId: p1, participantName: 'P1', amount: 300 },
      { participantId: p2, participantName: 'P2', amount: 400 },
    ], 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    const p2Snap = await db().doc(`camps/${campId}/participants/${p2}`).get()

    expect(batchSnap.data()!.amountAllocated).toBe(700)
    expect(p1Snap.data()!.amountPaid).toBe(300)
    expect(p2Snap.data()!.amountPaid).toBe(400)

    // INVARIANT I1
    const activeSum = await sumActiveAllocations(campId, batchId)
    expect(activeSum).toBe(batchSnap.data()!.amountAllocated)
  })

  it('appends to an existing amountAllocated correctly', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 300 })
    await seedParticipant(campId, p1, sgId, 'TC', 700, 300)
    // Seed the existing allocation so I1 holds
    await seedAllocation(campId, `a1-${s}`, batchId, p1, 300)

    await createAllocations(campId, batchId, 'TEST-001', [
      { participantId: p1, participantName: 'P1', amount: 200 },
    ], 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.amountAllocated).toBe(500)
    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(500)

    const activeSum = await sumActiveAllocations(campId, batchId)
    expect(activeSum).toBe(500) // I1
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Over-allocation guard
// ─────────────────────────────────────────────────────────────────────────────

describe('createAllocations — over-allocation guard', () => {
  it('rejects when totalNew > remaining balance, writes nothing', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 800 })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 0)

    await expect(
      createAllocations(campId, batchId, 'TEST-001', [
        { participantId: p1, participantName: 'P1', amount: 300 }, // 800+300=1100 > 1000
      ], 'admin'),
    ).rejects.toThrow('Over-allocation')

    // Nothing written — batch unchanged, participant unchanged
    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(batchSnap.data()!.amountAllocated).toBe(800)
    expect(p1Snap.data()!.amountPaid).toBe(0)
  })

  it('rejects cross-sub-group allocation (hard error, nothing written)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgA = `sgA-${s}`, sgB = `sgB-${s}`
    const wrongP = `wp-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgA, 'Council A', { amountReceived: 1000 })
    // Participant belongs to sgB, not sgA
    await seedParticipant(campId, wrongP, sgB, 'Council B')

    await expect(
      createAllocations(campId, batchId, 'TEST-001', [
        { participantId: wrongP, participantName: 'Wrong', amount: 100 },
      ], 'admin'),
    ).rejects.toThrow('Sub-group mismatch')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.amountAllocated).toBe(0) // rolled back
  })

  it('rejects allocation to a RECONCILED batch', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { status: 'RECONCILED', amountReceived: 1000, amountAllocated: 1000 })
    await seedParticipant(campId, p1, sgId, 'TC')

    await expect(
      createAllocations(campId, batchId, 'TEST-001', [
        { participantId: p1, participantName: 'P1', amount: 100 },
      ], 'admin'),
    ).rejects.toThrow('not OPEN')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PART B — Void allocation
// ─────────────────────────────────────────────────────────────────────────────

describe('voidAllocation — transaction', () => {
  it('marks allocation voided, decrements participant.amountPaid, decrements batch.amountAllocated', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, allocId = `a1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 300, status: 'OPEN' })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 300)
    await seedAllocation(campId, allocId, batchId, p1, 300)

    await voidAlloc(campId, allocId, 'Test void reason', 'admin')

    const allocSnap = await db().doc(`camps/${campId}/allocations/${allocId}`).get()
    expect(allocSnap.data()!.voided).toBe(true)
    expect(allocSnap.data()!.voidReason).toBe('Test void reason')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.amountAllocated).toBe(0)

    const p1Snap = await db().doc(`camps/${campId}/participants/${p1}`).get()
    expect(p1Snap.data()!.amountPaid).toBe(0)

    // I1: sum of non-voided allocations == amountAllocated
    const activeSum = await sumActiveAllocations(campId, batchId)
    expect(activeSum).toBe(batchSnap.data()!.amountAllocated) // both 0
  })

  it('INVARIANT I2: voiding on a RECONCILED batch flips to OPEN AND resets varianceAcknowledged: false in the same write', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, allocId = `a1-${s}`

    await seedCamp(campId)
    // Batch is RECONCILED with varianceAcknowledged: true
    await seedBatch(campId, batchId, sgId, 'TC', {
      amountReceived: 1000, amountAllocated: 300,
      status: 'RECONCILED', varianceAcknowledged: true,
    })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 300)
    await seedAllocation(campId, allocId, batchId, p1, 300)

    await voidAlloc(campId, allocId, 'void reason', 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.status).toBe('OPEN')
    expect(batchSnap.data()!.varianceAcknowledged).toBe(false) // INVARIANT I2
    expect(batchSnap.data()!.amountAllocated).toBe(0)
  })

  it('prevents double-void', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, allocId = `a1-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 0 })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 0)
    // Pre-seed as already voided
    await seedAllocation(campId, allocId, batchId, p1, 300, true)

    await expect(voidAlloc(campId, allocId, 'reason', 'admin')).rejects.toThrow('Already voided')
  })

  it('INVARIANT I1: amountAllocated equals sum of non-voided allocations after partial void', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`
    const a1 = `a1-${s}`, a2 = `a2-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 700 })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 300)
    await seedParticipant(campId, p2, sgId, 'TC', 400, 400)
    await seedAllocation(campId, a1, batchId, p1, 300)
    await seedAllocation(campId, a2, batchId, p2, 400)

    await voidAlloc(campId, a1, 'reason', 'admin')

    const batchSnap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchSnap.data()!.amountAllocated).toBe(400)

    const activeSum = await sumActiveAllocations(campId, batchId)
    expect(activeSum).toBe(400) // I1
    expect(activeSum).toBe(batchSnap.data()!.amountAllocated)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PART C — Variance reconcile + reopen guard
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileWithVariance', () => {
  it('sets status=RECONCILED and varianceAcknowledged=true', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 700 })

    await reconcileWithVariance(campId, batchId, 'Remaining kept as contingency', 'admin')

    const snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.status).toBe('RECONCILED')
    expect(snap.data()!.varianceAcknowledged).toBe(true)
    expect(snap.data()!.varianceNote).toBe('Remaining kept as contingency')
  })
})

describe('reopenBatch — guard', () => {
  it('rejects reopen on an already-OPEN batch', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', { status: 'OPEN' })

    await expect(reopenBatchGuarded(campId, batchId, 'admin'))
      .rejects.toThrow('not reconciled')
  })

  it('clears varianceAcknowledged: false when reopening a RECONCILED batch', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`

    await seedCamp(campId)
    await seedBatch(campId, batchId, sgId, 'TC', {
      status: 'RECONCILED', varianceAcknowledged: true,
    })

    await reopenBatchGuarded(campId, batchId, 'admin')

    const snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.status).toBe('OPEN')
    expect(snap.data()!.varianceAcknowledged).toBe(false) // INVARIANT I2
  })
})

describe('stale-varianceAcknowledged sequence (the full diagnosis scenario)', () => {
  it('ends with varianceAcknowledged=false after: variance-reconcile → void → clean re-reconcile', async () => {
    const s = uniq()
    const campId = `camp-${s}`, batchId = `batch-${s}`, sgId = `sg-${s}`
    const p1 = `p1-${s}`, p2 = `p2-${s}`
    const a1 = `a1-${s}`, a2 = `a2-${s}`

    await seedCamp(campId)
    // Batch: received=1000, allocated=0
    await seedBatch(campId, batchId, sgId, 'TC', { amountReceived: 1000, amountAllocated: 0 })
    await seedParticipant(campId, p1, sgId, 'TC', 400, 0)
    await seedParticipant(campId, p2, sgId, 'TC', 300, 0)

    // Step 1: upload allocations — p1=300, p2=400 → total=700, remaining=300
    await createAllocations(campId, batchId, 'TEST-001', [
      { participantId: p1, participantName: 'P1', amount: 300 },
      { participantId: p2, participantName: 'P2', amount: 400 },
    ], 'admin')

    // Fetch the auto-generated allocation IDs
    const allocSnap = await db()
      .collection(`camps/${campId}/allocations`)
      .where('batchId', '==', batchId)
      .get()
    const [firstAlloc, secondAlloc] = allocSnap.docs.sort(
      (a, b) => (a.data().amount as number) - (b.data().amount as number),
    ) // order by amount: 300 first, 400 second

    // Step 2: reconcile with variance (300 unallocated)
    await reconcileWithVariance(campId, batchId, 'Variance kept', 'admin')
    let snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.varianceAcknowledged).toBe(true)

    // Step 3: void one allocation (p1's 300) → batch should flip to OPEN + varianceAcknowledged=false
    await voidAlloc(campId, firstAlloc.id, 'void reason', 'admin')
    snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.status).toBe('OPEN')
    expect(snap.data()!.varianceAcknowledged).toBe(false) // I2 — must reset, not stale-true

    // Step 4: upload more allocations to reach 1000 total (p1 gets 600 more)
    await createAllocations(campId, batchId, 'TEST-001', [
      { participantId: p1, participantName: 'P1', amount: 600 },
    ], 'admin')

    snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.amountAllocated).toBe(1000) // 400 (p2) + 600 (p1 re-allocated)

    // Step 5: mark reconciled (no variance — allocated == received)
    await db().doc(`camps/${campId}/paymentBatches/${batchId}`).update({
      status: 'RECONCILED',
      updatedAt: FieldValue.serverTimestamp(),
    })

    snap = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(snap.data()!.status).toBe('RECONCILED')
    // Key assertion: varianceAcknowledged must NOT be stale-true
    expect(snap.data()!.varianceAcknowledged).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PART D — Reconciliation gate end-to-end loop
// ─────────────────────────────────────────────────────────────────────────────

describe('reconciliation gate — full loop', () => {
  function makeRequest(data: unknown, uid?: string): CallableRequest<any> {
    return {
      data, rawRequest: {} as any,
      auth: uid ? { uid, token: {} as any, rawToken: '' } : undefined,
    } as CallableRequest<any>
  }

  it('OPEN batch w/ balance → blocks → allocate all → unblocks → void → blocks again', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, batchId = `batch-${s}`
    const leaderUid = `leader-${s}`, rtId = `rt-${s}`
    const p1 = `p1-${s}`, allocId = `a1-${s}`

    // Seed
    await seedCamp(campId)
    await seedRoomType(campId, rtId, 400)
    await db().doc(`camps/${campId}/subGroups/${sgId}`).set({ name: 'Test Council', order: 0 })
    await db().doc(`leaders/${leaderUid}`).set({
      campId, subGroupId: sgId, subGroupName: 'Test Council',
      active: true, email: 'leader@test.com',
    })
    // Open batch with unallocated balance — blocks registration
    await seedBatch(campId, batchId, sgId, 'Test Council', { amountReceived: 500, amountAllocated: 0 })

    // Step 1: registration blocked
    await expect(
      leaderRegisterParticipant.run(makeRequest(
        { fullName: 'Test Person', phone: '0501112233', gender: 'M', roomTypePreferenceId: rtId },
        leaderUid,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' })

    // Step 2: seed a participant and allocate the full batch amount
    await seedParticipant(campId, p1, sgId, 'Test Council', 400, 0)
    await seedAllocation(campId, allocId, batchId, p1, 500)
    // Manually update amountAllocated (what createAllocations would do)
    await db().doc(`camps/${campId}/paymentBatches/${batchId}`).update({ amountAllocated: 500 })
    await db().doc(`camps/${campId}/participants/${p1}`).update({ amountPaid: 500 })

    // Step 3: batch balance is now 0 → registration should succeed
    const result = await leaderRegisterParticipant.run(makeRequest(
      { fullName: 'New Registrant', phone: '0507778899', gender: 'F', roomTypePreferenceId: rtId },
      leaderUid,
    ))
    expect(result).toHaveProperty('participantId')

    // Step 4: void the allocation → batch balance returns → registration blocked again
    await voidAlloc(campId, allocId, 'test void', 'admin')

    const batchAfterVoid = await db().doc(`camps/${campId}/paymentBatches/${batchId}`).get()
    expect(batchAfterVoid.data()!.status).toBe('OPEN')
    expect(batchAfterVoid.data()!.amountAllocated).toBe(0)

    await expect(
      leaderRegisterParticipant.run(makeRequest(
        { fullName: 'Blocked Again', phone: '0509990000', gender: 'M', roomTypePreferenceId: rtId },
        leaderUid,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
