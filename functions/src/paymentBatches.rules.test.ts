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

// This file tests firestore.rules itself, not Cloud Function logic — it
// needs the Firestore CLIENT SDK against the emulator (rules are enforced),
// not the Admin SDK (which always bypasses rules, as leaderRegisterParticipant
// .tamper.test.ts relies on). Same emulator, same `npm test` run, different
// SDK on purpose.
//
// Locks in the post-Day-C cleanup decision: paymentBatches has no public-read
// carve-out — it never actually had one deployed (the rule was only ever
// specced in DATA_MODEL.md for the now-removed public form), but per Part B
// of the cleanup it should explicitly be admin-only now that the leader flow
// checks reconciliation server-side instead.

let testEnv: RulesTestEnvironment

const campId = 'camp-1'
const batchId = 'batch-1'
const adminUid = 'admin-uid'

beforeAll(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-camp-app-rules-test',
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
    await db.doc(`camps/${campId}/paymentBatches/${batchId}`).set({
      subGroupId: 'sg-1',
      subGroupName: 'Council A',
      amountReceived: 100,
      amountAllocated: 0,
      status: 'OPEN',
    })
  })
})

describe('firestore.rules — paymentBatches is admin-only read', () => {
  it('allows an admin to read a payment batch', async () => {
    const adminCtx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      adminCtx.firestore().doc(`camps/${campId}/paymentBatches/${batchId}`).get(),
    )
  })

  it('denies an unauthenticated read', async () => {
    const anonCtx = testEnv.unauthenticatedContext()
    await assertFails(
      anonCtx.firestore().doc(`camps/${campId}/paymentBatches/${batchId}`).get(),
    )
  })

  it('denies a non-admin authenticated read', async () => {
    const otherCtx = testEnv.authenticatedContext('random-uid')
    await assertFails(
      otherCtx.firestore().doc(`camps/${campId}/paymentBatches/${batchId}`).get(),
    )
  })
})
