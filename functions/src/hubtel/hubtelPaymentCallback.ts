import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { createHmac } from 'crypto'
import { parseCallback } from './parseCallback'
import { applyHubtelPayment } from './applyHubtelPayment'
import type { HubtelCallbackPayload } from './types'

// Optional. Hubtel checkout callbacks are not reliably signed, so this is best-effort:
// if a secret AND a signature header are both present we enforce it; otherwise we rely
// on reference-must-match-a-session + the amount guard in applyHubtelPayment.
const HUBTEL_WEBHOOK_SECRET = defineSecret('HUBTEL_WEBHOOK_SECRET')

function signatureOk(rawBody: string, signature?: string): boolean {
  const secret = HUBTEL_WEBHOOK_SECRET.value()
  if (!secret) return true // not configured → skip
  if (!signature) return true // Hubtel sent none → don't reject genuine callbacks
  const h256 = createHmac('sha256', secret).update(rawBody).digest('hex')
  if (h256 === signature) return true
  const h512 = createHmac('sha512', secret).update(rawBody).digest('hex')
  return h512 === signature
}

/**
 * Public endpoint Hubtel POSTs to after a checkout completes.
 * - Acts only on Status: Success.
 * - Resolves campId from the reference pointer, then applies via the shared idempotent
 *   applyHubtelPayment (so retries don't double-create).
 * - A Success callback whose reference matches no session is QUARANTINED, never dropped.
 * - Returns 200 once acknowledged (incl. quarantine) so Hubtel stops retrying; only an
 *   invalid signature (401) or an unexpected error (500, so Hubtel retries) is non-200.
 */
export const hubtelPaymentCallback = onRequest(
  { cors: false, secrets: [HUBTEL_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method === 'GET') {
      res.status(200).json({ status: 'ok', message: 'Hubtel callback endpoint active' })
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const raw = (req as unknown as { rawBody?: Buffer }).rawBody
    const rawBody = raw ? raw.toString('utf8') : JSON.stringify(req.body || {})
    const signature = (req.headers['x-hubtel-signature'] ||
      req.headers['x-webhook-signature']) as string | undefined

    if (!signatureOk(rawBody, signature)) {
      console.warn('[hubtelCallback] invalid signature')
      res.status(401).json({ error: 'Invalid signature' })
      return
    }

    let payload: HubtelCallbackPayload | null
    try {
      payload =
        req.body && typeof req.body === 'object'
          ? (req.body as HubtelCallbackPayload)
          : (JSON.parse(rawBody) as HubtelCallbackPayload)
    } catch {
      payload = null
    }

    const parsed = payload ? parseCallback(payload) : null
    if (!parsed) {
      console.warn('[hubtelCallback] unparseable payload — acknowledging')
      res.status(200).json({ received: true })
      return
    }

    try {
      const db = getFirestore()
      const pointerSnap = await db.doc(`hubtelReferences/${parsed.reference}`).get()

      // Non-success: record the failure on the session if we can find it, then ack.
      if (parsed.status !== 'SUCCESS') {
        if (pointerSnap.exists && parsed.status === 'FAILED') {
          const campId = pointerSnap.data()!.campId as string
          await db
            .doc(`camps/${campId}/hubtelTransactions/${parsed.reference}`)
            .update({ status: 'FAILED', updatedAt: FieldValue.serverTimestamp() })
            .catch(() => {})
        }
        res.status(200).json({ received: true })
        return
      }

      // Success but no matching session → quarantine for admin review. Never drop money.
      if (!pointerSnap.exists) {
        const qid = parsed.checkoutId || parsed.reference
        await db.doc(`hubtelQuarantine/${qid}`).set(
          {
            reference: parsed.reference,
            checkoutId: parsed.checkoutId ?? null,
            amount: parsed.amountGHS,
            senderPhone: parsed.senderPhone ?? null,
            channel: parsed.channel ?? null,
            channelProvider: parsed.channelProvider ?? null,
            status: 'QUARANTINED',
            rawPayload: payload,
            receivedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        console.warn('[hubtelCallback] quarantined orphan reference:', parsed.reference)
        res.status(200).json({ received: true, quarantined: true })
        return
      }

      const campId = pointerSnap.data()!.campId as string
      const applied = await applyHubtelPayment({
        campId,
        reference: parsed.reference,
        paidAmountGHS: parsed.amountGHS,
        currency: 'GHS',
        hubtelId: parsed.checkoutId,
        channel: parsed.channel,
        channelProvider: parsed.channelProvider,
        senderPhone: parsed.senderPhone,
        matchedBy: 'auto',
        rawPayload: payload,
      })

      console.log('[hubtelCallback] applied', {
        reference: parsed.reference,
        applied: applied.applied,
        alreadyProcessed: applied.alreadyProcessed,
        reason: applied.reason,
      })
      res.status(200).json({ received: true })
    } catch (err) {
      // Let Hubtel retry on transient/unexpected errors; idempotency makes that safe.
      console.error('[hubtelCallback] error:', err)
      res.status(500).json({ error: 'Callback processing failed' })
    }
  },
)
