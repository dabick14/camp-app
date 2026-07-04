/**
 * Tests for the setPaymentClaim Cloud Function.
 *
 * Uses Admin SDK against the Firestore emulator — same pattern as
 * leaderRegisterParticipant.tamper.test.ts. The Admin SDK bypasses rules,
 * so this file tests Cloud Function logic only. See participants.rules.test.ts
 * for the Firestore rules test (direct leader write of amountPaid is denied).
 *
 * Invariant under test:
 *   setPaymentClaim MUST NOT change amountPaid, feeOwed, or any rooming field.
 *   paymentClaimed is a pre-confirmation signal only.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { setPaymentClaim } from './setPaymentClaim'

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

async function seedCamp(campId: string) {
  await db().doc(`camps/${campId}`).set({
    name: 'Test Camp', location: 'Accra', registrationOpen: true, currency: 'GHS',
  })
}

async function seedLeader(
  uid: string,
  campId: string,
  subGroupId: string,
  subGroupName: string,
  active = true,
) {
  await db().doc(`leaders/${uid}`).set({
    email: `${uid}@test.com`,
    campId,
    subGroupId,
    subGroupName,
    active,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'admin',
  })
}

async function seedParticipant(
  campId: string,
  participantId: string,
  subGroupId: string,
  subGroupName = 'Test Council',
  feeOwed = 400,
  amountPaid = 0,
) {
  await db().doc(`camps/${campId}/participants/${participantId}`).set({
    fullName: `Participant ${participantId}`,
    phone: `05${Math.floor(Math.random() * 9e7 + 1e7)}`,
    gender: 'M',
    subGroupId,
    subGroupName,
    roomTypePreferenceId: 'rt1',
    roomTypePreferenceName: 'Standard',
    feeOwed,
    amountPaid,
    paymentClaimed: false,
    registrationState: 'REGISTERED',
    checkInState: 'NOT_ARRIVED',
    tags: [],
    source: 'leader',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('setPaymentClaim — happy path', () => {
  it('sets paymentClaimed: true and writes claimedBy/claimedAt', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedParticipant(campId, pId, sgId)

    const result = await setPaymentClaim.run(
      makeRequest({ participantId: pId, claimed: true }, leaderUid),
    )
    expect(result).toMatchObject({ participantId: pId, claimed: true })

    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    const data = snap.data()!
    expect(data.paymentClaimed).toBe(true)
    expect(data.claimedBy).toBe(leaderUid)
    expect(data.claimedAt).toBeDefined()
  })

  it('clears paymentClaimed (unclaim) and deletes claimedBy/claimedAt', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    // Seed already claimed
    await db().doc(`camps/${campId}/participants/${pId}`).set({
      fullName: 'Test',
      phone: '0501112233',
      gender: 'M',
      subGroupId: sgId,
      subGroupName: 'Test Council',
      feeOwed: 400,
      amountPaid: 0,
      paymentClaimed: true,
      claimedBy: leaderUid,
      claimedAt: Timestamp.now(),
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
      source: 'leader',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })

    await setPaymentClaim.run(
      makeRequest({ participantId: pId, claimed: false }, leaderUid),
    )

    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    const data = snap.data()!
    expect(data.paymentClaimed).toBe(false)
    expect(data.claimedBy).toBeUndefined()
    expect(data.claimedAt).toBeUndefined()
  })

  it('INVARIANT: claim does NOT change amountPaid, feeOwed, or paymentState inputs', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedParticipant(campId, pId, sgId, 'Test Council', 400, 0)

    await setPaymentClaim.run(
      makeRequest({ participantId: pId, claimed: true }, leaderUid),
    )

    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    const data = snap.data()!

    // amountPaid and feeOwed must be untouched
    expect(data.amountPaid).toBe(0)
    expect(data.feeOwed).toBe(400)

    // paymentState is derived — not stored. Assert its inputs haven't changed
    // so the derived state stays PENDING (not PAID/PARTIAL).
    expect(data.amountPaid).toBeLessThan(data.feeOwed)
    expect(data.paymentClaimed).toBe(true) // claim is set

    // Rooming fields untouched
    expect(data.roomId).toBeUndefined()
    expect(data.checkInState).toBe('NOT_ARRIVED')
  })

  it('leader can toggle the same participant multiple times (claim is correctable)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedParticipant(campId, pId, sgId)

    await setPaymentClaim.run(makeRequest({ participantId: pId, claimed: true }, leaderUid))
    await setPaymentClaim.run(makeRequest({ participantId: pId, claimed: false }, leaderUid))
    await setPaymentClaim.run(makeRequest({ participantId: pId, claimed: true }, leaderUid))

    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    expect(snap.data()!.paymentClaimed).toBe(true)
    expect(snap.data()!.amountPaid).toBe(0) // INVARIANT: still untouched
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Security — cross-sub-group tamper
// ─────────────────────────────────────────────────────────────────────────────

describe('setPaymentClaim — cross-sub-group tamper', () => {
  // Control: own-sub-group claim works. Placed first in this describe so any
  // failure here means the function is broken, not that the scope check fired.
  it('[control] leader A can claim a participant in their OWN sub-group A', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgA = `sgA-${s}`, leaderUid = `leader-${s}`, pInA = `p-in-A-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgA, 'Council A')
    await seedParticipant(campId, pInA, sgA, 'Council A')

    const result = await setPaymentClaim.run(
      makeRequest({ participantId: pInA, claimed: true }, leaderUid),
    )
    expect(result).toMatchObject({ participantId: pInA, claimed: true })

    const snap = await db().doc(`camps/${campId}/participants/${pInA}`).get()
    const data = snap.data()!
    expect(data.paymentClaimed).toBe(true)
    expect(data.claimedBy).toBe(leaderUid)   // uid stored on claim
    expect(data.amountPaid).toBe(0)            // INVARIANT: untouched
  })

  it('rejects a leader claiming a participant in a DIFFERENT sub-group', async () => {
    const s = uniq()
    const campId = `camp-${s}`
    const sgA = `sgA-${s}`, sgB = `sgB-${s}`
    const leaderUid = `leader-${s}`
    const pInB = `p-in-B-${s}`

    await seedCamp(campId)
    // Leader belongs to sgA
    await seedLeader(leaderUid, campId, sgA, 'Council A')
    // Participant belongs to sgB
    await seedParticipant(campId, pInB, sgB, 'Council B')

    await expect(
      setPaymentClaim.run(
        makeRequest({ participantId: pInB, claimed: true }, leaderUid),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    // Participant in sgB must remain unclaimed
    const snap = await db().doc(`camps/${campId}/participants/${pInB}`).get()
    expect(snap.data()!.paymentClaimed).toBe(false)
    expect(snap.data()!.amountPaid).toBe(0)
  })

  it('rejects a crafted request that includes a foreign campId in the payload (ignored, then sub-group check fails)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, foreignCampId = `camp-foreign-${s}`
    const sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedCamp(foreignCampId)
    await seedLeader(leaderUid, campId, sgId, 'My Council')
    // Participant in foreign camp (different campId entirely)
    await seedParticipant(foreignCampId, pId, sgId)

    // Leader can't reach the foreign camp's participant — the function always
    // reads from the leader's own campId, so the participant won't be found.
    await expect(
      setPaymentClaim.run(
        // payload includes extra fields the function must ignore
        makeRequest({ participantId: pId, claimed: true, campId: foreignCampId }, leaderUid),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth guards
// ─────────────────────────────────────────────────────────────────────────────

describe('setPaymentClaim — auth guards', () => {
  it('rejects unauthenticated calls', async () => {
    await expect(
      setPaymentClaim.run(makeRequest({ participantId: 'any', claimed: true })),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects a deactivated leader', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council', false) // inactive
    await seedParticipant(campId, pId, sgId)

    await expect(
      setPaymentClaim.run(makeRequest({ participantId: pId, claimed: true }, leaderUid)),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a uid with no leader doc', async () => {
    await expect(
      setPaymentClaim.run(
        makeRequest({ participantId: 'any', claimed: true }, `ghost-${uniq()}`),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects missing participantId', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`
    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')

    await expect(
      setPaymentClaim.run(makeRequest({ claimed: true }, leaderUid)),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation lock — PART A money-path integrity
// ─────────────────────────────────────────────────────────────────────────────
//
// Once reconcileAndConfirm sets confirmedBatchId on a participant, the leader
// cannot change paymentClaimed in either direction. These tests call the
// function directly (bypassing UI) — the guard is at the function level, not
// the UI layer.

describe('setPaymentClaim — confirmation lock', () => {
  async function seedConfirmedParticipant(
    campId: string,
    participantId: string,
    subGroupId: string,
    feeOwed = 400,
  ) {
    // Mirrors what reconcileAndConfirm writes: amountPaid = feeOwed,
    // confirmedBatchId present, paymentClaimed still true.
    await db().doc(`camps/${campId}/participants/${participantId}`).set({
      fullName: `Confirmed ${participantId}`,
      phone: `05${Math.floor(Math.random() * 9e7 + 1e7)}`,
      gender: 'M',
      subGroupId,
      subGroupName: 'Test Council',
      feeOwed,
      amountPaid: feeOwed,         // PAID
      paymentClaimed: true,
      claimedBy: 'leader-uid',
      claimedAt: Timestamp.now(),
      confirmedBatchId: 'batch-001',
      confirmedAt: Timestamp.now(),
      confirmedBy: 'admin@test.com',
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
      source: 'leader',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
  }

  it('[control] leader CAN toggle an unconfirmed participant freely', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedParticipant(campId, pId, sgId)  // no confirmedBatchId

    // Can claim
    await expect(
      setPaymentClaim.run(makeRequest({ participantId: pId, claimed: true }, leaderUid)),
    ).resolves.toMatchObject({ claimed: true })

    // Can un-claim
    await expect(
      setPaymentClaim.run(makeRequest({ participantId: pId, claimed: false }, leaderUid)),
    ).resolves.toMatchObject({ claimed: false })
  })

  it('rejects un-claim on a confirmed participant (has confirmedBatchId)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedConfirmedParticipant(campId, pId, sgId)

    await expect(
      setPaymentClaim.run(makeRequest({ participantId: pId, claimed: false }, leaderUid)),
    ).rejects.toMatchObject({ code: 'failed-precondition' })

    // confirmedBatchId and amountPaid must be untouched
    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    const data = snap.data()!
    expect(data.confirmedBatchId).toBe('batch-001')
    expect(data.amountPaid).toBe(400)
    expect(data.paymentClaimed).toBe(true)  // unchanged
  })

  it('rejects re-claim attempt on a confirmed participant (lock is bidirectional)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedConfirmedParticipant(campId, pId, sgId)

    await expect(
      setPaymentClaim.run(makeRequest({ participantId: pId, claimed: true }, leaderUid)),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejection holds against a crafted direct call (not just disabled UI)', async () => {
    // This test documents that the guard is in the function, not the UI.
    // A leader who bypasses the roster UI and calls setPaymentClaim directly
    // with a confirmed participant's id is still rejected.
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, leaderUid = `leader-${s}`, pId = `p-${s}`

    await seedCamp(campId)
    await seedLeader(leaderUid, campId, sgId, 'Test Council')
    await seedConfirmedParticipant(campId, pId, sgId)

    // Crafted call: valid leader, own sub-group, confirmed participant
    await expect(
      setPaymentClaim.run(
        makeRequest({ participantId: pId, claimed: false }, leaderUid),
      ),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('confirmed'),
    })

    // Document state must be unchanged after the rejected attempt
    const snap = await db().doc(`camps/${campId}/participants/${pId}`).get()
    expect(snap.data()!.confirmedBatchId).toBe('batch-001')
    expect(snap.data()!.amountPaid).toBe(400)
  })
})
