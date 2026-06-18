"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyHubtelPayment = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const hubtelClient_1 = require("./hubtelClient");
const applyHubtelPayment_1 = require("./applyHubtelPayment");
/**
 * Admin-only. The authoritative confirmation path: runs a Transaction Status Check and,
 * if Paid, applies the payment via the shared idempotent applyHubtelPayment. Polled by
 * the checkout modal / return page after the admin completes payment.
 */
exports.verifyHubtelPayment = (0, https_1.onRequest)({ cors: true, secrets: hubtelClient_1.HUBTEL_SECRETS }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    let uid;
    try {
        uid = (await (0, auth_1.getAuth)().verifyIdToken(authHeader.slice(7))).uid;
    }
    catch (_a) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        res.status(403).json({ error: 'Not an admin' });
        return;
    }
    const { campId, reference } = req.body || {};
    if (!campId || !reference) {
        res.status(400).json({ error: 'campId and reference are required' });
        return;
    }
    try {
        const verify = await (0, hubtelClient_1.verifyStatus)(reference);
        if (verify.status === 'SUCCESS') {
            const applied = await (0, applyHubtelPayment_1.applyHubtelPayment)({
                campId,
                reference,
                paidAmountGHS: verify.amountGHS,
                currency: verify.currency,
                hubtelId: verify.transactionId,
                channel: verify.channel,
                paidAt: verify.paidAt,
                matchedBy: uid,
            });
            if (applied.reason === 'NO_SESSION') {
                res.status(404).json({ status: 'PENDING', error: 'No matching session' });
                return;
            }
            if (applied.reason === 'UNDERPAID' || applied.reason === 'WRONG_CURRENCY') {
                res.json({ status: 'PENDING', message: 'Payment is under review' });
                return;
            }
            res.json({ status: 'SUCCESS', amountGHS: verify.amountGHS, batchId: applied.batchId });
            return;
        }
        if (verify.status === 'FAILED') {
            await db
                .doc(`camps/${campId}/hubtelTransactions/${reference}`)
                .update({ status: 'FAILED', updatedAt: firestore_1.FieldValue.serverTimestamp() })
                .catch(() => { });
            res.json({ status: 'FAILED', message: 'Payment failed' });
            return;
        }
        // PENDING / ABANDONED — still being processed
        res.json({ status: verify.status });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('verifyHubtelPayment error:', msg);
        res.status(500).json({ error: 'Verification failed' });
    }
});
//# sourceMappingURL=verifyHubtelPayment.js.map