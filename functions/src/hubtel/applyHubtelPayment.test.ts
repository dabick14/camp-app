import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { applyHubtelPayment } from './applyHubtelPayment'

/**
 * Integration tests for the idempotent apply core. They require the Firestore emulator:
 *   firebase emulators:exec --only firestore "npm test"
 * When FIRESTORE_EMULATOR_HOST is unset they are skipped so `npm test` stays green.
 */
const EMU = process.env.FIRESTORE_EMULATOR_HOST
const maybe = EMU ? describe : describe.skip

maybe('applyHubtelPayment (emulator)', () => {
  const campId = 'camp-test'

  beforeAll(() => {
    if (!getApps().length) initializeApp({ projectId: 'camp-app-test' })
  })

  async function seedSession(reference: string, amountExpected: number): Promise<void> {
    await getFirestore()
      .doc(`camps/${campId}/hubtelTransactions/${reference}`)
      .set({
        reference,
        status: 'PENDING',
        amountExpected,
        amount: 0,
        subGroupId: 'sg1',
        subGroupName: 'Galatians',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
  }

  it('creates a batch and flips the session to MATCHED', async () => {
    const ref = 'REF_OK'
    await seedSession(ref, 100)
    const res = await applyHubtelPayment({
      campId,
      reference: ref,
      paidAmountGHS: 100,
      matchedBy: 'auto',
    })
    expect(res.applied).toBe(true)
    expect(res.batchId).toBeDefined()

    const db = getFirestore()
    const session = await db.doc(`camps/${campId}/hubtelTransactions/${ref}`).get()
    expect(session.data()!.status).toBe('MATCHED')
    const batch = await db.doc(`camps/${campId}/paymentBatches/${res.batchId}`).get()
    expect(batch.data()!.amountReceived).toBe(100)
    expect(batch.data()!.source).toBe('hubtel')
    expect(batch.data()!.status).toBe('OPEN')
  })

  it('is idempotent — a second apply does not create a second batch', async () => {
    const ref = 'REF_DUP'
    await seedSession(ref, 50)
    const first = await applyHubtelPayment({
      campId,
      reference: ref,
      paidAmountGHS: 50,
      matchedBy: 'auto',
    })
    const second = await applyHubtelPayment({
      campId,
      reference: ref,
      paidAmountGHS: 50,
      matchedBy: 'auto',
    })
    expect(first.applied).toBe(true)
    expect(second.applied).toBe(false)
    expect(second.alreadyProcessed).toBe(true)
    expect(second.batchId).toBe(first.batchId)

    const batches = await getFirestore()
      .collection(`camps/${campId}/paymentBatches`)
      .where('hubtelReference', '==', ref)
      .get()
    expect(batches.size).toBe(1)
  })

  it('does not confirm an underpayment', async () => {
    const ref = 'REF_UNDER'
    await seedSession(ref, 100)
    const res = await applyHubtelPayment({
      campId,
      reference: ref,
      paidAmountGHS: 80,
      matchedBy: 'auto',
    })
    expect(res.applied).toBe(false)
    expect(res.reason).toBe('UNDERPAID')
  })

  it('returns NO_SESSION when there is no matching session', async () => {
    const res = await applyHubtelPayment({
      campId,
      reference: 'REF_MISSING',
      paidAmountGHS: 10,
      matchedBy: 'auto',
    })
    expect(res.reason).toBe('NO_SESSION')
  })
})
