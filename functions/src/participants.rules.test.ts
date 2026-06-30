/**
 * Firestore rules tests for participants — leader write restrictions.
 *
 * Uses the Firestore CLIENT SDK + @firebase/rules-unit-testing so rules are
 * actually enforced (Admin SDK bypasses them). Tests the key security boundary:
 * a leader can update ONLY [paymentClaimed, claimedBy, claimedAt, updatedAt,
 * updatedBy] on participants in their own sub-group — amountPaid and all
 * rooming/confirmation fields are blocked.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'

let testEnv: RulesTestEnvironment

const campId = 'camp-rules-test'
const sgId = 'sg-a'
const otherSgId = 'sg-b'
const leaderUid = 'leader-uid'
const adminUid = 'admin-uid'
const participantId = 'p1'
const otherParticipantId = 'p2'

beforeAll(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-camp-app-rules-test-2',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    // Seed admin
    await db.doc(`admins/${adminUid}`).set({ email: 'admin@example.com' })
    // Seed leader
    await db.doc(`leaders/${leaderUid}`).set({
      email: 'leader@example.com',
      campId,
      subGroupId: sgId,
      subGroupName: 'Council A',
      active: true,
    })
    // Seed participant in leader's sub-group
    await db.doc(`camps/${campId}/participants/${participantId}`).set({
      fullName: 'Test Person',
      phone: '0244111222',
      gender: 'M',
      subGroupId: sgId,
      subGroupName: 'Council A',
      feeOwed: 400,
      amountPaid: 0,
      paymentClaimed: false,
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
    })
    // Seed participant in a DIFFERENT sub-group
    await db.doc(`camps/${campId}/participants/${otherParticipantId}`).set({
      fullName: 'Other Person',
      phone: '0244333444',
      gender: 'F',
      subGroupId: otherSgId,
      subGroupName: 'Council B',
      feeOwed: 300,
      amountPaid: 0,
      paymentClaimed: false,
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
    })
  })
})

// ── Read access ───────────────────────────────────────────────────────────────

describe('participants rules — leader read access', () => {
  it('allows a leader to read a participant in their own sub-group', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).get(),
    )
  })

  it('denies a leader reading a participant in a different sub-group', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${otherParticipantId}`).get(),
    )
  })
})

// ── Leader write restrictions — the core security boundary ────────────────────

describe('participants rules — leader CANNOT write amountPaid or rooming fields', () => {
  it('denies a leader writing amountPaid directly', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        amountPaid: 400,
      }),
    )
  })

  it('denies a leader writing roomId directly', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        roomId: 'room-123',
      }),
    )
  })

  it('denies a leader writing checkInState directly', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        checkInState: 'ARRIVED',
      }),
    )
  })

  it('denies a leader writing registrationState directly', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        registrationState: 'CANCELLED',
      }),
    )
  })

  it('denies a leader writing roomedWithoutFullPayment directly', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        roomedWithoutFullPayment: true,
      }),
    )
  })

  it('denies a leader writing amountPaid alongside allowed fields (no piggyback)', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        paymentClaimed: true,
        amountPaid: 400, // attempt to piggyback a forbidden field
      }),
    )
  })
})

describe('participants rules — leader CAN update claim fields on their own sub-group', () => {
  it('allows a leader to write paymentClaimed directly on their own participant', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        paymentClaimed: true,
        claimedBy: leaderUid,
        updatedAt: new Date(),
        updatedBy: leaderUid,
      }),
    )
  })

  it('denies a leader writing claim fields on a participant in a different sub-group', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${otherParticipantId}`).update({
        paymentClaimed: true,
        claimedBy: leaderUid,
        updatedAt: new Date(),
        updatedBy: leaderUid,
      }),
    )
  })
})

// ── Unauthenticated / non-leader write ────────────────────────────────────────

describe('participants rules — unauthenticated write denied', () => {
  it('denies an unauthenticated write to a participant', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/participants/${participantId}`).update({
        paymentClaimed: true,
      }),
    )
  })
})
