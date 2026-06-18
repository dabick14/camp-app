import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

/**
 * The single, idempotent "apply a confirmed Hubtel payment" function.
 *
 * BOTH confirmation paths funnel through here so they can never drift:
 *   - the webhook callback (matchedBy: 'auto')
 *   - the return-page status-check verify (matchedBy: admin uid)
 *
 * It loads the pending session by reference, guards amount + currency, and on success
 * creates the PaymentBatch (source: 'hubtel', status: 'OPEN') and flips the session to
 * MATCHED — all in one transaction. Re-running it for an already-matched session is a no-op.
 */
export interface ApplyHubtelPaymentArgs {
  campId: string
  reference: string
  paidAmountGHS: number
  currency?: string
  /** Hubtel identifier (checkoutId from callback, transactionId from status check). */
  hubtelId?: string
  channel?: string
  channelProvider?: string
  senderPhone?: string
  paidAt?: Date
  matchedBy: string
  rawPayload?: unknown
}

export type ApplyHubtelPaymentReason =
  | 'NO_SESSION'
  | 'UNDERPAID'
  | 'WRONG_CURRENCY'

export interface ApplyHubtelPaymentResult {
  applied: boolean
  alreadyProcessed: boolean
  batchId?: string
  reason?: ApplyHubtelPaymentReason
}

export async function applyHubtelPayment(
  args: ApplyHubtelPaymentArgs,
): Promise<ApplyHubtelPaymentResult> {
  const db = getFirestore()
  const sessionRef = db.doc(
    `camps/${args.campId}/hubtelTransactions/${args.reference}`,
  )

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef)
    if (!snap.exists) {
      return { applied: false, alreadyProcessed: false, reason: 'NO_SESSION' as const }
    }

    const session = snap.data()!
    // Idempotency: already confirmed → return the existing batch.
    if (session.status === 'MATCHED' && session.batchId) {
      return {
        applied: false,
        alreadyProcessed: true,
        batchId: session.batchId as string,
      }
    }

    const currency = args.currency || 'GHS'
    if (currency !== 'GHS') {
      return { applied: false, alreadyProcessed: false, reason: 'WRONG_CURRENCY' as const }
    }

    // Never grant a batch for less than was requested (epsilon for float rounding).
    const expected = Number(session.amountExpected ?? 0)
    if (expected > 0 && args.paidAmountGHS + 1e-6 < expected) {
      return { applied: false, alreadyProcessed: false, reason: 'UNDERPAID' as const }
    }

    const batchRef = db.collection(`camps/${args.campId}/paymentBatches`).doc()
    const receivedAt = args.paidAt
      ? Timestamp.fromDate(args.paidAt)
      : FieldValue.serverTimestamp()

    const batch: Record<string, unknown> = {
      referenceCode: args.reference,
      hubtelReference: args.reference,
      subGroupId: session.subGroupId,
      subGroupName: session.subGroupName,
      amountReceived: args.paidAmountGHS,
      amountAllocated: 0,
      method: 'MOMO',
      source: 'hubtel',
      status: 'OPEN',
      varianceAcknowledged: false,
      receivedAt,
      receivedBy: args.matchedBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (args.hubtelId) {
      batch.hubtelCheckoutId = args.hubtelId
      batch.externalReference = args.hubtelId
    }
    if (args.channel) batch.channel = args.channel
    if (args.channelProvider) batch.channelProvider = args.channelProvider
    tx.set(batchRef, batch)

    const sessionUpdate: Record<string, unknown> = {
      status: 'MATCHED',
      batchId: batchRef.id,
      amount: args.paidAmountGHS,
      matchedAt: FieldValue.serverTimestamp(),
      matchedBy: args.matchedBy,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (args.hubtelId) sessionUpdate.checkoutId = args.hubtelId
    if (args.channel) sessionUpdate.channel = args.channel
    if (args.channelProvider) sessionUpdate.channelProvider = args.channelProvider
    if (args.senderPhone) sessionUpdate.senderPhone = args.senderPhone
    sessionUpdate.receivedAt = receivedAt
    if (args.rawPayload !== undefined) sessionUpdate.rawPayload = args.rawPayload
    tx.update(sessionRef, sessionUpdate)

    return { applied: true, alreadyProcessed: false, batchId: batchRef.id }
  })
}
