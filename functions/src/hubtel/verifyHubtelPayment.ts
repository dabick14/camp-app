import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { verifyStatus, HUBTEL_SECRETS } from './hubtelClient'
import { applyHubtelPayment } from './applyHubtelPayment'

interface VerifyBody {
  campId?: string
  reference?: string
}

/**
 * Admin-only. The authoritative confirmation path: runs a Transaction Status Check and,
 * if Paid, applies the payment via the shared idempotent applyHubtelPayment. Polled by
 * the checkout modal / return page after the admin completes payment.
 */
export const verifyHubtelPayment = onRequest(
  { cors: true, secrets: HUBTEL_SECRETS },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    let uid: string
    try {
      uid = (await getAuth().verifyIdToken(authHeader.slice(7))).uid
    } catch {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    const db = getFirestore()
    const adminSnap = await db.doc(`admins/${uid}`).get()
    if (!adminSnap.exists) {
      res.status(403).json({ error: 'Not an admin' })
      return
    }

    const { campId, reference }: VerifyBody = req.body || {}
    if (!campId || !reference) {
      res.status(400).json({ error: 'campId and reference are required' })
      return
    }

    try {
      const verify = await verifyStatus(reference)

      if (verify.status === 'SUCCESS') {
        const applied = await applyHubtelPayment({
          campId,
          reference,
          paidAmountGHS: verify.amountGHS,
          currency: verify.currency,
          hubtelId: verify.transactionId,
          channel: verify.channel,
          paidAt: verify.paidAt,
          matchedBy: uid,
        })
        if (applied.reason === 'NO_SESSION') {
          res.status(404).json({ status: 'PENDING', error: 'No matching session' })
          return
        }
        if (applied.reason === 'UNDERPAID' || applied.reason === 'WRONG_CURRENCY') {
          res.json({ status: 'PENDING', message: 'Payment is under review' })
          return
        }
        res.json({ status: 'SUCCESS', amountGHS: verify.amountGHS, batchId: applied.batchId })
        return
      }

      if (verify.status === 'FAILED') {
        await db
          .doc(`camps/${campId}/hubtelTransactions/${reference}`)
          .update({ status: 'FAILED', updatedAt: FieldValue.serverTimestamp() })
          .catch(() => {})
        res.json({ status: 'FAILED', message: 'Payment failed' })
        return
      }

      // PENDING / ABANDONED — still being processed
      res.json({ status: verify.status })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('verifyHubtelPayment error:', msg)
      res.status(500).json({ error: 'Verification failed' })
    }
  },
)
