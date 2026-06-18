"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hubtelPaymentCallback = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const crypto_1 = require("crypto");
const parseCallback_1 = require("./parseCallback");
const applyHubtelPayment_1 = require("./applyHubtelPayment");
// Optional. Hubtel checkout callbacks are not reliably signed, so this is best-effort:
// if a secret AND a signature header are both present we enforce it; otherwise we rely
// on reference-must-match-a-session + the amount guard in applyHubtelPayment.
const HUBTEL_WEBHOOK_SECRET = (0, params_1.defineSecret)('HUBTEL_WEBHOOK_SECRET');
function signatureOk(rawBody, signature) {
    const secret = HUBTEL_WEBHOOK_SECRET.value();
    if (!secret)
        return true; // not configured → skip
    if (!signature)
        return true; // Hubtel sent none → don't reject genuine callbacks
    const h256 = (0, crypto_1.createHmac)('sha256', secret).update(rawBody).digest('hex');
    if (h256 === signature)
        return true;
    const h512 = (0, crypto_1.createHmac)('sha512', secret).update(rawBody).digest('hex');
    return h512 === signature;
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
exports.hubtelPaymentCallback = (0, https_1.onRequest)({ cors: false, secrets: [HUBTEL_WEBHOOK_SECRET] }, async (req, res) => {
    var _a, _b, _c, _d;
    if (req.method === 'GET') {
        res.status(200).json({ status: 'ok', message: 'Hubtel callback endpoint active' });
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const raw = req.rawBody;
    const rawBody = raw ? raw.toString('utf8') : JSON.stringify(req.body || {});
    const signature = (req.headers['x-hubtel-signature'] ||
        req.headers['x-webhook-signature']);
    if (!signatureOk(rawBody, signature)) {
        console.warn('[hubtelCallback] invalid signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }
    let payload;
    try {
        payload =
            req.body && typeof req.body === 'object'
                ? req.body
                : JSON.parse(rawBody);
    }
    catch (_e) {
        payload = null;
    }
    const parsed = payload ? (0, parseCallback_1.parseCallback)(payload) : null;
    if (!parsed) {
        console.warn('[hubtelCallback] unparseable payload — acknowledging');
        res.status(200).json({ received: true });
        return;
    }
    try {
        const db = (0, firestore_1.getFirestore)();
        const pointerSnap = await db.doc(`hubtelReferences/${parsed.reference}`).get();
        // Non-success: record the failure on the session if we can find it, then ack.
        if (parsed.status !== 'SUCCESS') {
            if (pointerSnap.exists && parsed.status === 'FAILED') {
                const campId = pointerSnap.data().campId;
                await db
                    .doc(`camps/${campId}/hubtelTransactions/${parsed.reference}`)
                    .update({ status: 'FAILED', updatedAt: firestore_1.FieldValue.serverTimestamp() })
                    .catch(() => { });
            }
            res.status(200).json({ received: true });
            return;
        }
        // Success but no matching session → quarantine for admin review. Never drop money.
        if (!pointerSnap.exists) {
            const qid = parsed.checkoutId || parsed.reference;
            await db.doc(`hubtelQuarantine/${qid}`).set({
                reference: parsed.reference,
                checkoutId: (_a = parsed.checkoutId) !== null && _a !== void 0 ? _a : null,
                amount: parsed.amountGHS,
                senderPhone: (_b = parsed.senderPhone) !== null && _b !== void 0 ? _b : null,
                channel: (_c = parsed.channel) !== null && _c !== void 0 ? _c : null,
                channelProvider: (_d = parsed.channelProvider) !== null && _d !== void 0 ? _d : null,
                status: 'QUARANTINED',
                rawPayload: payload,
                receivedAt: firestore_1.FieldValue.serverTimestamp(),
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            console.warn('[hubtelCallback] quarantined orphan reference:', parsed.reference);
            res.status(200).json({ received: true, quarantined: true });
            return;
        }
        const campId = pointerSnap.data().campId;
        const applied = await (0, applyHubtelPayment_1.applyHubtelPayment)({
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
        });
        console.log('[hubtelCallback] applied', {
            reference: parsed.reference,
            applied: applied.applied,
            alreadyProcessed: applied.alreadyProcessed,
            reason: applied.reason,
        });
        res.status(200).json({ received: true });
    }
    catch (err) {
        // Let Hubtel retry on transient/unexpected errors; idempotency makes that safe.
        console.error('[hubtelCallback] error:', err);
        res.status(500).json({ error: 'Callback processing failed' });
    }
});
//# sourceMappingURL=hubtelPaymentCallback.js.map