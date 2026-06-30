"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPaymentClaim = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
/**
 * Sets or clears a leader's payment claim on a participant.
 *
 * Claim is a pre-confirmation signal: it does NOT change amountPaid,
 * paymentState, or rooming eligibility. Admin confirmation (5b-ii) is the
 * step that reads claims and updates amountPaid.
 *
 * Security: campId and subGroupId are always derived from the caller's own
 * /leaders/{uid} doc — same server-trust pattern as leaderRegisterParticipant.
 * A crafted request with a foreign participantId is rejected if that participant
 * belongs to a different sub-group.
 */
exports.setPaymentClaim = (0, https_1.onCall)(async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    }
    const uid = request.auth.uid;
    const displayName = (_a = request.auth.token.email) !== null && _a !== void 0 ? _a : uid;
    const db = (0, firestore_1.getFirestore)();
    const leaderSnap = await db.doc(`leaders/${uid}`).get();
    if (!leaderSnap.exists || ((_b = leaderSnap.data()) === null || _b === void 0 ? void 0 : _b.active) !== true) {
        throw new https_1.HttpsError('permission-denied', 'Not an active leader');
    }
    const leader = leaderSnap.data();
    const campId = leader.campId;
    const subGroupId = leader.subGroupId;
    const { participantId, claimed } = request.data;
    if (!participantId) {
        throw new https_1.HttpsError('invalid-argument', 'participantId is required');
    }
    if (typeof claimed !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'claimed must be a boolean');
    }
    const participantRef = db.doc(`camps/${campId}/participants/${participantId}`);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Participant not found');
    }
    const participant = participantSnap.data();
    // Sub-group boundary: reject cross-group claims even if the participant
    // exists in this camp.
    if (participant.subGroupId !== subGroupId) {
        throw new https_1.HttpsError('permission-denied', 'Participant does not belong to your sub-group');
    }
    const now = firestore_1.FieldValue.serverTimestamp();
    if (claimed) {
        await participantRef.update({
            paymentClaimed: true,
            claimedBy: uid,
            claimedAt: now,
            updatedAt: now,
            updatedBy: displayName,
        });
    }
    else {
        await participantRef.update({
            paymentClaimed: false,
            claimedBy: firestore_1.FieldValue.delete(),
            claimedAt: firestore_1.FieldValue.delete(),
            updatedAt: now,
            updatedBy: displayName,
        });
    }
    return { participantId, claimed };
});
//# sourceMappingURL=setPaymentClaim.js.map