/**
 * Firestore rules tests for facility issue tickets — admin-only, all operations.
 *
 * Uses the Firestore CLIENT SDK + @firebase/rules-unit-testing so rules are
 * actually enforced (Admin SDK bypasses them). Tickets are internal ops only:
 * no coordinator/leader access, no public access — unlike participants/
 * paymentBatches, there's no leader-scoped carve-out to test here.
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

const campId = 'camp-tickets-test'
const sgId = 'sg-a'
const adminUid = 'admin-uid'
const leaderUid = 'leader-uid'
const ticketId = 'ticket-1'

beforeAll(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-camp-app-tickets-rules-test',
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
    await db.doc(`admins/${adminUid}`).set({ email: 'admin@example.com' })
    await db.doc(`leaders/${leaderUid}`).set({
      email: 'leader@example.com',
      campId,
      subGroupId: sgId,
      subGroupName: 'Council A',
      active: true,
    })
    await db.doc(`camps/${campId}/tickets/${ticketId}`).set({
      roomId: 'room-1',
      roomNumber: '204',
      roomTypeName: 'Standard',
      title: 'Leaking tap',
      description: 'Bathroom tap leaking steadily',
      status: 'OPEN',
      statusHistory: [{ status: 'OPEN', at: new Date(), by: adminUid }],
      notes: [],
      createdAt: new Date(),
      createdBy: adminUid,
      updatedAt: new Date(),
      updatedBy: adminUid,
    })
  })
})

describe('tickets rules — admin has full access', () => {
  it('allows an admin to read a ticket', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).get(),
    )
  })

  it('allows an admin to create a ticket', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/tickets/new-ticket`).set({
        roomId: 'room-2',
        roomNumber: '205',
        roomTypeName: 'Standard',
        title: 'Broken window latch',
        description: '',
        status: 'OPEN',
        statusHistory: [{ status: 'OPEN', at: new Date(), by: adminUid }],
        notes: [],
        createdAt: new Date(),
        createdBy: adminUid,
        updatedAt: new Date(),
        updatedBy: adminUid,
      }),
    )
  })

  it('allows an admin to update a ticket (status transition)', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).update({
        status: 'REPORTED',
        updatedAt: new Date(),
        updatedBy: adminUid,
      }),
    )
  })

  it('allows an admin to delete a ticket', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).delete(),
    )
  })
})

describe('tickets rules — coordinators (leaders) have no access', () => {
  it('denies a leader reading a ticket', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).get(),
    )
  })

  it('denies a leader listing tickets', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().collection(`camps/${campId}/tickets`).get(),
    )
  })

  it('denies a leader creating a ticket', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/tickets/leader-created`).set({
        roomId: 'room-1',
        roomNumber: '204',
        roomTypeName: 'Standard',
        title: 'Should not be allowed',
        description: '',
        status: 'OPEN',
        statusHistory: [],
        notes: [],
        createdAt: new Date(),
        createdBy: leaderUid,
        updatedAt: new Date(),
        updatedBy: leaderUid,
      }),
    )
  })

  it('denies a leader updating a ticket', async () => {
    const ctx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).update({
        status: 'REPORTED',
      }),
    )
  })
})

describe('tickets rules — unauthenticated access denied', () => {
  it('denies an unauthenticated read', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).get(),
    )
  })

  it('denies an unauthenticated write', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(
      ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`).update({
        status: 'REPORTED',
      }),
    )
  })
})

describe('tickets rules — full lifecycle transitions are recorded', () => {
  it('moves a ticket through Open → Reported → Fixed-pending-check → Closed with each transition appended to statusHistory', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    const ref = ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`)

    await assertSucceeds(ref.update({
      status: 'REPORTED',
      statusHistory: [
        { status: 'OPEN', at: new Date(), by: adminUid },
        { status: 'REPORTED', at: new Date(), by: adminUid },
      ],
      updatedAt: new Date(),
      updatedBy: adminUid,
    }))
    let snap = await ref.get()
    if (snap.data()?.status !== 'REPORTED') throw new Error('expected REPORTED')
    if (snap.data()?.statusHistory.length !== 2) throw new Error('expected 2 history entries')

    await assertSucceeds(ref.update({
      status: 'FIXED_PENDING_CHECK',
      statusHistory: [
        ...snap.data()!.statusHistory,
        { status: 'FIXED_PENDING_CHECK', at: new Date(), by: adminUid },
      ],
      updatedAt: new Date(),
      updatedBy: adminUid,
    }))
    snap = await ref.get()
    if (snap.data()?.status !== 'FIXED_PENDING_CHECK') throw new Error('expected FIXED_PENDING_CHECK')
    if (snap.data()?.statusHistory.length !== 3) throw new Error('expected 3 history entries')

    await assertSucceeds(ref.update({
      status: 'CLOSED',
      statusHistory: [
        ...snap.data()!.statusHistory,
        { status: 'CLOSED', at: new Date(), by: adminUid },
      ],
      updatedAt: new Date(),
      updatedBy: adminUid,
    }))
    snap = await ref.get()
    if (snap.data()?.status !== 'CLOSED') throw new Error('expected CLOSED')
    if (snap.data()?.statusHistory.length !== 4) throw new Error('expected 4 history entries')
  })

  it('allows reopening a Closed ticket back to Open, appending rather than truncating history', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    const ref = ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`)

    await ref.update({
      status: 'CLOSED',
      statusHistory: [
        { status: 'OPEN', at: new Date(), by: adminUid },
        { status: 'CLOSED', at: new Date(), by: adminUid },
      ],
    })

    await assertSucceeds(ref.update({
      status: 'OPEN',
      statusHistory: [
        { status: 'OPEN', at: new Date(), by: adminUid },
        { status: 'CLOSED', at: new Date(), by: adminUid },
        { status: 'OPEN', at: new Date(), by: adminUid },
      ],
      updatedAt: new Date(),
      updatedBy: adminUid,
    }))
    const snap = await ref.get()
    if (snap.data()?.status !== 'OPEN') throw new Error('expected reopened to OPEN')
    if (snap.data()?.statusHistory.length !== 3) throw new Error('expected history to grow, not truncate')
  })

  it('allows adding a free-form note independent of status', async () => {
    const ctx = testEnv.authenticatedContext(adminUid)
    const ref = ctx.firestore().doc(`camps/${campId}/tickets/${ticketId}`)

    await assertSucceeds(ref.update({
      notes: [{ text: 'Facilities said Thursday', at: new Date(), by: adminUid }],
      updatedAt: new Date(),
      updatedBy: adminUid,
    }))
    const snap = await ref.get()
    if (snap.data()?.status !== 'OPEN') throw new Error('note should not change status')
    if (snap.data()?.notes.length !== 1) throw new Error('expected 1 note')
  })
})
