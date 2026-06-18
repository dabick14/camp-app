"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyHubtelPayment = applyHubtelPayment;
const firestore_1 = require("firebase-admin/firestore");
async function applyHubtelPayment(args) {
    const db = (0, firestore_1.getFirestore)();
    const sessionRef = db.doc(`camps/${args.campId}/hubtelTransactions/${args.reference}`);
    return db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(sessionRef);
        if (!snap.exists) {
            return { applied: false, alreadyProcessed: false, reason: 'NO_SESSION' };
        }
        const session = snap.data();
        // Idempotency: already confirmed → return the existing batch.
        if (session.status === 'MATCHED' && session.batchId) {
            return {
                applied: false,
                alreadyProcessed: true,
                batchId: session.batchId,
            };
        }
        const currency = args.currency || 'GHS';
        if (currency !== 'GHS') {
            return { applied: false, alreadyProcessed: false, reason: 'WRONG_CURRENCY' };
        }
        // Never grant a batch for less than was requested (epsilon for float rounding).
        const expected = Number((_a = session.amountExpected) !== null && _a !== void 0 ? _a : 0);
        if (expected > 0 && args.paidAmountGHS + 1e-6 < expected) {
            return { applied: false, alreadyProcessed: false, reason: 'UNDERPAID' };
        }
        const batchRef = db.collection(`camps/${args.campId}/paymentBatches`).doc();
        const receivedAt = args.paidAt
            ? firestore_1.Timestamp.fromDate(args.paidAt)
            : firestore_1.FieldValue.serverTimestamp();
        const batch = {
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
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if (args.hubtelId) {
            batch.hubtelCheckoutId = args.hubtelId;
            batch.externalReference = args.hubtelId;
        }
        if (args.channel)
            batch.channel = args.channel;
        if (args.channelProvider)
            batch.channelProvider = args.channelProvider;
        tx.set(batchRef, batch);
        const sessionUpdate = {
            status: 'MATCHED',
            batchId: batchRef.id,
            amount: args.paidAmountGHS,
            matchedAt: firestore_1.FieldValue.serverTimestamp(),
            matchedBy: args.matchedBy,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if (args.hubtelId)
            sessionUpdate.checkoutId = args.hubtelId;
        if (args.channel)
            sessionUpdate.channel = args.channel;
        if (args.channelProvider)
            sessionUpdate.channelProvider = args.channelProvider;
        if (args.senderPhone)
            sessionUpdate.senderPhone = args.senderPhone;
        sessionUpdate.receivedAt = receivedAt;
        if (args.rawPayload !== undefined)
            sessionUpdate.rawPayload = args.rawPayload;
        tx.update(sessionRef, sessionUpdate);
        return { applied: true, alreadyProcessed: false, batchId: batchRef.id };
    });
}
//# sourceMappingURL=applyHubtelPayment.js.map