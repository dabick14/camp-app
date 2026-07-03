/**
 * Server-side reconciliation gate tests for leaderRegisterParticipant.
 *
 * These tests verify that the gate in leaderRegisterParticipant (Admin SDK,
 * authoritative) correctly rejects or allows registration independent of the
 * client-side UX pre-check in LeaderRegisterPage / isSubGroupGated().
 *
 * Three invariants under test:
 *   G1. OPEN batch with unallocated balance → rejects with failed-precondition;
 *       no participant doc is written.
 *   G2. Gate does NOT fire when batches are RECONCILED or have zero balance
 *       (control: registration must succeed in both cases).
 *   G3. Gate is sub-group-scoped: an OPEN unallocated batch for sub-group B
 *       does NOT block registration for a leader in sub-group A.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { leaderRegisterParticipant } from './leaderRegisterParticipant'

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

function db() { return getFirestore() }
function uniq() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

function makeRequest(data: unknown, uid?: string): CallableRequest<any> {
  return {
    data,
    auth: uid ? { uid, token: {} as any, rawToken: '' } : undefined,
    rawRequest: {} as any,
  } as CallableRequest<any>
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedCamp(campId: string) {
  await db().doc(`camps/${campId}`).set({
    name: 'Test Camp', location: 'Accra', registrationOpen: true, currency: 'GHS',
  })
}

async function seedRoomType(campId: string, rtId: string) {
  await db().doc(`camps/${campId}/roomTypes/${rtId}`).set({ name: 'Standard', price: 400 })
}

async function seedLeader(
  leaderUid: string,
  campId: string,
  subGroupId: string,
  subGroupName: string,
) {
  await db().doc(`leaders/${leaderUid}`).set({
    campId, subGroupId, subGroupName,
    active: true, email: `${leaderUid}@test.com`,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
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
  } = {},
) {
  await db().doc(`camps/${campId}/paymentBatches/${batchId}`).set({
    referenceCode: 'GATE-001',
    subGroupId,
    subGroupName: 'Test Council',
    amountReceived: opts.amountReceived ?? 500,
    amountAllocated: opts.amountAllocated ?? 0,
    method: 'MOMO',
    receivedAt: Timestamp.now(),
    receivedBy: 'admin',
    status: opts.status ?? 'OPEN',
    varianceAcknowledged: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

const REG_DATA = {
  fullName: 'Gate Test Person',
  phone: () => `059${Math.floor(Math.random() * 9e6 + 1e6)}`, // unique per call
  gender: 'M',
}

// ─────────────────────────────────────────────────────────────────────────────
// G1 — OPEN batch with unallocated balance → registration rejected server-side
// ─────────────────────────────────────────────────────────────────────────────

describe('leaderRegisterParticipant gate — G1: gated sub-group is rejected', () => {
  it('rejects with failed-precondition when sub-group has OPEN batch with unallocated balance', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchId = `batch-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgId, 'Council A')
    // OPEN batch with amountReceived=500, amountAllocated=0 → balance 500 > 0
    await seedBatch(campId, batchId, sgId, { amountReceived: 500, amountAllocated: 0, status: 'OPEN' })

    await expect(
      leaderRegisterParticipant.run(makeRequest(
        { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
        leaderUid,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('writes no participant doc when registration is blocked by the gate', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchId = `batch-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgId, 'Council A')
    await seedBatch(campId, batchId, sgId, { amountReceived: 400, amountAllocated: 0, status: 'OPEN' })

    const phone = REG_DATA.phone()
    await expect(
      leaderRegisterParticipant.run(makeRequest(
        { fullName: REG_DATA.fullName, phone, gender: REG_DATA.gender, roomTypePreferenceId: rtId },
        leaderUid,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' })

    // No participant should have been written — phone should not exist
    const snap = await db()
      .collection(`camps/${campId}/participants`)
      .where('phone', '==', phone)
      .get()
    expect(snap.empty).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G2 — Gate does not fire when batches are reconciled or fully allocated
// ─────────────────────────────────────────────────────────────────────────────

describe('leaderRegisterParticipant gate — G2: ungated sub-group succeeds', () => {
  it('succeeds when sub-group has no batches at all', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgId, 'Council A')
    // No batches seeded

    const result = await leaderRegisterParticipant.run(makeRequest(
      { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
      leaderUid,
    ))
    expect(result).toHaveProperty('participantId')
  })

  it('succeeds when the only batch for the sub-group is RECONCILED', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchId = `batch-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgId, 'Council A')
    await seedBatch(campId, batchId, sgId, { amountReceived: 500, amountAllocated: 500, status: 'RECONCILED' })

    const result = await leaderRegisterParticipant.run(makeRequest(
      { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
      leaderUid,
    ))
    expect(result).toHaveProperty('participantId')
  })

  it('succeeds when OPEN batch has amountAllocated === amountReceived (zero unallocated balance)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchId = `batch-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgId, 'Council A')
    // OPEN but fully allocated — balance is 0, gate must NOT fire
    await seedBatch(campId, batchId, sgId, { amountReceived: 400, amountAllocated: 400, status: 'OPEN' })

    const result = await leaderRegisterParticipant.run(makeRequest(
      { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
      leaderUid,
    ))
    expect(result).toHaveProperty('participantId')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G3 — Gate is sub-group-scoped: sgB's open batch does not block sgA
// ─────────────────────────────────────────────────────────────────────────────

describe('leaderRegisterParticipant gate — G3: gate is sub-group-scoped', () => {
  it('allows registration into sgA even when sgB has an OPEN batch with unallocated balance', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgA = `sgA-${s}`, sgB = `sgB-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchIdB = `batchB-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    // Leader belongs to sgA
    await seedLeader(leaderUid, campId, sgA, 'Council A')
    // sgB has an OPEN unallocated batch — must not affect sgA
    await seedBatch(campId, batchIdB, sgB, { amountReceived: 800, amountAllocated: 0, status: 'OPEN' })
    // sgA has no batches

    const result = await leaderRegisterParticipant.run(makeRequest(
      { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
      leaderUid,
    ))
    expect(result).toHaveProperty('participantId')
  })

  it('blocks sgA leader while sgA batch is unreconciled, even if sgB is also unreconciled', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgA = `sgA-${s}`, sgB = `sgB-${s}`, rtId = `rt-${s}`
    const leaderUid = `leader-${s}`, batchIdA = `batchA-${s}`, batchIdB = `batchB-${s}`

    await seedCamp(campId)
    await seedRoomType(campId, rtId)
    await seedLeader(leaderUid, campId, sgA, 'Council A')
    // Both sub-groups have OPEN unallocated batches
    await seedBatch(campId, batchIdA, sgA, { amountReceived: 500, amountAllocated: 0, status: 'OPEN' })
    await seedBatch(campId, batchIdB, sgB, { amountReceived: 800, amountAllocated: 0, status: 'OPEN' })

    // Only sgA's batch should block the sgA leader
    await expect(
      leaderRegisterParticipant.run(makeRequest(
        { fullName: REG_DATA.fullName, phone: REG_DATA.phone(), gender: REG_DATA.gender, roomTypePreferenceId: rtId },
        leaderUid,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
